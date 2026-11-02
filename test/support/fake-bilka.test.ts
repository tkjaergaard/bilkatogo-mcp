// Checks the fake's own scripting, which later tickets rely on.

import { expect, test } from "vitest";
import {
  ALGOLIA_APP_ID,
  ALGOLIA_SEARCH_KEY,
  FakeBilka,
  GIGYA_API_KEY,
  JWT,
  LOGIN_TOKEN,
  loadFixture,
  routeOf,
} from "./fake-bilka.ts";

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
  expect(await (await cart("other-jwt")).json()).toEqual(loadFixture("shop-not-logged-in.json"));
});

test("ChangeLineCount replays the capture: product 156353 set to 1, then to 0", async () => {
  // The capture's cart held only the two fees; 156353 costs 13,00 kr.
  const bilka = new FakeBilka();
  bilka.products.push({ objectID: "156353", name: "Captured product", price: 1300 });
  const setTo = async (count: number) =>
    (
      await bilka.fetch(
        `https://api.bilkatogo.dk/api/shop/v6/ChangeLineCount?u=w&productId=156353&count=${count}&fullCart=0`,
        { headers: { jwt_token: JWT } },
      )
    ).json();

  expect(await setTo(1)).toEqual(loadFixture("shop-change-line-count.json"));
  expect(bilka.cart.stat).toMatchObject({ price: 9100, amount: 3 });
  expect(await setTo(0)).toEqual(loadFixture("shop-change-line-count-zero.json"));
  expect(bilka.cart).toEqual(loadFixture("shop-cart.json"));
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
    expect(await response.json()).toEqual(loadFixture("shop-not-logged-in.json"));
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

test("Algolia filters take quoted values with spaces, & and ' > ', and refuse what they can't parse", async () => {
  const bilka = new FakeBilka();
  const query = (filters: string) =>
    bilka.fetch("https://f9vbjlr1bk-dsn.algolia.net/1/indexes/prod_BILKATOGO_PRODUCTS/query", {
      method: "POST",
      headers: {
        "x-algolia-application-id": ALGOLIA_APP_ID,
        "x-algolia-api-key": ALGOLIA_SEARCH_KEY,
      },
      body: JSON.stringify({ filters, attributesToRetrieve: ["objectID"] }),
    });

  const found = await (
    await query('consumerFacingHierarchy.lvl1:"Mejeri & køl > Mejeri" AND inStockStore:1653')
  ).json();
  expect(found.hits.map((hit: { objectID: string }) => hit.objectID)).toEqual(["19753", "128298"]);
  await expect(query('consumerFacingHierarchy.lvl0:"Frost\\" OR x:"y"')).rejects.toThrow(
    /can't parse/,
  );
  await expect(query("inStockStore:1653 AND")).rejects.toThrow(/can't parse/);
});

test("Algolia answers the two sort indexes off a non-store key, and any other index 404", async () => {
  const bilka = new FakeBilka();
  const query = (index: string) =>
    bilka.fetch(`https://f9vbjlr1bk-dsn.algolia.net/1/indexes/${index}/query`, {
      method: "POST",
      headers: {
        "x-algolia-application-id": ALGOLIA_APP_ID,
        "x-algolia-api-key": ALGOLIA_SEARCH_KEY,
      },
      body: JSON.stringify({
        filters: 'consumerFacingHierarchy.lvl0:"Mejeri & køl"',
        attributesToRetrieve: ["objectID"],
      }),
    });
  const ids = async (index: string) =>
    (await (await query(index)).json()).hits.map((hit: { objectID: string }) => hit.objectID);

  // List prices 30,95 / 39,31 / 14,35; øko skyr costs 25,00 at 1653, which the key ignores.
  expect(await ids("prod_r_BILKATOGO_PRODUCT_pricesort")).toEqual(["140787", "19753", "128298"]);
  // Unit prices 30,95 / 49,14 / 71,75 per kg.
  expect(await ids("prod_r_BILKATOGO_PRODUCT_uompricesort")).toEqual(["19753", "128298", "140787"]);
  expect((await query("prod_r_BILKATOGO_PRODUCT_savingsort")).status).toBe(404);
});
