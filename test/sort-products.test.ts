import { expect, test } from "vitest";
import type { FakeBilka } from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";

const PRICE_INDEX = "prod_r_BILKATOGO_PRODUCT_pricesort";

function sentIndexes(bilka: FakeBilka): string[] {
  return bilka.calls("algolia.query").map((request) => request.url.pathname.split("/")[3] ?? "");
}

function productIds(json: { products: { product_id: string }[] }): string[] {
  return json.products.map((product) => product.product_id);
}

/** Puts products in this week's leaflet, as Bilka would. */
function inLeaflet(bilka: FakeBilka, ...productIds: string[]): void {
  for (const product of bilka.products) {
    if (productIds.includes(product.objectID)) product.isInCurrentLeaflet = true;
  }
}

test("the leaflet in Mejeri & køl, cheapest first, comes in the store's price order", async () => {
  const { callTool, bilka } = await connect();
  // Both skyr are in the leaflet. Øko skyr has the higher list price (39,31)
  // but costs 25,00 at the store, so it's the cheaper of the two.
  inLeaflet(bilka, "19753", "128298");

  const result = await callTool("search_products", {
    category: "Mejeri & køl",
    only_leaflet: true,
    sort: "price",
  });

  expect(result.isError).toBe(false);
  expect(bilka.requests.map((r) => r.route)).toEqual(["algolia.query"]);
  expect(sentIndexes(bilka)).toEqual([PRICE_INDEX]);
  expect(productIds(result.json)).toEqual(["128298", "19753"]);
  expect(result.json.products.map((p: { price: number }) => p.price)).toEqual([25, 30.95]);
  expect(result.json).not.toHaveProperty("notes");
});

test("unit_price sorts by the store's unit price, with a product that has none last", async () => {
  const { callTool, bilka } = await connect();
  // The record says 0 for its unit price, so the sort index, ascending, ranks it first.
  const mozzarella = bilka.products.find((p) => p.objectID === "140787")!;
  mozzarella.unitOfMeasurePrice = 0;
  mozzarella.storeData["1653"].unitsOfMeasurePrice = 0;
  mozzarella.storeData["1653"].unitsOfMeasureShowPrice = 0;

  const result = await callTool("search_products", {
    category: "Mejeri & køl",
    only_in_stock: false,
    sort: "unit_price",
  });

  expect(result.isError).toBe(false);
  expect(sentIndexes(bilka)).toEqual(["prod_r_BILKATOGO_PRODUCT_uompricesort"]);
  expect(
    result.json.products.map((p: { product_id: string; unit_price: number | null }) => [
      p.product_id,
      p.unit_price,
    ]),
  ).toEqual([
    ["19753", 30.95],
    ["128298", 31.25],
    ["140787", null],
  ]);
});

test("products with the same store price keep the sort index's order", async () => {
  const { callTool, bilka } = await connect();
  // Same store price; the index ranks plain skyr (list 30,95) before øko (39,31).
  const skyr = bilka.products.find((p) => p.objectID === "19753")!;
  skyr.storeData["1653"].price = 2500;

  const result = await callTool("search_products", { category: "Mejeri & køl", sort: "price" });

  expect(productIds(result.json)).toEqual(["19753", "128298"]);
});

test("sorting a free-text search by price notes that price ranks above relevance", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("search_products", { query: "skyr", sort: "price" });

  expect(result.isError).toBe(false);
  expect(bilka.requests.map((r) => r.route)).toEqual(["algolia.query"]);
  expect(sentIndexes(bilka)).toEqual([PRICE_INDEX]);
  expect(result.json.notes).toHaveLength(1);
  expect(result.json.notes[0]).toMatch(/price/i);
  expect(result.json.notes[0]).toMatch(/relevan/i);
  expect(result.json.notes[0]).toMatch(/category/);
});

test.each([
  ["a category", { category: "Mejeri & køl" }],
  ["only_leaflet", { only_leaflet: true }],
  ["mix_offer_id", { mix_offer_id: "2680" }],
])("a sorted free-text search narrowed by %s has no note", async (_, narrowing) => {
  const { callTool } = await connect();

  const result = await callTool("search_products", {
    query: "skyr",
    sort: "unit_price",
    ...narrowing,
  });

  expect(result.isError).toBe(false);
  expect(result.json).not.toHaveProperty("notes");
});

test("relevance, the default, still searches the main index with no note", async () => {
  const { callTool, bilka } = await connect();

  const byDefault = await callTool("search_products", { query: "skyr" });
  const byName = await callTool("search_products", { query: "skyr", sort: "relevance" });

  expect(sentIndexes(bilka)).toEqual(["prod_BILKATOGO_PRODUCTS", "prod_BILKATOGO_PRODUCTS"]);
  expect(byDefault.json).not.toHaveProperty("notes");
  expect(byName.json).not.toHaveProperty("notes");
});

test("the tool description says sort works best with a category, the leaflet or a mix", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const tool = tools.find((t) => t.name === "search_products");
  expect(tool?.description).toMatch(
    /`sort` works best with a `category`, `only_leaflet` or `mix_offer_id`/,
  );
  expect(tool?.inputSchema.properties?.sort).toMatchObject({
    enum: ["relevance", "price", "unit_price"],
    default: "relevance",
  });
});
