// The dev-only capture script (scripts/capture.ts), run against a fake Bilka.
// What matters most: no secret ever reaches the output or the saved files, the
// cart is never left changed, and LoginJWT never gets a cookie.

import { mkdtemp, readdir, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  classifyGigyaLogin,
  readCredentials,
  runCapture,
  type CaptureOptions,
} from "../scripts/capture.ts";

const EMAIL = "kunde@example.com";
const PASSWORD = "hunter2-very-secret";
const LOGIN_TOKEN = "st2.fake-login-token-abcdef";
const JWT = "eyFake.jwt-token.signature";
const PHPSESSID = "fake-phpsessid-123456";
const PRODUCT = "18381";

type Seen = { method: string; url: URL; headers: Headers; body: string };
type Handler = (request: Seen) => Response | undefined;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status: 200, ...init, headers });
}

/** A fake Bilka with a cart that ChangeLineCount really changes. */
function fakeBilka(options: { cart?: string[]; override?: Handler } = {}) {
  const cart = new Set(options.cart ?? []);
  const requests: Seen[] = [];
  const cartBody = () => ({
    stat: { price: 1200 },
    lines: [
      {
        headline: "Mejeri",
        lines: [
          {
            orderlines: [...cart].map((id) => ({ quantity: 1, product: { objectID: Number(id) } })),
          },
        ],
      },
    ],
    deliveryAddress: { location: "Bilka Eksempelby" },
  });
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const request: Seen = {
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
      body: init.body === undefined ? "" : String(init.body),
    };
    requests.push(request);
    const overridden = options.override?.(request);
    if (overridden) return overridden;
    const path = url.pathname;
    if (url.host.endsWith("algolia.net")) {
      return json({ hits: [{ objectID: PRODUCT, name: "Skyr" }], nbHits: 1 });
    }
    if (path === "/accounts.login") {
      return json({ errorCode: 0, UID: "uid-1", sessionInfo: { cookieValue: LOGIN_TOKEN } });
    }
    if (path === "/accounts.getJWT") return json({ errorCode: 0, id_token: JWT });
    if (path === "/api/auth/LoginJWT") {
      return json(
        { msg: "OK", uid: 900001 },
        {
          headers: [
            ["set-cookie", `PHPSESSID=${PHPSESSID}; path=/`],
            ["set-cookie", "cart=%7B%22cartID%22%3A1%7D; path=/; HttpOnly"],
          ],
        },
      );
    }
    if (request.headers.get("jwt_token") !== JWT)
      return json({ code: 1, msg: "Du er ikke logget ind" });
    if (path === "/api/shop/v6/Cart") return json(cartBody());
    if (path === "/api/shop/v6/ChangeLineCount") {
      const id = url.searchParams.get("productId") ?? "";
      const count = Number(url.searchParams.get("count"));
      if (count > 0) cart.add(id);
      else cart.delete(id);
      return json({ productId: id, productAmount: count, unitCount: cart.size, uid: 900001 });
    }
    if (path === "/api/shop/v7/OrderHistory") {
      return json({ total: 1, orders: [{ orderId: "900000000002", name: "Test Kunde" }] });
    }
    if (path === "/api/shop/v7/OrderDetails") {
      return json({ order: { orderId: url.searchParams.get("orderId") } });
    }
    return json({ error: "unknown" }, { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests, cart };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function capture(
  bilka: ReturnType<typeof fakeBilka>,
  overrides: Partial<CaptureOptions> = {},
) {
  const parent = await mkdtemp(join(tmpdir(), "bilka-capture-test-"));
  dirs.push(parent);
  const outDir = join(parent, "out");
  const lines: string[] = [];
  const report = await runCapture({
    fetch: bilka.fetch,
    credentials: { email: EMAIL, password: PASSWORD },
    storeId: "1653",
    productId: PRODUCT,
    outDir,
    log: (line) => lines.push(line),
    ...overrides,
  });
  const files: Record<string, string> = {};
  for (const name of await readdir(outDir).catch(() => [])) {
    files[name] = await readFile(join(outDir, name), "utf8");
  }
  return { report, output: lines.join("\n"), files, outDir };
}

const route = (request: Seen) => `${request.method} ${request.url.pathname}`;

describe("capture script", () => {
  it("runs every step in order and saves each response", async () => {
    const bilka = fakeBilka();
    const { report, files } = await capture(bilka);

    expect(bilka.requests.map(route)).toEqual([
      "POST /1/indexes/prod_BILKATOGO_PRODUCTS/query",
      "POST /accounts.login",
      "POST /accounts.getJWT",
      "GET /api/shop/v6/Cart",
      "POST /api/auth/LoginJWT",
      "GET /api/shop/v6/Cart",
      "GET /api/shop/v6/ChangeLineCount",
      "GET /api/shop/v6/ChangeLineCount",
      "GET /api/shop/v6/Cart",
      "POST /api/shop/v7/OrderHistory",
      "GET /api/shop/v7/OrderDetails",
    ]);
    expect(Object.keys(files).sort()).toEqual([
      "01-algolia-product.json",
      "02-gigya-accounts.login.json",
      "03-gigya-accounts.getJWT.json",
      "04-shop-v6-Cart-jwt-only.json",
      "05-auth-LoginJWT.json",
      "06-shop-v6-Cart.json",
      "07-shop-v6-ChangeLineCount-1.json",
      "08-shop-v6-ChangeLineCount-0.json",
      "09-shop-v6-Cart-after.json",
      "10-shop-v7-OrderHistory.json",
      "11-shop-v7-OrderDetails.json",
      "summary.json",
    ]);
    expect(report.exitCode).toBe(0);
    expect(report.login.passwordLogin).toBe("worked");
    expect(report.cartChange).toEqual({
      done: "set to 1 then back to 0",
      inCartAfter: false,
      cartLeftUnchanged: true,
    });
    expect(bilka.cart.size).toBe(0);
    expect(report.orders).toEqual({ count: 1, detailsFetched: true });
    expect(JSON.parse(files["11-shop-v7-OrderDetails.json"] ?? "")).toEqual({
      order: { orderId: "900000000002" },
    });
  });

  it("sends the request shapes the reference code uses", async () => {
    const bilka = fakeBilka();
    await capture(bilka);
    const [, login, getJwt, probe, loginJwt, cart, setOne, setZero, , history, details] =
      bilka.requests;

    expect(Object.fromEntries(new URLSearchParams(login?.body))).toEqual({
      loginID: EMAIL,
      password: PASSWORD,
      apiKey: expect.stringMatching(/^3_/),
      httpStatusCodes: "true",
    });
    expect(Object.fromEntries(new URLSearchParams(getJwt?.body))).toMatchObject({
      login_token: LOGIN_TOKEN,
      expiration: "86400",
    });
    for (const request of [probe, loginJwt, cart, setOne, history, details]) {
      expect(request?.headers.get("jwt_token")).toBe(JWT);
      expect(request?.url.searchParams.get("u")).toBe("w");
    }
    expect(cart?.url.searchParams.get("extra")).toBe("deliveryAddress,deliveryDate");
    expect(Object.fromEntries(setOne?.url.searchParams ?? [])).toEqual({
      u: "w",
      productId: PRODUCT,
      count: "1",
      fullCart: "0",
    });
    expect(setZero?.url.searchParams.get("count")).toBe("0");
    expect(Object.fromEntries(history?.url.searchParams ?? [])).toEqual({
      u: "w",
      limit: "5",
      offset: "0",
      muah: "1",
      ordertype: "dibs,pgw",
    });
  });

  it("never sends a cookie to LoginJWT or the JWT-only probe, then uses the session cookies", async () => {
    const bilka = fakeBilka({
      override: (request) =>
        request.url.pathname === "/api/shop/v6/Cart" && !request.headers.has("cookie")
          ? json({ lines: [] }, { headers: { "set-cookie": "cart=guest-cart-999; path=/" } })
          : undefined,
    });
    await capture(bilka);
    const probe = bilka.requests[3];
    const loginJwt = bilka.requests[4];
    const cart = bilka.requests[5];

    expect(probe?.headers.has("cookie")).toBe(false);
    expect(loginJwt?.headers.has("cookie")).toBe(false);
    expect(cart?.headers.get("cookie")).toBe(`PHPSESSID=${PHPSESSID}; cart=%7B%22cartID%22%3A1%7D`);
  });

  it("never prints or saves the password, login token, JWT or session cookie", async () => {
    const bilka = fakeBilka({
      override: (request) =>
        // A response that echoes secrets, to prove the masking holds.
        request.url.pathname === "/api/shop/v7/OrderDetails"
          ? json({ order: { note: `token ${LOGIN_TOKEN} jwt ${JWT}`, PHPSESSID } })
          : undefined,
    });
    const { output, files } = await capture(bilka);
    const everything = [output, ...Object.values(files)].join("\n");

    for (const secret of [PASSWORD, LOGIN_TOKEN, JWT, PHPSESSID]) {
      expect(everything).not.toContain(secret);
    }
    expect(output).not.toContain(EMAIL);
    expect(JSON.parse(files["02-gigya-accounts.login.json"] ?? "")).toEqual({
      errorCode: 0,
      UID: "uid-1",
      sessionInfo: { cookieValue: "<secret>" },
    });
    expect(JSON.parse(files["03-gigya-accounts.getJWT.json"] ?? "").id_token).toBe("<secret>");
  });

  it("keeps the capture folder and files private", async () => {
    const { outDir, files } = await capture(fakeBilka());

    expect((await stat(outDir)).mode & 0o777).toBe(0o700);
    for (const name of Object.keys(files)) {
      expect((await stat(join(outDir, name))).mode & 0o777).toBe(0o600);
    }
  });

  it("leaves the cart alone when the product is already in it", async () => {
    const bilka = fakeBilka({ cart: [PRODUCT] });
    const { report, output } = await capture(bilka);

    expect(bilka.requests.filter((r) => r.url.pathname.endsWith("ChangeLineCount"))).toEqual([]);
    expect(bilka.cart.has(PRODUCT)).toBe(true);
    expect(report.cartChange.done).toBe("skipped");
    expect(report.exitCode).toBe(0);
    expect(output).toContain("already in the cart");
  });

  it("skips the cart change when the product isn't sold at the store", async () => {
    const bilka = fakeBilka({
      override: (request) =>
        request.url.host.endsWith("algolia.net") ? json({ hits: [] }) : undefined,
    });
    const { report } = await capture(bilka);

    expect(bilka.requests.some((r) => r.url.pathname.endsWith("ChangeLineCount"))).toBe(false);
    expect(report.cartChange.reason).toBe("product 18381 was not found at store 1653");
  });

  it("still sets the line back to 0 when setting it to 1 fails", async () => {
    let first = true;
    const bilka = fakeBilka({
      override: (request) => {
        if (request.url.pathname.endsWith("ChangeLineCount") && first) {
          first = false;
          throw new DOMException("The operation timed out.", "TimeoutError");
        }
        return undefined;
      },
    });
    const { report } = await capture(bilka);

    const counts = bilka.requests
      .filter((r) => r.url.pathname.endsWith("ChangeLineCount"))
      .map((r) => r.url.searchParams.get("count"));
    expect(counts).toEqual(["1", "0"]);
    expect(report.cartChange.cartLeftUnchanged).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("warns loudly when the product is still in the cart afterwards", async () => {
    const bilka = fakeBilka({
      override: (request) =>
        request.url.searchParams.get("count") === "0" ? json({ code: 2, msg: "Fejl" }) : undefined,
    });
    const { report, output } = await capture(bilka);

    expect(report.cartChange).toMatchObject({ inCartAfter: true, cartLeftUnchanged: false });
    expect(report.exitCode).toBe(3);
    expect(output).toContain("WARNING");
  });

  it("records CAPTCHA on password login and stops before the shop", async () => {
    const bilka = fakeBilka({
      override: (request) =>
        request.url.pathname === "/accounts.login"
          ? json(
              { errorCode: 401020, errorMessage: "Captcha required", statusCode: 401 },
              { status: 401 },
            )
          : undefined,
    });
    const { report, output, files } = await capture(bilka);

    expect(report.login).toMatchObject({
      passwordLogin: "blocked: CAPTCHA or bot protection",
      gigyaErrorCode: 401020,
    });
    expect(bilka.requests.some((r) => r.url.host === "api.bilkatogo.dk")).toBe(false);
    expect(report.exitCode).toBe(2);
    expect(output).toContain("Password login: blocked: CAPTCHA or bot protection");
    expect(JSON.parse(files["summary.json"] ?? "").login.passwordLogin).toBe(
      "blocked: CAPTCHA or bot protection",
    );
  });

  it("skips password login when a login token is given", async () => {
    const bilka = fakeBilka();
    const { report, output } = await capture(bilka, {
      credentials: { loginToken: LOGIN_TOKEN },
    });

    expect(bilka.requests.some((r) => r.url.pathname === "/accounts.login")).toBe(false);
    expect(report.login).toEqual({ source: "login token", passwordLogin: "not tried" });
    expect(report.exitCode).toBe(0);
    expect(output).toContain("not tried (BILKATOGO_LOGIN_TOKEN is set)");
  });

  it("refuses to write inside the repo and makes no request", async () => {
    const bilka = fakeBilka();
    const lines: string[] = [];
    const report = await runCapture({
      fetch: bilka.fetch,
      credentials: { loginToken: LOGIN_TOKEN },
      productId: PRODUCT,
      outDir: join(REPO_ROOT, "captures"),
      log: (line) => lines.push(line),
    });

    expect(report.exitCode).toBe(64);
    expect(lines.join("\n")).toContain("inside the repo");
    expect(bilka.requests).toEqual([]);
  });

  it("refuses to run without credentials", async () => {
    const bilka = fakeBilka();
    const { report } = await capture(bilka, { credentials: {} });

    expect(report.exitCode).toBe(2);
    expect(bilka.requests).toEqual([]);
  });
});

describe("classifyGigyaLogin", () => {
  const answer = (status: number, body: unknown) => ({ status, headers: new Headers(), body });

  it.each([
    [answer(403, { errorCode: 403042, errorMessage: "Invalid LoginID" }), "invalid credentials"],
    [
      answer(400, { errorCode: 400006, errorMessage: "Risk assessment block" }),
      "blocked: CAPTCHA or bot protection",
    ],
    [answer(403, undefined), "blocked: CAPTCHA or bot protection"],
    [
      answer(403, { errorCode: 403120, errorMessage: "Account temporarily locked out" }),
      "blocked: account locked",
    ],
    [answer(500, { errorCode: 500001, errorMessage: "General Server Error" }), "failed"],
  ])("classifies %#", (input, expected) => {
    expect(classifyGigyaLogin(input).result).toBe(expected);
  });
});

describe("readCredentials", () => {
  it("prefers the environment and fills the rest from login.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bilka-login-test-"));
    dirs.push(dir);
    const file = join(dir, "login.json");
    await writeFile(file, JSON.stringify({ email: "file@example.com", password: "from-file" }));
    await chmod(file, 0o644);
    const warnings: string[] = [];

    const credentials = await readCredentials({ BILKATOGO_EMAIL: EMAIL }, file, (line) =>
      warnings.push(line),
    );

    expect(credentials).toEqual({ email: EMAIL, password: "from-file", loginToken: undefined });
    expect(warnings.join("\n")).toContain("chmod 600");
    expect(warnings.join("\n")).not.toContain("from-file");
  });
});
