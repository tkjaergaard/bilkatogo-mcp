import { expect, test } from "vitest";
import { FakeBilka, jsonResponse, SALLING_API_KEY } from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";

test("get_alternatives lists Salling's alternatives with the store's prices, best match first", async () => {
  const { callTool } = await connect();

  const result = await callTool("get_alternatives", { product_id: "18381" });

  expect(result.isError).toBe(false);
  // Salling suggests 19753, 999999 and 128298 for the bananas. 999999 isn't in
  // the product index, so it's left out. Prices are store 1653's, as in
  // test/fixtures/algolia-products.json.
  expect(result.json).toMatchObject({
    store_id: "1653",
    product_id: "18381",
    alternatives: [
      {
        product_id: "19753",
        name: "Skyr m. vanilje 0,2% fedt u. tilsat sukker",
        price: 30.95,
        score: 0.76,
      },
      { product_id: "128298", name: "Skyr m. vanilje 0,2 % fedt øko", score: 0.63 },
    ],
  });
  expect(result.json.alternatives).toHaveLength(2);
});

test("get_alternatives asks Salling by the product's sku, with the shared key and no account id", async () => {
  const { callTool, bilka } = await connect();

  await callTool("get_alternatives", { product_id: "18381", limit: 5 });

  const [request, ...more] = bilka.calls("salling.alternatives");
  expect(more).toEqual([]);
  if (!request) throw new Error("Salling wasn't asked");
  // 18381's `article` in the product index is 89300500105.
  expect(request.url.pathname).toBe(
    "/v2/recommendations/alternative-products/bilkatogo/89300500105",
  );
  expect(request.headers.get("authorization")).toBe(`Bearer ${SALLING_API_KEY}`);
  expect(request.url.searchParams.get("limit")).toBe("5");
  expect(request.url.searchParams.has("customerId")).toBe(false);
  // No login: neither Gigya nor the shop is called.
  expect(bilka.calls("gigya.*")).toEqual([]);
  expect(bilka.calls("shop.*")).toEqual([]);
});

test("get_alternatives says so when the product isn't in the catalogue, without asking Salling", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("get_alternatives", { product_id: "999999" });

  expect(result.isError).toBe(true);
  expect(result.text).toContain("Product 999999 was not found");
  expect(bilka.calls("salling.*")).toEqual([]);
});

test("get_alternatives notes when Salling has no alternatives", async () => {
  const bilka = new FakeBilka();
  bilka.alternativesBySku = {};
  const { callTool } = await connect({ bilka });

  const result = await callTool("get_alternatives", { product_id: "18381" });

  expect(result.isError).toBe(false);
  expect(result.json).toMatchObject({
    alternatives: [],
    note: expect.stringContaining("no alternatives"),
  });
});

test("get_alternatives reports a Salling failure by its status alone", async () => {
  const bilka = new FakeBilka();
  bilka.script("salling.alternatives", () =>
    jsonResponse({ detail: "secret-looking text from Salling" }, 503),
  );
  const { callTool } = await connect({ bilka });

  const result = await callTool("get_alternatives", { product_id: "18381" });

  expect(result.isError).toBe(true);
  expect(result.text).toContain("Alternative products failed with HTTP 503");
  expect(result.text).not.toContain("secret-looking");
});
