// Dev-only capture script for issue #4. It logs in to a real BilkaToGo
// account, calls the login, cart and order endpoints once each and saves every
// raw response as its own JSON file outside the repo, so the auth, cart and
// order work can be built against real response shapes.
//
// It is not part of the server or its tool surface. A person runs it by hand;
// see docs/capture.md for the steps and what to do with the files afterwards.
//
//   node scripts/capture.ts <cheap-product-id> [--out <dir>]
//
// Secrets (password, login token, JWT, session cookies) are never printed and
// never written: secret fields in the saved responses become "<secret>".

import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  ALGOLIA_APP_ID,
  ALGOLIA_HOST,
  ALGOLIA_PRODUCT_INDEX,
  ALGOLIA_SEARCH_KEY,
  GIGYA_API_KEY,
  GIGYA_HOST,
  JWT_LIFETIME_SECONDS,
  PRODUCT_ID_PATTERN,
  REQUEST_TIMEOUT_MS,
  SHOP_HOST,
} from "../src/bilka.ts";
import {
  type Credentials,
  defaultLoginFile,
  type Env,
  readCredentials,
} from "../src/credentials.ts";
import { errorCode, isRecord } from "../src/values.ts";

// Endpoint facts, from docs/research.md §3 and the request shapes in
// nickknissen/bilkatogo (src/bilkatogo/client.py, const.py) and
// stigvoss/bilkatogo-mcp (server.py).
const API_BASE_URL = `${SHOP_HOST}/api`;
const CART_PARAMS = { extra: "deliveryAddress,deliveryDate" };
const ORDER_HISTORY_PARAMS = { limit: "5", offset: "0", muah: "1", ordertype: "dibs,pgw" };
const ALGOLIA_QUERY_URL = `${ALGOLIA_HOST}/1/indexes/${ALGOLIA_PRODUCT_INDEX}/query`;
const ALGOLIA_HEADERS = {
  "x-algolia-application-id": ALGOLIA_APP_ID,
  "x-algolia-api-key": ALGOLIA_SEARCH_KEY,
};

/** Values of keys matching this are replaced with "<secret>" before saving. */
const SECRET_KEY = /token|cookievalue|jwt|password|secret|signature/i;
const SECRET_MARKER = "<secret>";

export const REPO_ROOT = resolve(import.meta.dirname, "..");

export type CaptureOptions = {
  fetch: typeof fetch;
  credentials: Credentials;
  storeId?: string;
  /** The cheap product whose line count is set to 1 and back to 0. */
  productId: string;
  /** Where the raw responses go. Must be outside the repo, and empty or missing. */
  outDir: string;
  /** Receives every line of output. Lines are scrubbed of secrets first. */
  log: (line: string) => void;
  repoRoot?: string;
  now?: () => Date;
};

export type PasswordLogin =
  | "worked"
  | "not tried"
  | "invalid credentials"
  | "blocked: CAPTCHA or bot protection"
  | "blocked: account locked"
  | "failed";

type StepRecord = {
  step: string;
  request: string;
  file?: string;
  status?: number;
  contentType?: string;
  setCookieNames?: string[];
  ms?: number;
  error?: string;
};

export type CaptureReport = {
  startedAt: string;
  productId: string;
  storeId: string | null;
  login: {
    source: "password" | "login token";
    passwordLogin: PasswordLogin;
    gigyaErrorCode?: number;
    gigyaMessage?: string;
  };
  session: {
    jwtExchange?: string;
    cartWithJwtOnly?: string;
    loginJwt?: string;
    loginJwtCookieNames?: string[];
  };
  product: { found: boolean | null; name?: string };
  cartChange: {
    done: "set to 1 then back to 0" | "skipped" | "incomplete";
    reason?: string;
    inCartAfter?: boolean | null;
    cartLeftUnchanged: boolean | null;
  };
  orders: { count: number | null; detailsFetched: boolean };
  steps: StepRecord[];
  exitCode: number;
};

export type Answer = {
  status: number;
  headers: Headers;
  body: unknown;
};

function defaultOutDir(env: Env, now: Date): string {
  const cacheHome = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return join(cacheHome, "bilka-mcp", "captures", stamp);
}

export async function runCapture(options: CaptureOptions): Promise<CaptureReport> {
  const { credentials, productId } = options;
  const now = options.now ?? (() => new Date());
  const secrets = new Set<string>();
  for (const value of [credentials.password, credentials.loginToken]) {
    if (value) secrets.add(value);
  }
  const scrub = (text: string) => scrubText(text, secrets);
  // Output also hides the email address; the saved files keep it for the
  // human to find and scrub.
  const hiddenFromOutput = new Set(credentials.email ? [credentials.email] : []);
  const log = (line: string) => options.log(scrubText(scrub(line), hiddenFromOutput));

  const report: CaptureReport = {
    startedAt: now().toISOString(),
    productId,
    storeId: options.storeId ?? null,
    login: {
      source: credentials.loginToken ? "login token" : "password",
      passwordLogin: "not tried",
    },
    session: {},
    product: { found: null },
    cartChange: { done: "skipped", cartLeftUnchanged: true },
    orders: { count: null, detailsFetched: false },
    steps: [],
    exitCode: 0,
  };

  if (!PRODUCT_ID_PATTERN.test(productId)) {
    log(`error: the product id must be digits, like 18381 (got "${productId.slice(0, 20)}")`);
    report.exitCode = 64;
    return report;
  }
  if (!credentials.loginToken && !(credentials.email && credentials.password)) {
    log(
      "error: no credentials. Set BILKATOGO_EMAIL and BILKATOGO_PASSWORD, or BILKATOGO_LOGIN_TOKEN, " +
        "or put them in ~/.config/bilka-mcp/login.json.",
    );
    report.exitCode = 2;
    return report;
  }
  const outDir = resolve(options.outDir);
  const refusal = await checkOutDir(outDir, options.repoRoot ?? REPO_ROOT);
  if (refusal) {
    log(`error: ${refusal}`);
    report.exitCode = 64;
    return report;
  }
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await chmod(outDir, 0o700);

  const jar = new Map<string, string>();
  let fileNumber = 0;

  async function call(step: string, url: string, init: RequestInit): Promise<Answer | undefined> {
    const method = init.method ?? "GET";
    const record: StepRecord = { step, request: `${method} ${url}` };
    report.steps.push(record);
    const started = Date.now();
    try {
      const response = await options.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      record.ms = Date.now() - started;
      record.status = response.status;
      record.contentType = response.headers.get("content-type") ?? undefined;
      const cookies = response.headers.getSetCookie().map(parseSetCookie);
      if (cookies.length > 0) record.setCookieNames = cookies.map((cookie) => cookie.name);
      let body: unknown;
      let saved: string;
      let extension = "json";
      try {
        body = JSON.parse(text);
        saved = `${JSON.stringify(maskSecrets(body, secrets), null, 2)}\n`;
      } catch {
        body = undefined;
        saved = scrub(text);
        extension = "txt";
      }
      fileNumber += 1;
      const file = `${String(fileNumber).padStart(2, "0")}-${step}.${extension}`;
      await writeFile(join(outDir, file), saved, { mode: 0o600, flag: "wx" });
      record.file = file;
      log(`  ${step.padEnd(28)} HTTP ${response.status}  -> ${file}`);
      return { status: response.status, headers: response.headers, body };
    } catch (error) {
      record.ms = Date.now() - started;
      record.error = scrub(errorText(error));
      log(`  ${step.padEnd(28)} failed: ${record.error}`);
      return undefined;
    }
  }

  function shopUrl(path: string, params: Record<string, string> = {}): string {
    return `${API_BASE_URL}/${path}?${new URLSearchParams({ u: "w", ...params })}`;
  }

  function shopHeaders(jwt: string, withCookies: boolean): Record<string, string> {
    const headers: Record<string, string> = { jwt_token: jwt, accept: "application/json" };
    if (withCookies && jar.size > 0) {
      headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    return headers;
  }

  async function shop(
    step: string,
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
    jwt: string,
  ): Promise<Answer | undefined> {
    const answer = await call(step, shopUrl(path, params), {
      method,
      headers: shopHeaders(jwt, true),
    });
    if (answer) updateJar(jar, answer.headers, secrets);
    return answer;
  }

  log(`Capturing to ${outDir}`);

  // 1. Check the product exists (public Algolia search, no login), so a typo
  //    can't put the wrong thing in the cart.
  const filters = [`objectID:${productId}`];
  if (options.storeId) filters.push(`isInAssortmentIn:${options.storeId}`);
  const productAnswer = await call("algolia-product", ALGOLIA_QUERY_URL, {
    method: "POST",
    headers: { ...ALGOLIA_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({
      query: "",
      hitsPerPage: 1,
      filters: filters.join(" AND "),
      attributesToRetrieve: ["name", "brand"],
    }),
  });
  const hit = firstHit(productAnswer?.body);
  report.product = productAnswer?.status === 200 ? { found: hit !== undefined } : { found: null };
  if (hit && typeof hit.name === "string") report.product.name = hit.name;

  // 2. Gigya accounts.login, unless a login token was pasted.
  let loginToken = credentials.loginToken;
  if (!loginToken) {
    const answer = await call("gigya-accounts.login", `${GIGYA_HOST}/accounts.login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        loginID: credentials.email ?? "",
        password: credentials.password ?? "",
        apiKey: GIGYA_API_KEY,
        httpStatusCodes: "true",
      }),
    });
    const outcome = classifyGigyaLogin(answer);
    report.login.passwordLogin = outcome.result;
    if (outcome.errorCode !== undefined) report.login.gigyaErrorCode = outcome.errorCode;
    if (outcome.message) report.login.gigyaMessage = scrub(outcome.message);
    if (outcome.loginToken) {
      loginToken = outcome.loginToken;
      secrets.add(loginToken);
    }
  }
  if (!loginToken) {
    log(`Password login: ${describeLogin(report)}`);
    log("Stopping: no login token. See docs/capture.md for pasting one from the browser.");
    report.exitCode = 2;
    return finish();
  }

  // 3. Gigya accounts.getJWT: login token -> JWT (24 h).
  const jwtAnswer = await call("gigya-accounts.getJWT", `${GIGYA_HOST}/accounts.getJWT`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      apiKey: GIGYA_API_KEY,
      login_token: loginToken,
      expiration: String(JWT_LIFETIME_SECONDS),
      httpStatusCodes: "true",
    }),
  });
  const jwt = isRecord(jwtAnswer?.body) ? jwtAnswer.body.id_token : undefined;
  if (typeof jwt !== "string" || !jwt) {
    report.session.jwtExchange = `failed (${describeAnswer(jwtAnswer)})`;
    log(`JWT exchange failed: ${describeAnswer(jwtAnswer)}. Stopping.`);
    report.exitCode = 2;
    return finish();
  }
  secrets.add(jwt);
  report.session.jwtExchange = "worked";

  // 4. Does the shop accept the JWT header alone? stigvoss sends no cookies;
  //    nickknissen calls auth/LoginJWT first and sends its cookies. Cookies
  //    set by this probe are thrown away.
  const probe = await call("shop-v6-Cart-jwt-only", shopUrl("shop/v6/Cart", CART_PARAMS), {
    method: "GET",
    headers: shopHeaders(jwt, false),
  });
  for (const cookie of probe?.headers.getSetCookie() ?? []) {
    secrets.add(parseSetCookie(cookie).value);
  }
  report.session.cartWithJwtOnly = describeShopAnswer(probe);

  // 5. auth/LoginJWT, as nickknissen does. It is sent with no cookies at all:
  //    a `cart` cookie here makes Bilka replace the account's cart with the
  //    cart stored under that cookie.
  const loginJwt = await call("auth-LoginJWT", shopUrl("auth/LoginJWT"), {
    method: "POST",
    headers: shopHeaders(jwt, false),
  });
  if (loginJwt) updateJar(jar, loginJwt.headers, secrets);
  report.session.loginJwt = describeShopAnswer(loginJwt);
  report.session.loginJwtCookieNames = [...jar.keys()];

  // 6. Cart read.
  const cart = await shop("shop-v6-Cart", "GET", "shop/v6/Cart", CART_PARAMS, jwt);

  // 7. ChangeLineCount to 1 and back to 0, only for a product not in the cart.
  // A failed product check (null) doesn't block the change: the cart check
  // below still keeps an existing line safe.
  if (report.product.found === false) {
    skipCartChange(
      options.storeId
        ? `product ${productId} was not found at store ${options.storeId}`
        : `product ${productId} was not found`,
    );
  } else if (!isShopSuccess(cart)) {
    skipCartChange(`the cart read did not succeed (${describeShopAnswer(cart)})`);
  } else if (containsValue(cart.body, productId)) {
    skipCartChange(`product ${productId} is already in the cart, so it was left alone`);
  } else {
    report.cartChange = { done: "incomplete", cartLeftUnchanged: null };
    const lineParams = (count: string) => ({ productId, count, fullCart: "0" });
    await shop("shop-v6-ChangeLineCount-1", "GET", "shop/v6/ChangeLineCount", lineParams("1"), jwt);
    // Always try to set it back, whatever the first call answered.
    const reset = await shop(
      "shop-v6-ChangeLineCount-0",
      "GET",
      "shop/v6/ChangeLineCount",
      lineParams("0"),
      jwt,
    );
    const after = await shop("shop-v6-Cart-after", "GET", "shop/v6/Cart", CART_PARAMS, jwt);
    const inCartAfter = isShopSuccess(after) ? containsValue(after.body, productId) : null;
    report.cartChange.inCartAfter = inCartAfter;
    if (isShopSuccess(reset) && inCartAfter === false) {
      report.cartChange = {
        done: "set to 1 then back to 0",
        inCartAfter,
        cartLeftUnchanged: true,
      };
    } else {
      report.cartChange.reason =
        inCartAfter === true
          ? `product ${productId} is still in the cart`
          : "could not confirm the product was removed again";
      report.cartChange.cartLeftUnchanged = inCartAfter === true ? false : null;
    }
  }

  // 8. Order history, then 9. details of the newest order.
  const history = await shop(
    "shop-v7-OrderHistory",
    "POST",
    "shop/v7/OrderHistory",
    ORDER_HISTORY_PARAMS,
    jwt,
  );
  const orders = isRecord(history?.body) ? history.body.orders : undefined;
  if (Array.isArray(orders)) {
    report.orders.count = orders.length;
    const newest: unknown = orders[0];
    const orderId = isRecord(newest) ? (newest.orderId ?? newest.order_id ?? newest.id) : undefined;
    if (typeof orderId === "string" || typeof orderId === "number") {
      const details = await shop(
        "shop-v7-OrderDetails",
        "GET",
        "shop/v7/OrderDetails",
        { orderId: String(orderId) },
        jwt,
      );
      report.orders.detailsFetched = isShopSuccess(details);
    } else if (orders.length > 0) {
      log("  (the newest order has no orderId field, so order details were skipped)");
    } else {
      log("  (no orders in the history, so order details were skipped)");
    }
  }

  return finish();

  function skipCartChange(reason: string) {
    report.cartChange = { done: "skipped", reason, cartLeftUnchanged: true };
  }

  async function finish(): Promise<CaptureReport> {
    const failed = report.steps.some(
      (step) => step.error !== undefined || (step.status ?? 0) >= 400,
    );
    if (report.cartChange.cartLeftUnchanged !== true) report.exitCode = 3;
    else if (report.exitCode === 0 && failed) report.exitCode = 1;
    const summary = `${scrub(JSON.stringify(report, null, 2))}\n`;
    await writeFile(join(outDir, "summary.json"), summary, { mode: 0o600, flag: "wx" });
    printSummary();
    return report;
  }

  function printSummary() {
    const saved = report.steps.filter((step) => step.file).length;
    log("");
    log(`Saved ${saved} responses and summary.json in ${outDir} (folder 700, files 600).`);
    log(`Password login: ${describeLogin(report)}`);
    if (report.session.jwtExchange) log(`JWT exchange: ${report.session.jwtExchange}`);
    if (report.session.cartWithJwtOnly) {
      log(`Cart with only the jwt_token header: ${report.session.cartWithJwtOnly}`);
    }
    if (report.session.loginJwt) {
      const names = report.session.loginJwtCookieNames ?? [];
      log(`auth/LoginJWT: ${report.session.loginJwt}; cookies set: ${names.join(", ") || "none"}`);
    }
    const product = report.product.name ? `${productId} (${report.product.name})` : productId;
    const change = report.cartChange;
    if (change.done === "set to 1 then back to 0") {
      log(`Cart change: product ${product} set to 1, then back to 0. Your cart is as it was.`);
    } else if (change.done === "skipped") {
      if (loginToken) log(`Cart change: skipped, ${change.reason}. Your cart was not touched.`);
    } else {
      log(
        `WARNING: cart change for product ${product}: ${change.reason}. ` +
          "Check your cart on bilkatogo.dk and remove it by hand if it is there.",
      );
    }
    if (report.orders.count !== null) {
      log(
        `Orders: ${report.orders.count} in the first history page; details of the newest ` +
          (report.orders.detailsFetched ? "saved." : "not saved."),
      );
    }
    log(`Next: node scripts/key-paths.ts ${outDir}`);
  }
}

/** Decides from Gigya's accounts.login answer whether password login worked headless. */
export function classifyGigyaLogin(answer: Answer | undefined): {
  result: PasswordLogin;
  loginToken?: string;
  errorCode?: number;
  message?: string;
} {
  if (!answer) return { result: "failed", message: "no answer (network error or timeout)" };
  const body = answer.body;
  if (!isRecord(body)) {
    // An HTML page or empty answer instead of Gigya's JSON: a WAF or bot wall.
    return {
      result:
        answer.status === 403 || answer.status === 429
          ? "blocked: CAPTCHA or bot protection"
          : "failed",
      message: `HTTP ${answer.status} without Gigya JSON`,
    };
  }
  const errorCode = typeof body.errorCode === "number" ? body.errorCode : undefined;
  const message = [body.errorMessage, body.errorDetails]
    .filter((part) => typeof part === "string" && part)
    .join(": ");
  const session = body.sessionInfo;
  const token = isRecord(session) ? session.cookieValue : undefined;
  if (errorCode === 0 && typeof token === "string" && token) {
    return { result: "worked", loginToken: token, errorCode };
  }
  // Codes from SAP's Gigya error-code list; not yet seen live from Bilka.
  // 403042 invalid loginID or password; 401020 CAPTCHA required; 401021
  // CAPTCHA verification failed; 403120 account temporarily locked out.
  let result: PasswordLogin = "failed";
  if (errorCode === 403042) result = "invalid credentials";
  else if (errorCode === 401020 || errorCode === 401021 || /captcha|risk|bot/i.test(message)) {
    result = "blocked: CAPTCHA or bot protection";
  } else if (errorCode === 403120 || /locked/i.test(message)) result = "blocked: account locked";
  return { result, errorCode, message: message || undefined };
}

function describeLogin(report: CaptureReport): string {
  const { login } = report;
  if (login.source === "login token") return "not tried (BILKATOGO_LOGIN_TOKEN is set)";
  if (login.passwordLogin === "worked") return "worked headless";
  const detail = [
    login.gigyaErrorCode !== undefined ? `Gigya errorCode ${login.gigyaErrorCode}` : undefined,
    login.gigyaMessage,
  ]
    .filter(Boolean)
    .join(", ");
  return detail ? `${login.passwordLogin} (${detail})` : login.passwordLogin;
}

function describeAnswer(answer: Answer | undefined): string {
  if (!answer) return "no answer";
  if (isRecord(answer.body)) {
    const message = answer.body.errorMessage ?? answer.body.msg;
    if (typeof message === "string" && message) return `HTTP ${answer.status}, ${message}`;
  }
  return `HTTP ${answer.status}`;
}

function describeShopAnswer(answer: Answer | undefined): string {
  if (isShopSuccess(answer)) return `worked (HTTP ${answer.status})`;
  return `rejected (${describeAnswer(answer)})`;
}

/** A 200 answer that isn't one of Bilka's `{code, msg}` error bodies. */
function isShopSuccess(answer: Answer | undefined): answer is Answer {
  if (!answer || answer.status !== 200 || !isRecord(answer.body)) return false;
  return !("code" in answer.body && "msg" in answer.body);
}

/**
 * True when `target` appears anywhere in `value` as a string or number. Used to
 * decide whether a product is already in the cart without trusting a guessed
 * cart shape: a false match only means the cart change is skipped.
 */
function containsValue(value: unknown, target: string): boolean {
  if (typeof value === "string") return value === target;
  if (typeof value === "number") return String(value) === target;
  if (Array.isArray(value)) return value.some((item) => containsValue(item, target));
  if (isRecord(value)) return Object.values(value).some((item) => containsValue(item, target));
  return false;
}

/** Replaces secret fields and every known secret value with "<secret>". */
function maskSecrets(value: unknown, secrets: Set<string>): unknown {
  if (typeof value === "string") return scrubText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => maskSecrets(item, secrets));
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] =
        SECRET_KEY.test(key) && typeof item === "string" && item
          ? SECRET_MARKER
          : maskSecrets(item, secrets);
    }
    return result;
  }
  return value;
}

function scrubText(text: string, secrets: Set<string>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= 4) result = result.split(secret).join(SECRET_MARKER);
  }
  return result;
}

function updateJar(jar: Map<string, string>, headers: Headers, secrets: Set<string>) {
  for (const header of headers.getSetCookie()) {
    const { name, value, expired } = parseSetCookie(header);
    if (!name) continue;
    if (expired) jar.delete(name);
    else {
      jar.set(name, value);
      secrets.add(value);
    }
  }
}

function parseSetCookie(header: string): { name: string; value: string; expired: boolean } {
  const [pair = "", ...attributes] = header.split(";");
  const equals = pair.indexOf("=");
  const name = (equals < 0 ? pair : pair.slice(0, equals)).trim();
  const value = equals < 0 ? "" : pair.slice(equals + 1).trim();
  const expired =
    value === "deleted" ||
    attributes.some((attribute) => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(attribute));
  return { name, value, expired };
}

function firstHit(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !Array.isArray(body.hits)) return undefined;
  const hit: unknown = body.hits[0];
  return isRecord(hit) ? hit : undefined;
}

/** Refuses an output folder inside the repo, or one that already has files in it. */
async function checkOutDir(outDir: string, repoRoot: string): Promise<string | undefined> {
  const inside = relative(resolve(repoRoot), outDir);
  if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) {
    return `refusing to save raw responses inside the repo (${outDir}); pick a folder outside it`;
  }
  try {
    const entries = await readdir(outDir);
    if (entries.length > 0) return `${outDir} is not empty; pick a new folder`;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      return `cannot use ${outDir} (${errorName(error)})`;
    }
  }
  return undefined;
}

function errorName(error: unknown): string {
  return errorCode(error) ?? "error";
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

const USAGE = `Usage: node scripts/capture.ts <cheap-product-id> [--out <dir>]

Records raw BilkaToGo responses from your own account (see docs/capture.md).
Credentials: BILKATOGO_EMAIL + BILKATOGO_PASSWORD, or BILKATOGO_LOGIN_TOKEN
(skips password login), or ~/.config/bilka-mcp/login.json. Optional:
BILKATOGO_STORE_ID (checks the product is sold at your store).
Default output folder: \${XDG_CACHE_HOME:-~/.cache}/bilka-mcp/captures/<time>.`;

async function main(argv: string[]): Promise<number> {
  const positional: string[] = [];
  let outDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      return 0;
    }
    if (arg === "--out") {
      outDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--out=")) outDir = arg.slice("--out=".length);
    else positional.push(arg);
  }
  const productId = positional[0];
  if (!productId || positional.length > 1 || outDir === "") {
    console.error(USAGE);
    return 64;
  }
  const env = process.env;
  const loginFile = defaultLoginFile(env);
  const credentials = await readCredentials(env, loginFile, (line) => console.error(line));
  const now = new Date();
  const report = await runCapture({
    fetch: globalThis.fetch,
    credentials,
    storeId: env.BILKATOGO_STORE_ID?.trim() || undefined,
    productId,
    outDir: outDir ?? defaultOutDir(env, now),
    log: (line) => console.log(line),
    now: () => now,
  });
  return report.exitCode;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
