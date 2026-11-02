import { expect, test } from "vitest";
import { connect } from "./support/harness.ts";

// The fixed tool list. Adding a tool, and above all a write, must be a
// deliberate change to this test. #1 pinned eight tools; select_store and the
// four delivery tools were added at the user's request, list_categories by #10.
const EXPECTED_TOOLS: Record<string, "read-only" | "destructive" | "non-destructive write"> = {
  search_products: "read-only",
  get_product_details: "read-only",
  list_categories: "read-only",
  list_stores: "read-only",
  select_store: "non-destructive write",
  get_cart: "read-only",
  set_cart_quantity: "destructive",
  set_cart_quantities: "destructive",
  list_delivery_places: "read-only",
  set_delivery_place: "destructive",
  list_delivery_slots: "read-only",
  set_delivery_slot: "non-destructive write",
  get_order_history: "read-only",
  get_order_details: "read-only",
};

test("the server offers exactly the pinned tools", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(EXPECTED_TOOLS).sort());
});

test("read-only tools are flagged read-only, cart and place writes destructive, the rest neither", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const kinds = Object.fromEntries(
    tools.map((tool) => {
      const { readOnlyHint, destructiveHint } = tool.annotations ?? {};
      if (readOnlyHint === true && destructiveHint !== true) return [tool.name, "read-only"];
      if (readOnlyHint !== true && destructiveHint === true) return [tool.name, "destructive"];
      if (readOnlyHint === false && destructiveHint === false) {
        return [tool.name, "non-destructive write"];
      }
      return [tool.name, { readOnlyHint, destructiveHint }];
    }),
  );
  expect(kinds).toEqual(EXPECTED_TOOLS);
});

test("the cart setters and set_delivery_place are the only destructive tools", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  // MCP's defaults: a tool that isn't read-only counts as destructive unless it says otherwise.
  const destructive = tools.filter(
    (tool) =>
      tool.annotations?.readOnlyHint !== true && tool.annotations?.destructiveHint !== false,
  );
  expect(destructive.map((tool) => tool.name).sort()).toEqual([
    "set_cart_quantities",
    "set_cart_quantity",
    "set_delivery_place",
  ]);
});

test("select_store and set_delivery_slot are the only other tools that aren't read-only", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const writes = tools.filter((tool) => tool.annotations?.readOnlyHint !== true);
  expect(writes.map((tool) => tool.name).sort()).toEqual([
    "select_store",
    "set_cart_quantities",
    "set_cart_quantity",
    "set_delivery_place",
    "set_delivery_slot",
  ]);
});

test("no tool can place an order or touch payment", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  for (const tool of tools) {
    expect(tool.name).not.toMatch(/checkout|order_place|place_order|pay|card/i);
  }
});
