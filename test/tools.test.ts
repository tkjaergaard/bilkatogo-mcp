import { expect, test } from "vitest";
import { connect } from "./support/harness.ts";

// The fixed tool list. Adding a tool, and above all a write, must be a
// deliberate change to this test. Later tickets extend it.
const EXPECTED_TOOLS: Record<string, "read-only" | "destructive"> = {
  search_products: "read-only",
  get_product_details: "read-only",
  list_stores: "read-only",
  get_cart: "read-only",
  set_cart_quantity: "destructive",
  set_cart_quantities: "destructive",
  get_order_history: "read-only",
  get_order_details: "read-only",
};

test("the server offers exactly the pinned tools", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(EXPECTED_TOOLS).sort());
});

test("read-only tools are flagged read-only and writes are flagged destructive", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const kinds = Object.fromEntries(
    tools.map((tool) => {
      const { readOnlyHint, destructiveHint } = tool.annotations ?? {};
      if (readOnlyHint === true && destructiveHint !== true) return [tool.name, "read-only"];
      if (readOnlyHint !== true && destructiveHint === true) return [tool.name, "destructive"];
      return [tool.name, { readOnlyHint, destructiveHint }];
    }),
  );
  expect(kinds).toEqual(EXPECTED_TOOLS);
});

test("the cart setters are the only tools that write", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const writes = tools.filter((tool) => tool.annotations?.readOnlyHint !== true);
  expect(writes.map((tool) => tool.name).sort()).toEqual([
    "set_cart_quantities",
    "set_cart_quantity",
  ]);
});

test("no tool can place an order or touch payment", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  for (const tool of tools) {
    expect(tool.name).not.toMatch(/checkout|order_place|place_order|pay|card/i);
  }
});
