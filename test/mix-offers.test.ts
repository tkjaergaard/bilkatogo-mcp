import { expect, test } from "vitest";
import { type FakeBilka, loadFixture } from "./support/fake-bilka.ts";
import { connect, STORE_ID } from "./support/harness.ts";

type Product = { product_id: string; mix: unknown };

/**
 * Live mix products (test/fixtures/algolia-mix-products.json) added to the
 * fake index: Pærer, in the bananas' "Mix 10 for 25,00"; Æbler, in the same
 * mix at store 1661 but not at 1653; Pizzadej and Pølsehornsdej, "3 for 2".
 */
async function connectWithMixes(options: Parameters<typeof connect>[0] = {}) {
  const connection = await connect(options);
  connection.bilka.products.push(...loadFixture("algolia-mix-products.json").hits);
  return connection;
}

function ids(products: Product[]): string[] {
  return products.map((product) => product.product_id);
}

function sentFilters(bilka: FakeBilka): string[][] {
  return bilka
    .calls("algolia.query")
    .map((request) => (request.json() as { filters: string }).filters.split(" AND "));
}

test("a product in a mix leads to the other products that count towards it", async () => {
  const { callTool, bilka } = await connectWithMixes();

  const search = await callTool("search_products", { query: "bananer" });
  const bananas = search.json.products.find((p: Product) => p.product_id === "18381");
  expect(bananas.mix).toEqual({ mix_offer_id: "2680", items: 10, price: 25 });

  const mix = await callTool("search_products", { mix_offer_id: bananas.mix.mix_offer_id });

  expect(mix.isError).toBe(false);
  expect(sentFilters(bilka)[1]).toContain("multipromos:2680");
  // Æbler is in mix 2680 too, but not at store 1653.
  expect(ids(mix.json.products)).toEqual(["18381", "50998"]);
  expect(bilka.requests.map((request) => request.route)).toEqual([
    "algolia.query",
    "algolia.query",
  ]);
});

test('a "3 for 2" mix has no price, but still shows its items and offer text', async () => {
  const { callTool } = await connectWithMixes();

  const { json } = await callTool("search_products", { mix_offer_id: "11220188" });

  // Worked by hand from the live records in test/fixtures/algolia-mix-products.json, store 1653.
  expect(json.products).toEqual([
    expect.objectContaining({
      product_id: "81452",
      name: "Pizzadej",
      price: 10.95,
      offer: "3 for 2",
      mix: { mix_offer_id: "11220188", items: 3, price: null },
    }),
    expect.objectContaining({
      product_id: "81451",
      name: "Pølsehornsdej",
      price: 11.95,
      offer: "3 for 2",
      mix: { mix_offer_id: "11220188", items: 3, price: null },
    }),
  ]);
});

test("a product with a mix id but no offer text at the store has no mix there", async () => {
  const atStore = await connectWithMixes();
  const elsewhere = await connectWithMixes({ storeId: "1661" });

  const here = await atStore.callTool("get_product_details", { product_id: "18379" });
  const there = await elsewhere.callTool("get_product_details", { product_id: "18379" });

  // Æbler is in mix 2680 at store 1661 only (test/fixtures/README.md).
  expect(here.json.product).toMatchObject({ name: "Æbler", offer: null, mix: null });
  expect(there.json.product).toMatchObject({
    offer: "Mix 10 for 25,00",
    mix: { mix_offer_id: "2680", items: 10, price: 25 },
  });
});

test("get_product_details shows the mix at the store, and none without a store", async () => {
  const withStore = await connectWithMixes();
  const withoutStore = await connectWithMixes({ storeId: undefined });

  const details = await withStore.callTool("get_product_details", { product_id: "50998" });
  const national = await withoutStore.callTool("get_product_details", { product_id: "50998" });

  expect(details.json.product).toMatchObject({
    name: "Pærer",
    price: 3,
    offer: "Mix 10 for 25,00",
    mix: { mix_offer_id: "2680", items: 10, price: 25 },
  });
  expect(national.json.product.mix).toBeNull();
  expect(withStore.bilka.requests.map((request) => request.route)).toEqual(["algolia.objects"]);
});

test("a mix lists only products with the offer at the selected store, even out of stock", async () => {
  const { callTool, bilka } = await connectWithMixes();

  const { json } = await callTool("search_products", {
    mix_offer_id: "2680",
    only_in_stock: false,
  });

  expect(sentFilters(bilka)[0]).toEqual(
    expect.arrayContaining([`isInOffer:${STORE_ID}`, "multipromos:2680"]),
  );
  expect(ids(json.products)).not.toContain("18379");
  expect(json.total_results).toBe(2);
});

test("a mix offer id that isn't all digits is rejected before anything is sent", async () => {
  const { callTool, bilka } = await connectWithMixes();

  for (const mix_offer_id of ["2680 OR isInOffer:1661", "26a0", "", "-1", '2680"', "1.5"]) {
    const result = await callTool("search_products", { mix_offer_id });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("mix_offer_id");
  }
  expect(bilka.requests).toEqual([]);
});

test("a mix offer id of any length is accepted", async () => {
  const { callTool, bilka } = await connectWithMixes();

  const result = await callTool("search_products", { mix_offer_id: " 112201880042 " });

  expect(result.isError).toBe(false);
  expect(sentFilters(bilka)[0]).toContain("multipromos:112201880042");
});

test("the tool description treats mix texts as data and explains how to fill a mix", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const search = tools.find((tool) => tool.name === "search_products");
  expect(search?.description).toMatch(/mix texts?[^.]*untrusted/i);
  expect(search?.description).toMatch(/mix\.mix_offer_id[^.]*mix_offer_id/);
});

test("the error for a search without a query or filter names mix_offer_id", async () => {
  const { callTool } = await connect();

  const result = await callTool("search_products", {});

  expect(result.isError).toBe(true);
  expect(result.text).toContain("mix_offer_id");
});
