import { expect, test } from "vitest";
import { ALGOLIA_APP_ID, ALGOLIA_SEARCH_KEY, type FakeBilka } from "./support/fake-bilka.ts";
import { connect, STORE_ID } from "./support/harness.ts";
import { loginFile } from "./support/login-file.ts";

type AlgoliaParams = { query: string; filters: string; hitsPerPage: number; page?: number };

/** The parameters of each Algolia query the fake received, in order. */
function algoliaQueries(bilka: FakeBilka): AlgoliaParams[] {
  return bilka.calls("algolia.query").map((request) => request.json() as AlgoliaParams);
}

function sentFilters(bilka: FakeBilka): string[] {
  const [params] = algoliaQueries(bilka);
  if (!params) throw new Error("no Algolia query was sent");
  return params.filters.split(" AND ");
}

test("search queries the BilkaToGo product index on Algolia for the configured store", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("search_products", { query: "skyr" });

  expect(result.isError).toBe(false);
  const [request] = bilka.calls("algolia.query");
  expect(request?.method).toBe("POST");
  expect(request?.url.href).toBe(
    "https://f9vbjlr1bk-dsn.algolia.net/1/indexes/prod_BILKATOGO_PRODUCTS/query",
  );
  expect(request?.headers.get("x-algolia-application-id")).toBe(ALGOLIA_APP_ID);
  expect(request?.headers.get("x-algolia-api-key")).toBe(ALGOLIA_SEARCH_KEY);
  expect(algoliaQueries(bilka)).toMatchObject([{ query: "skyr" }]);
  expect(sentFilters(bilka)).toContain(`isInAssortmentIn:${STORE_ID}`);
  expect(sentFilters(bilka)).toContain("nonsearchable:false");
});

test("each result has id, name, brand, size, prices in DKK, unit price and category", async () => {
  const { callTool } = await connect();

  const { json } = await callTool("search_products", { query: "skyr" });

  // Worked by hand from test/fixtures/algolia-products.json, store 1653.
  expect(json.products).toContainEqual({
    product_id: "19753",
    name: "Skyr m. vanilje 0,2% fedt u. tilsat sukker",
    brand: "Cheasy",
    size: "1 kg",
    price: 30.95,
    regular_price: null,
    saving: null,
    unit_price: 30.95,
    unit: "kg",
    on_offer: false,
    offer: null,
    offer_from: null,
    offer_until: null,
    in_leaflet: false,
    in_stock: true,
    category: "Mejeri & køl > Mejeri > Yoghurt & syrnede mælkeprodukter > Skyr",
    mix: null,
  });
});

test("a leaflet product says so, with the offer's dates at the store", async () => {
  const { callTool } = await connect();

  const { json } = await callTool("search_products", { only_leaflet: true });

  // Worked by hand from the live record in test/fixtures/algolia-products.json, store 1653.
  expect(json.products).toEqual([
    {
      product_id: "91454",
      name: "Ristorante Pizza Salame",
      brand: "Dr. Oetker",
      size: "640 g",
      price: 42,
      regular_price: 49.95,
      saving: 7.95,
      unit_price: 65.63,
      unit: "kg",
      on_offer: true,
      offer: "Spar 7,95",
      offer_from: "2026-10-23",
      offer_until: "2026-11-05",
      in_leaflet: true,
      in_stock: true,
      category: "Frost > Færdigretter på frost > Pizza",
      mix: null,
    },
  ]);
});

test("a discounted product shows its regular price, the saving and the offer text", async () => {
  const { callTool } = await connect();

  const { json } = await callTool("search_products", { query: "skyr" });

  const skyr = json.products.find((p: { product_id: string }) => p.product_id === "128298");
  expect(skyr).toMatchObject({
    name: "Skyr m. vanilje 0,2 % fedt øko",
    brand: "Salling ØKO",
    size: "800 g",
    price: 25,
    regular_price: 39.31,
    saving: 14.31,
    unit_price: 31.25,
    unit: "kg",
    on_offer: true,
    offer: "Skarp pris",
  });
});

test("a mix offer keeps the item price and shows the offer text", async () => {
  const { callTool } = await connect();

  const { json } = await callTool("search_products", { query: "bananer" });

  const bananas = json.products.find((p: { product_id: string }) => p.product_id === "18381");
  expect(bananas).toMatchObject({
    name: "Bananer",
    brand: null,
    price: 2.75,
    regular_price: null,
    saving: null,
    on_offer: true,
    offer: "Mix 10 for 25,00",
  });
});

test("by default search asks only for products in stock at the store, and leaves them out otherwise", async () => {
  const { callTool, bilka } = await connect();

  const { json } = await callTool("search_products", { query: "skyr" });

  expect(sentFilters(bilka)).toContain(`inStockStore:${STORE_ID}`);
  const ids = json.products.map((p: { product_id: string }) => p.product_id);
  expect(ids).not.toContain("140787"); // out of stock at 1653 in the fixture
  expect(json.products.every((p: { in_stock: boolean }) => p.in_stock)).toBe(true);
});

test("only_in_stock: false includes products that are out of stock", async () => {
  const { callTool, bilka } = await connect();

  const { json } = await callTool("search_products", { query: "skyr", only_in_stock: false });

  expect(sentFilters(bilka).some((f) => f.startsWith("inStockStore:"))).toBe(false);
  const mozzarella = json.products.find((p: { product_id: string }) => p.product_id === "140787");
  expect(mozzarella).toMatchObject({ in_stock: false, price: 14.35, unit_price: 71.75 });
  const chicken = json.products.find((p: { product_id: string }) => p.product_id === "169794");
  expect(chicken).toMatchObject({
    in_stock: false,
    price: 60,
    regular_price: 64.95,
    saving: 4.95,
    unit_price: 92.31,
    offer: "Spar 4,95",
  });
});

test("only_offers: true asks only for products on offer at the store", async () => {
  const { callTool, bilka } = await connect();

  const { json } = await callTool("search_products", { query: "skyr", only_offers: true });

  expect(sentFilters(bilka)).toContain(`isInOffer:${STORE_ID}`);
  expect(json.products.length).toBeGreaterThan(0);
  expect(json.products.every((p: { on_offer: boolean }) => p.on_offer)).toBe(true);
});

test("only_leaflet: true asks only for this week's Bilka Avisen, with the store filters", async () => {
  const { callTool, bilka } = await connect();

  const { json } = await callTool("search_products", { query: "pizza", only_leaflet: true });

  expect(sentFilters(bilka)).toEqual([
    `isInAssortmentIn:${STORE_ID}`,
    "nonsearchable:false",
    `inStockStore:${STORE_ID}`,
    "isInCurrentLeaflet:true",
  ]);
  expect(json.products.map((p: { product_id: string }) => p.product_id)).toEqual(["91454"]);
});

test("by default search doesn't filter on the leaflet", async () => {
  const { callTool, bilka } = await connect();

  await callTool("search_products", { query: "skyr" });

  expect(sentFilters(bilka).some((f) => f.startsWith("isInCurrentLeaflet"))).toBe(false);
});

test("by default search doesn't filter on offers", async () => {
  const { callTool, bilka } = await connect();

  await callTool("search_products", { query: "skyr" });

  expect(sentFilters(bilka).some((f) => f.startsWith("isInOffer:"))).toBe(false);
});

test("the result limit is passed on, and clamped to the maximum", async () => {
  const { callTool, bilka } = await connect({ limits: { maxSearchResults: 25 } });

  const small = await callTool("search_products", { query: "skyr", limit: 2 });
  await callTool("search_products", { query: "skyr", limit: 500 });

  expect(algoliaQueries(bilka).map((params) => params.hitsPerPage)).toEqual([2, 25]);
  expect(small.json.products).toHaveLength(2);
});

test("the default maximum number of results is 50", async () => {
  const { callTool, bilka } = await connect();

  await callTool("search_products", { query: "skyr", limit: 1000 });

  expect(algoliaQueries(bilka).map((params) => params.hitsPerPage)).toEqual([50]);
});

test("the first page is the default, and the answer says how many pages and results there are", async () => {
  const { callTool, bilka } = await connect();

  const { json } = await callTool("search_products", {
    query: "skyr",
    only_in_stock: false,
    limit: 4,
  });

  expect(algoliaQueries(bilka)).toMatchObject([{ page: 0, hitsPerPage: 4 }]);
  // The fixture index holds six products; none is filtered out without the stock filter.
  expect(json).toMatchObject({ page: 1, total_pages: 2, total_results: 6 });
  expect(json.products).toHaveLength(4);
});

test("page is 1-based: page 2 asks Algolia for its page 1 and returns the rest", async () => {
  const { callTool, bilka } = await connect();

  const { json } = await callTool("search_products", {
    query: "skyr",
    only_in_stock: false,
    limit: 4,
    page: 2,
  });

  expect(algoliaQueries(bilka)).toMatchObject([{ page: 1, hitsPerPage: 4 }]);
  expect(json).toMatchObject({ page: 2, total_pages: 2, total_results: 6 });
  expect(json.products.map((p: { product_id: string }) => p.product_id)).toEqual([
    "169794",
    "91454",
  ]);
});

test("a page past the last one comes back empty, with the totals", async () => {
  const { callTool } = await connect();

  const { json } = await callTool("search_products", {
    query: "skyr",
    only_in_stock: false,
    limit: 4,
    page: 5,
  });

  expect(json).toMatchObject({ page: 5, total_pages: 2, total_results: 6, products: [] });
});

test("a page below 1 is rejected before anything is sent", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("search_products", { query: "skyr", page: 0 });

  expect(result.isError).toBe(true);
  expect(bilka.requests).toEqual([]);
});

test("paging stops at page 20: a later page is rejected before anything is sent", async () => {
  const { callTool, bilka } = await connect();

  const last = await callTool("search_products", { query: "skyr", page: 20 });
  const beyond = await callTool("search_products", { query: "skyr", page: 21 });

  expect(last.isError).toBe(false);
  expect(beyond.isError).toBe(true);
  expect(beyond.text).toMatch(/20/);
  expect(algoliaQueries(bilka)).toMatchObject([{ page: 19 }]);
});

test("when there are more pages than the cap, the answer's notes say to narrow the search", async () => {
  const { callTool } = await connect({ limits: { maxSearchPage: 3 } });

  // The fixture index holds six products: one per page makes six pages, three of them served.
  const capped = await callTool("search_products", {
    query: "skyr",
    only_in_stock: false,
    limit: 1,
  });
  const fits = await callTool("search_products", {
    query: "skyr",
    only_in_stock: false,
    limit: 2,
  });

  expect(capped.json.total_pages).toBe(6);
  expect(capped.json.notes).toEqual([expect.stringMatching(/only pages 1 to 3/i)]);
  expect(fits.json.total_pages).toBe(3);
  expect(fits.json.notes).toBeUndefined();
});

test("the tool description says paging is capped and isn't for exporting the catalogue", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const search = tools.find((tool) => tool.name === "search_products");
  expect(search?.description).toMatch(/page 20/);
  expect(search?.description).toMatch(/not for (copying|exporting) the catalogue/);
});

test("search makes exactly one Algolia request and no Gigya or shop calls", async () => {
  const { callTool, bilka } = await connect();

  await callTool("search_products", { query: "havremælk" });

  expect(bilka.requests.map((r) => r.route)).toEqual(["algolia.query"]);
});

test("browsing the leaflet page by page makes one Algolia request per call and no Gigya or shop calls", async () => {
  const { callTool, bilka } = await connect();

  await callTool("search_products", { only_leaflet: true, limit: 1 });
  await callTool("search_products", { only_leaflet: true, limit: 1, page: 2 });

  expect(bilka.requests.map((r) => r.route)).toEqual(["algolia.query", "algolia.query"]);
});

test("the tool description tells the leaflet apart from everyday price labels", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const search = tools.find((tool) => tool.name === "search_products");
  expect(search?.description).toMatch(/only_leaflet[^.]*Bilka Avisen/);
  expect(search?.description).toMatch(/only_offers[^.]*Skarp pris/);
});

test("without a configured store, search returns a clear error pointing at the store list", async () => {
  const { callTool, bilka } = await connect({ storeId: undefined });

  const result = await callTool("search_products", { query: "havremælk" });

  expect(result.isError).toBe(true);
  expect(result.text).toContain("BILKATOGO_STORE_ID");
  expect(result.text).toContain("list_stores");
  expect(result.text).toContain("select_store");
  expect(bilka.requests).toEqual([]);
});

test("the store id can come from the login file", async () => {
  const file = await loginFile({ storeId: "1654" });
  const { callTool, bilka } = await connect({
    storeId: undefined,
    credentials: { env: {}, loginFile: file },
  });

  const result = await callTool("search_products", { query: "skyr" });

  expect(result.isError).toBe(false);
  expect(result.json.store_id).toBe("1654");
  expect(sentFilters(bilka)).toContain("isInAssortmentIn:1654");
});

test("BILKATOGO_STORE_ID wins over the login file's store id", async () => {
  const file = await loginFile({ storeId: "1654" });
  const { callTool, bilka } = await connect({
    storeId: undefined,
    credentials: { env: { BILKATOGO_STORE_ID: "1653" }, loginFile: file },
  });

  const result = await callTool("search_products", { query: "skyr" });

  expect(result.json.store_id).toBe("1653");
  expect(sentFilters(bilka)).toContain("isInAssortmentIn:1653");
});

test("the login file is read for the store id only when a tool needs the store", async () => {
  // Readable by others, so reading it leaves a warning behind.
  const file = await loginFile({ storeId: "1654" }, 0o644);
  const { client, callTool, warnings } = await connect({
    storeId: undefined,
    credentials: { env: {}, loginFile: file },
  });

  await client.listTools();
  expect(warnings).toEqual([]);

  expect((await callTool("search_products", { query: "skyr" })).isError).toBe(false);
  expect(warnings.join("\n")).toContain("chmod 600");
});

test("a store id that isn't a number is rejected before anything is sent", async () => {
  const { callTool, bilka } = await connect({ storeId: "1653 OR 1=1" });

  const result = await callTool("search_products", { query: "havremælk" });

  expect(result.isError).toBe(true);
  expect(result.text).toContain("BILKATOGO_STORE_ID");
  expect(bilka.requests).toEqual([]);
});

test("the leaflet can be browsed without a text query", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("search_products", { only_leaflet: true });

  expect(result.isError).toBe(false);
  expect(algoliaQueries(bilka)).toMatchObject([{ query: "" }]);
  expect(sentFilters(bilka)).toContain("isInCurrentLeaflet:true");
  expect(result.json.query).toBeNull();
  expect(result.json.products.map((p: { product_id: string }) => p.product_id)).toEqual(["91454"]);
});

test("offers can be browsed without a text query", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("search_products", { only_offers: true });

  expect(result.isError).toBe(false);
  expect(algoliaQueries(bilka)).toMatchObject([{ query: "" }]);
  expect(sentFilters(bilka)).toContain(`isInOffer:${STORE_ID}`);
});

test("without a query or a narrowing filter, search is rejected before anything is sent", async () => {
  const { callTool, bilka } = await connect();

  for (const args of [{}, { only_leaflet: false, only_offers: false }, { only_in_stock: false }]) {
    const result = await callTool("search_products", args);

    expect(result.isError).toBe(true);
    expect(result.text).toContain("query");
    expect(result.text).toContain("only_leaflet");
    expect(result.text).toContain("only_offers");
  }
  expect(bilka.requests).toEqual([]);
});

test("an empty query is rejected before anything is sent", async () => {
  const { callTool, bilka } = await connect();

  const result = await callTool("search_products", { query: "  " });

  expect(result.isError).toBe(true);
  expect(bilka.requests).toEqual([]);
});

test("the tool description says product text is untrusted data", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const search = tools.find((tool) => tool.name === "search_products");
  expect(search?.description).toMatch(/untrusted/i);
  expect(search?.description).toMatch(/not instructions/i);
});

test("a failing Algolia request is reported as a tool error", async () => {
  const { callTool, bilka } = await connect();
  bilka.failTimes("algolia.query", 1, 503);

  const result = await callTool("search_products", { query: "skyr" });

  expect(result.isError).toBe(true);
  expect(result.text).toContain("HTTP 503");
});

test("a timed-out Algolia request is reported as a tool error", async () => {
  const { callTool, bilka } = await connect();
  bilka.timeOut("algolia.query");

  const result = await callTool("search_products", { query: "skyr" });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/timed out/i);
});
