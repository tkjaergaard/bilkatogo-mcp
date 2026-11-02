// The cart-change policy behind the two setters: which failures are retried
// and how long to wait, when a batch stops early, how a failure is explained
// to the model, and the cart read afterwards.

import { LoginError } from "./auth.ts";
import {
  BilkaError,
  type BilkaClient,
  type LineChange,
  NotLoggedInError,
  UnreachableError,
} from "./bilka.ts";
import { type Cart, type CartSummary, summariseCart } from "./cart.ts";

/** Waits `ms` milliseconds. Tests inject an instant one. */
export type Sleep = (ms: number) => Promise<void>;

/** One line to set: a product and its absolute quantity (0 removes it). */
export type LineRequest = { product_id: string; quantity: number };

/** How long to wait before each retry of a temporary failure, in ms. */
const RETRY_BACKOFF_MS = [500, 1_000, 2_000];

/**
 * How long a batch waits between items, in ms, so a long batch reaches Bilka
 * at about the pace of one person clicking through the shop.
 */
const ITEM_GAP_MS = 250;

/**
 * The cart after a change: the summary, or the full cart when asked. The
 * change has already happened, so a failed read is reported next to it rather
 * than thrown.
 */
type CartAfter = { cart: Cart | CartSummary } | { cart: null; cart_error: string };

/** What happened to one item of a `set_cart_quantities` batch. */
type ItemOutcome = {
  product_id: string;
  requested_quantity: number;
  status: "ok" | "failed";
  attempts: number;
  /** The line's quantity as Bilka reports it, when the change went through. */
  quantity?: number;
  unit_price?: number | null;
  bilka_message?: string | null;
  offer_limit_message?: string | null;
  error: string | null;
};

/**
 * `set_cart_quantity`: one request, no retries. A failure throws, explained;
 * on success the result holds the line, Bilka's notes and the cart summary.
 */
export async function setCartQuantity(bilka: BilkaClient, { product_id, quantity }: LineRequest) {
  const change = await bilka
    .setLineQuantity({ productId: product_id, quantity })
    .catch((error: unknown) => {
      throw explainSetFailure(error);
    });
  const after = await cartAfterChange(bilka);
  const name = after.cart?.lines.find((line) => line.product_id === product_id)?.name ?? null;
  const { quantity: set, unit_price, ...notes } = toItemResult(change);
  return {
    line: { product_id, name, quantity: set, unit_price },
    requested_quantity: quantity,
    ...notes,
    ...after,
  };
}

/**
 * `set_cart_quantities`: the items in order, each retried on temporary
 * failures. A failed item doesn't stop the rest, except when continuing would
 * only fail too (the login failed) or would push into Bilka's rate limit (an
 * item gave up on HTTP 429). The rest are then reported as not attempted.
 * Items sent to Bilka are spaced ITEM_GAP_MS apart.
 */
export async function setCartQuantities(
  bilka: BilkaClient,
  sleep: Sleep,
  items: LineRequest[],
  { full }: { full: boolean },
) {
  const outcomes: ItemOutcome[] = [];
  let stopReason: string | undefined;
  for (const item of items) {
    if (stopReason !== undefined) {
      outcomes.push({
        product_id: item.product_id,
        requested_quantity: item.quantity,
        status: "failed",
        attempts: 0,
        error: `Not attempted: ${stopReason}`,
      });
      continue;
    }
    if (outcomes.length > 0) await sleep(ITEM_GAP_MS);
    const applied = await applyItem(bilka, sleep, item);
    outcomes.push(applied.outcome);
    stopReason = applied.stopReason;
  }
  const ok = outcomes.filter((outcome) => outcome.status === "ok").length;
  return {
    items: outcomes,
    ok,
    failed: outcomes.length - ok,
    ...(await cartAfterChange(bilka, full)),
  };
}

/** The line as Bilka reports it after a change, in tool-result field names. */
function toItemResult(change: LineChange) {
  return {
    quantity: change.quantity,
    unit_price: change.unit_price,
    bilka_message: change.message,
    offer_limit_message: change.offer_limit_message,
  };
}

/**
 * Sets one batch item's quantity, retrying temporary failures. A failure is
 * recorded in the outcome rather than thrown, so the batch can carry on.
 * `stopReason` says why the rest of the batch shouldn't be sent, if so.
 */
async function applyItem(
  bilka: BilkaClient,
  sleep: Sleep,
  { product_id, quantity }: LineRequest,
): Promise<{ outcome: ItemOutcome; stopReason?: string }> {
  let attempts = 0;
  const attempt = () => {
    attempts += 1;
    return bilka.setLineQuantity({ productId: product_id, quantity });
  };
  try {
    const change = await withRetries(attempt, sleep);
    return {
      outcome: {
        product_id,
        requested_quantity: quantity,
        status: "ok",
        attempts,
        ...toItemResult(change),
        error: null,
      },
    };
  } catch (error) {
    if (!(error instanceof BilkaError)) throw error;
    const outcome: ItemOutcome = {
      product_id,
      requested_quantity: quantity,
      status: "failed",
      attempts,
      error: explainSetFailure(error).message,
    };
    return { outcome, stopReason: stopReasonFor(error) };
  }
}

/** Why a failed item stops the rest of the batch, or undefined when it doesn't. */
function stopReasonFor(error: BilkaError): string | undefined {
  if (isLoginFailure(error)) {
    return "the login failed on an earlier item, so the rest were skipped.";
  }
  if (error.status === 429) {
    return (
      "Bilka kept answering HTTP 429 (rate limit) on an earlier item, so the rest were " +
      "skipped to stay within the limit. Try them again in a little while."
    );
  }
  return undefined;
}

/** Runs `attempt`, retrying temporary Bilka failures with growing waits. */
async function withRetries<T>(attempt: () => Promise<T>, sleep: Sleep): Promise<T> {
  for (const wait of RETRY_BACKOFF_MS) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof BilkaError && error.retryable)) throw error;
    }
    await sleep(wait);
  }
  return attempt();
}

/** The account can't be used: no login, a rejected login, or an expired session. */
function isLoginFailure(error: BilkaError): boolean {
  return error instanceof NotLoggedInError || error instanceof LoginError;
}

/**
 * Says whether a failed cart change is worth trying again. A transport failure
 * may have reached Bilka before it failed, so the cart may have changed.
 */
function explainSetFailure<E>(error: E): E | BilkaError {
  if (!(error instanceof BilkaError) || isLoginFailure(error)) return error;
  if (error instanceof UnreachableError) {
    return new BilkaError(
      `${error.message}. Check the network connection; then check the cart with get_cart ` +
        "before setting the quantity again.",
      { cause: error },
    );
  }
  if (error.retryable) {
    return new BilkaError(
      `${error.message}. This is usually temporary, but the change may still have reached ` +
        "Bilka: check the cart with get_cart before setting the quantity again.",
      { status: error.status, retryable: true, cause: error },
    );
  }
  return new BilkaError(
    `Bilka rejected the change (${error.message}). Trying again won't help; ` +
      "check the product id with search_products or get_cart.",
    { status: error.status, cause: error },
  );
}

async function cartAfterChange(bilka: BilkaClient, full = false): Promise<CartAfter> {
  try {
    const cart = await bilka.getCart();
    return { cart: full ? cart : summariseCart(cart) };
  } catch (error) {
    if (!(error instanceof BilkaError)) throw error;
    return { cart: null, cart_error: error.message };
  }
}
