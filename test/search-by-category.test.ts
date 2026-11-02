import { expect, test } from "vitest";
import type { FakeBilka } from "./support/fake-bilka.ts";
import { connect, STORE_ID } from "./support/harness.ts";

function sentFilters(bilka: FakeBilka): string[] {
  const [request] = bilka.calls("algolia.query");
  if (!request) throw new Error("no Algolia query was sent");
  return (request.json() as { filters: string }).filters.split(" AND ");
}

function productIds(json: { products: { product_id: string }[] }): string[] {
  return json.products.map((product) => product.product_id);
}

test("a product's own category is a valid category filter, sent at its level", async () => {
  const { callTool, bilka } = await connect();
  const { json: found } = await callTool("search_products", { query: "skyr" });
  const skyr = found.products.find((p: { product_id: string }) => p.product_id === "19753");
  bilka.requests.length = 0;

  const result = await callTool("search_products", { category: skyr.category });

  expect(result.isError).toBe(false);
  expect(sentFilters(bilka)).toContain(
    'consumerFacingHierarchy.lvl3:"Mejeri & køl > Mejeri > Yoghurt & syrnede mælkeprodukter > Skyr"',
  );
  expect(productIds(result.json)).toEqual(["19753", "128298"]);
});

test("a category with five levels, the deepest Bilka has, is sent as level 4", async () => {
  const { callTool, bilka } = await connect();

  const category = "Tøj & sko > Børnetøj > Overdel > Toppe > Toppe Langærmet";
  const result = await callTool("search_products", { category });

  expect(result.isError).toBe(false);
  expect(sentFilters(bilka)).toContain(`consumerFacingHierarchy.lvl4:"${category}"`);
  expect(result.json.total_results).toBe(0);
});

test("a category combines with query, only_leaflet and only_offers in the one request", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("search_products", {
    query: "pizza",
    category: "Frost",
    only_leaflet: true,
    only_offers: true,
  });

  expect(bilka.requests.map((r) => r.route)).toEqual(["algolia.query"]);
  expect(bilka.calls("algolia.query")[0]?.json()).toMatchObject({ query: "pizza" });
  expect(sentFilters(bilka)).toEqual([
    `isInAssortmentIn:${STORE_ID}`,
    "nonsearchable:false",
    `inStockStore:${STORE_ID}`,
    `isInOffer:${STORE_ID}`,
    "isInCurrentLeaflet:true",
    'consumerFacingHierarchy.lvl0:"Frost"',
  ]);
  expect(productIds(result.json)).toEqual(["91454"]);
});

test("a category is enough to browse without a query", async () => {
  const { callTool } = await connect();

  const result = await callTool("search_products", { category: "Frugt & grønt > Frugt" });

  expect(result.isError).toBe(false);
  expect(result.json.query).toBeNull();
  expect(productIds(result.json)).toEqual(["18381"]);
});

test.each([
  ["a double quote", 'Frost" OR isInOffer:1653 OR x:"y'],
  ["a backslash", "Frost\\"],
  ["six levels", "a > b > c > d > e > f"],
  ["an empty level", "Frost >  > Pizza"],
])("a category with %s is rejected before anything is sent", async (_, category) => {
  const { callTool, bilka } = await connect();

  const result = await callTool("search_products", { category });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/list_categories/);
  expect(bilka.requests).toEqual([]);
});

test("the tool description says a product's category is a valid category filter", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const tool = tools.find((t) => t.name === "search_products");
  expect(tool?.description).toMatch(/category/);
  expect(tool?.description).toMatch(/list_categories/);
  expect(tool?.description).toMatch(/category names/i);
});
