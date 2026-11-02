// Checks the fake's own scripting, which later tickets rely on.

import { expect, test } from "vitest";
import { FakeBilka, GIGYA_API_KEY, JWT, LOGIN_TOKEN, routeOf } from "./fake-bilka.ts";

test("requests are routed by URL to Algolia, Gigya and shop routes", () => {
  expect(
    routeOf(new URL("https://f9vbjlr1bk-dsn.algolia.net/1/indexes/prod_BILKATOGO_PRODUCTS/query")),
  ).toBe("algolia.query");
  expect(routeOf(new URL("https://F9VBJLR1BK-dsn.algolia.net/1/indexes/*/objects"))).toBe(
    "algolia.objects",
  );
  expect(routeOf(new URL("https://accounts.eu1.gigya.com/accounts.login"))).toBe("gigya.login");
  expect(routeOf(new URL("https://accounts.eu1.gigya.com/accounts.getJWT"))).toBe("gigya.getJWT");
  expect(routeOf(new URL("https://api.bilkatogo.dk/api/shop/v6/Cart?u=w"))).toBe("shop.Cart");
  expect(routeOf(new URL("https://example.com/"))).toBe("unknown");
});

test("failTimes fails N requests with the status, then the default handler answers", async () => {
  const bilka = new FakeBilka().failTimes("shop.Cart", 2, 429);
  const url = "https://api.bilkatogo.dk/api/shop/v6/Cart?u=w";
  const init = { headers: { jwt_token: JWT } };

  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await bilka.fetch(url, init)).status);

  expect(statuses).toEqual([429, 429, 200]);
  expect(bilka.calls("shop.*")).toHaveLength(3);
});

test("the JWT exchange accepts the fixture login token and the cart wants its JWT", async () => {
  const bilka = new FakeBilka();
  const exchange = (loginToken: string) =>
    bilka.fetch("https://accounts.eu1.gigya.com/accounts.getJWT", {
      method: "POST",
      body: new URLSearchParams({ apiKey: GIGYA_API_KEY, login_token: loginToken }),
    });
  const cart = (jwt: string) =>
    bilka.fetch("https://api.bilkatogo.dk/api/shop/v6/Cart?u=w", { headers: { jwt_token: jwt } });

  expect(await (await exchange(LOGIN_TOKEN)).json()).toMatchObject({ errorCode: 0, id_token: JWT });
  expect((await exchange("other-token")).status).toBe(403);
  expect(await (await cart(JWT)).json()).toMatchObject({ stat: { price: 7800 } });
  expect(await (await cart("other-jwt")).json()).toEqual({ code: 1, msg: "Du er ikke logget ind" });
});

test("timeOut makes fetch reject as an expired timeout signal would", async () => {
  const bilka = new FakeBilka().timeOut("gigya.getJWT");

  const error = await bilka
    .fetch("https://accounts.eu1.gigya.com/accounts.getJWT", { method: "POST" })
    .catch((e: unknown) => e);

  expect(error).toBeInstanceOf(DOMException);
  expect((error as DOMException).name).toBe("TimeoutError");
});

test("rejectJwt answers every shop call as not logged in", async () => {
  const bilka = new FakeBilka().rejectJwt();

  for (const endpoint of ["v6/Cart", "v7/OrderHistory"]) {
    const response = await bilka.fetch(`https://api.bilkatogo.dk/api/shop/${endpoint}?u=w`);
    expect(await response.json()).toEqual({ code: 1, msg: "Du er ikke logget ind" });
  }
});

test("rejectPasswordLogin answers Gigya's login as an invalid login", async () => {
  const bilka = new FakeBilka().rejectPasswordLogin();

  const response = await bilka.fetch("https://accounts.eu1.gigya.com/accounts.login", {
    method: "POST",
    body: new URLSearchParams({ loginID: "a@example.com", password: "x" }),
  });

  expect(await response.json()).toMatchObject({ errorCode: 403042 });
  expect(bilka.calls("gigya.login")[0]?.form().get("loginID")).toBe("a@example.com");
});

test("requests to unknown hosts are recorded and answered 404", async () => {
  const bilka = new FakeBilka();

  const response = await bilka.fetch("https://example.com/");

  expect(response.status).toBe(404);
  expect(bilka.requests.map((r) => r.route)).toEqual(["unknown"]);
});
