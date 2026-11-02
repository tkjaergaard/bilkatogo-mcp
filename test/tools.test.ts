import { expect, test } from "vitest";
import { connect } from "./support/harness.ts";

// The fixed tool list. Adding a tool, and above all a write, must be a
// deliberate change to this test. #1 pinned eight tools; select_store and the
// four delivery tools were added at the user's request, list_categories by #10.
// Every tool that changes the cart (lines, place, slot) is destructive;
// select_store, which only changes this server's own setting, is the one
// non-destructive write; everything else is read-only (CLAUDE.md).
const EXPECTED_TOOLS: Record<string, "read-only" | "destructive" | "local-setting write"> = {
  search_products: "read-only",
  get_product_details: "read-only",
  list_categories: "read-only",
  list_stores: "read-only",
  select_store: "local-setting write",
  get_cart: "read-only",
  set_cart_quantity: "destructive",
  set_cart_quantities: "destructive",
  list_delivery_places: "read-only",
  set_delivery_place: "destructive",
  list_delivery_slots: "read-only",
  set_delivery_slot: "destructive",
  get_order_history: "read-only",
  get_order_details: "read-only",
};

test("the server offers exactly the pinned tools", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(EXPECTED_TOOLS).sort());
});

test("cart tools are flagged destructive, select_store a non-destructive write, the rest read-only", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const kinds = Object.fromEntries(
    tools.map((tool) => {
      const { readOnlyHint, destructiveHint } = tool.annotations ?? {};
      if (readOnlyHint === true && destructiveHint !== true) return [tool.name, "read-only"];
      if (readOnlyHint !== true && destructiveHint === true) return [tool.name, "destructive"];
      if (readOnlyHint === false && destructiveHint === false) {
        return [tool.name, "local-setting write"];
      }
      return [tool.name, { readOnlyHint, destructiveHint }];
    }),
  );
  expect(kinds).toEqual(EXPECTED_TOOLS);
});

test("the cart tools, its lines, place and slot, are the only destructive tools", async () => {
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
    "set_delivery_slot",
  ]);
});

test("select_store is the only other tool that isn't read-only", async () => {
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
