// Shapes the shop's cart answer (`shop/v6/Cart`) into model-friendly objects:
// DKK instead of øre, clear field names, service fees apart from groceries.
// Its input has already been through the privacy scrub.

import { type DeliveryPlace, toPlace } from "./delivery.ts";
import { kroner } from "./money.ts";
import { REDACTED } from "./scrub.ts";

export type CartLine = {
  product_id: string;
  name: string;
  quantity: number;
  /** What one item costs, in DKK. */
  unit_price: number | null;
  /** quantity × unit price after line discounts, in DKK. */
  line_total: number | null;
  brand: string | null;
  /** Package size, e.g. "440 g". */
  size: string | null;
  /** The shop's aisle heading for the line, e.g. "Frost". */
  group: string | null;
  /** Why Bilka can't supply the line, when it can't. */
  unavailable_reason: string | null;
  /** The customer's note on the line. Always a privacy marker when set. */
  note: unknown;
};

export type CartFee = { name: string; amount: number | null };

/** Where and when the cart's order would be delivered or picked up. */
export type CartDelivery = {
  /** The cart's delivery place, or null when Bilka didn't say. */
  place: DeliveryPlace | null;
  /** The slot set on the cart, or null when none is. */
  slot: {
    date: string;
    start: string;
    end: string;
    /** e.g. "Søn. 08/11. Senest kl. 06:00". */
    text: string | null;
    /** False when the place doesn't offer this slot (any more), so another must be chosen. */
    available: boolean;
  } | null;
};

/** The whole cart. `summariseCart` picks the compact form from it. */
export type Cart = {
  currency: "DKK";
  /** What the cart costs in total, fees included. */
  total: number | null;
  /** The number of grocery items: the sum of the lines' quantities. */
  item_count: number;
  lines: CartLine[];
  /** Service lines such as "Pakkeservice" and "Leveringsgebyr". */
  fees: CartFee[];
  delivery: CartDelivery;
  /** e.g. "Man. 07/01. kl. 17:00 - 21:00". */
  delivery_slot: string | null;
  /** How much more to buy before the order reaches Bilka's minimum, in DKK. */
  minimum_left: number | null;
  /** Bilka's note on the minimum, e.g. "422,00 kr. fra minimumskøb på 500,00 kr. …". */
  minimum_left_text: string | null;
  /**
   * The pickup place's name, or for home delivery the privacy marker: the
   * customer's address never reaches the model.
   */
  delivery_address: unknown;
  /** Door code, delivery and access notes. Always a privacy marker when set. */
  delivery_notes: unknown;
};

export type CartSummary = Pick<Cart, "currency" | "total" | "item_count" | "fees" | "delivery"> & {
  lines: Pick<CartLine, "product_id" | "name" | "quantity" | "unit_price" | "line_total">[];
};

// The heading Bilka files fees under. They're ordinary lines in the cart.
const SERVICES_HEADLINE = "services";

type ShopCart = {
  stat?: {
    price?: number;
    minimum_left?: number;
    minimum_left_text?: string;
    delivery_comment?: unknown;
  };
  lines?: ShopLineGroup[];
  deliveryAddress?: unknown;
  deliveryDate?: {
    deliveryDate?: string;
    intervalStart?: string;
    intervalEnd?: string;
    closed?: number;
    delivery_message?: string;
  } | null;
};

/** The line groups of a cart or order (`lines[].lines[].orderlines[]`). */
export type ShopLineGroup = { headline?: string; lines?: { orderlines?: ShopOrderLine[] }[] };

export type ShopOrderLine = {
  quantity?: number;
  amount?: number;
  unitprice?: number;
  unavailable_reason?: string;
  comment?: unknown;
  product?: {
    objectID?: number | string;
    name?: string;
    brand?: string;
    units?: number;
    unitsOfMeasure?: string;
    /** The offer the line was bought on, e.g. "Plus pris 10,00". */
    cpOfferMsg?: string;
  };
};

export function toCart(data: unknown): Cart {
  const cart = (data ?? {}) as ShopCart;
  const { items: lines, fees } = splitLines(cart.lines, (line) => line);
  const place = toPlace(cart.deliveryAddress);
  return {
    currency: "DKK",
    total: kroner(cart.stat?.price),
    item_count: lines.reduce((count, line) => count + line.quantity, 0),
    lines,
    fees,
    delivery: { place, slot: toSlot(cart.deliveryDate) },
    delivery_slot: cart.deliveryDate?.delivery_message?.trim() || null,
    minimum_left: kroner(cart.stat?.minimum_left),
    minimum_left_text: plain(cart.stat?.minimum_left_text),
    delivery_address: place?.name ?? (cart.deliveryAddress ? REDACTED : null),
    delivery_notes: cart.stat?.delivery_comment ?? null,
  };
}

export function summariseCart(cart: Cart): CartSummary {
  return {
    currency: cart.currency,
    total: cart.total,
    item_count: cart.item_count,
    lines: cart.lines.map(({ product_id, name, quantity, unit_price, line_total }) => ({
      product_id,
      name,
      quantity,
      unit_price,
      line_total,
    })),
    fees: cart.fees,
    delivery: cart.delivery,
  };
}

function toSlot(date: ShopCart["deliveryDate"]): CartDelivery["slot"] {
  if (!date?.deliveryDate || !date.intervalStart || !date.intervalEnd) return null;
  return {
    date: date.deliveryDate,
    start: date.intervalStart,
    end: date.intervalEnd,
    text: date.delivery_message?.trim() || null,
    available: date.closed === 0,
  };
}

/**
 * Splits the order lines in Bilka's nested groups (`lines[].lines[].orderlines[]`)
 * into groceries and fees, in order. Lines under "Services" are fees; every
 * other line is shaped by `toItem`, from its cart-line form and Bilka's raw
 * line. Carts and orders share this shape.
 */
export function splitLines<T>(
  groups: ShopLineGroup[] | undefined,
  toItem: (line: CartLine, orderline: ShopOrderLine) => T,
): { items: T[]; fees: CartFee[] } {
  const items: T[] = [];
  const fees: CartFee[] = [];
  for (const group of groups ?? []) {
    const headline = group.headline?.trim() || null;
    const isFee = headline?.toLowerCase() === SERVICES_HEADLINE;
    for (const line of group.lines ?? []) {
      for (const orderline of line.orderlines ?? []) {
        const shaped = toCartLine(orderline, headline);
        if (isFee) fees.push({ name: shaped.name, amount: shaped.line_total });
        else items.push(toItem(shaped, orderline));
      }
    }
  }
  return { items, fees };
}

function toCartLine(orderline: ShopOrderLine, group: string | null): CartLine {
  const product = orderline.product ?? {};
  const units = product.units;
  const measure = product.unitsOfMeasure?.trim();
  return {
    product_id: String(product.objectID ?? ""),
    name: product.name ?? "",
    quantity: orderline.quantity ?? 0,
    unit_price: kroner(orderline.unitprice),
    line_total: kroner(orderline.amount),
    brand: product.brand?.trim() || null,
    size: typeof units === "number" && units > 0 && measure ? `${units} ${measure}` : null,
    group,
    unavailable_reason: orderline.unavailable_reason?.trim() || null,
    note: orderline.comment === "" ? null : (orderline.comment ?? null),
  };
}

/** Bilka's short notices carry a little HTML (`<strong>`). */
function plain(html: string | undefined): string | null {
  const text = (html ?? "").replace(/<[^>]*>/g, "").trim();
  return text || null;
}
