import { expect, test } from "vitest";
import { FakeBilka, jsonResponse, LOGIN_TOKEN, SALLING_API_KEY } from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";

const withLoginToken = { credentials: { env: { BILKATOGO_LOGIN_TOKEN: LOGIN_TOKEN } } };

test("get_most_bought lists what the account buys most, with the store's prices", async () => {
  const { callTool } = await connect(withLoginToken);

  const result = await callTool("get_most_bought");

  expect(result.isError).toBe(false);
  // Salling's list for the account is 18381, 999999 and 19753. 999999 isn't
  // in the product index, so it's left out. Prices are store 1653's.
  expect(result.json).toMatchObject({
    store_id: "1653",
    personalized: true,
    products: [
      { product_id: "18381", name: "Bananer" },
      { product_id: "19753", name: "Skyr m. vanilje 0,2% fedt u. tilsat sukker", price: 30.95 },
    ],
  });
  expect(result.json.products).toHaveLength(2);
  expect(result.json).not.toHaveProperty("note");
});

test("get_most_bought asks Salling with the shared key and the account's tid, never showing the tid", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("get_most_bought", { limit: 7 });

  const [request, ...more] = bilka.calls("salling.mostBought");
  expect(more).toEqual([]);
  if (!request) throw new Error("Salling wasn't asked");
  expect(request.headers.get("authorization")).toBe(`Bearer ${SALLING_API_KEY}`);
  // The tid in test/fixtures/shop-cart.json.
  expect(request.url.searchParams.get("customerId")).toBe("test-tid");
  expect(request.url.searchParams.get("limit")).toBe("7");
  expect(result.text).not.toContain("test-tid");
});

test("get_most_bought reads the tid once per session", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  await callTool("get_most_bought");
  await callTool("get_most_bought");

  expect(bilka.calls("shop.*")).toHaveLength(1);
  expect(bilka.calls("salling.mostBought")).toHaveLength(2);
});

test("get_most_bought flags the shop's bestsellers when Salling has no list for the account", async () => {
  const bilka = new FakeBilka();
  bilka.mostBoughtByCustomer = {};
  const { callTool } = await connect({ ...withLoginToken, bilka });

  const result = await callTool("get_most_bought");

  expect(result.isError).toBe(false);
  expect(result.json).toMatchObject({
    personalized: false,
    products: [{ product_id: "19753" }],
    note: expect.stringContaining("not the account's own"),
  });
});

test("get_most_bought needs a login and asks Salling nothing without one", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("get_most_bought");

  expect(result.isError).toBe(true);
  expect(result.text).toContain("No BilkaToGo login is configured");
  expect(bilka.calls("salling.*")).toEqual([]);
});

test("get_most_bought reports a Salling failure without the tid or Salling's text", async () => {
  const bilka = new FakeBilka();
  bilka.script("salling.mostBought", () =>
    jsonResponse({ detail: "customerId test-tid rejected" }, 503),
  );
  const { callTool, warnings } = await connect({ ...withLoginToken, bilka });

  const result = await callTool("get_most_bought");

  expect(result.isError).toBe(true);
  expect(result.text).toContain("Most bought products failed with HTTP 503");
  expect(result.text).not.toContain("test-tid");
  expect(warnings.join("\n")).not.toContain("test-tid");
});
