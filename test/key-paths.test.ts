// The key-path helper for reviewing captures (scripts/key-paths.ts).

import { describe, expect, it } from "vitest";
import { formatKeyPaths, keyPaths } from "../scripts/key-paths.ts";

const order = {
  order: {
    orderId: "900000000004",
    deliveryAddress: { location: "Bilka Eksempelby", order_pickup_code: "11223344" },
    lines: [
      { quantity: 1, product: { name: "Kaffe", price: 7533 } },
      { quantity: 2, product: { name: "Te", price: null }, children: [] },
    ],
    contact: "karen@example.com",
    stat: {},
  },
};

describe("keyPaths", () => {
  it("lists every distinct path once, merging array items", () => {
    expect(keyPaths(order)).toEqual([
      { path: "", types: ["object"], marks: [] },
      { path: "order", types: ["object"], marks: [] },
      { path: "order.contact", types: ["string"], marks: ["email-like"] },
      { path: "order.deliveryAddress", types: ["object"], marks: ["personal?"] },
      { path: "order.deliveryAddress.location", types: ["string"], marks: ["personal?"] },
      { path: "order.deliveryAddress.order_pickup_code", types: ["string"], marks: ["personal?"] },
      { path: "order.lines", types: ["array"], marks: [] },
      { path: "order.lines[]", types: ["object"], marks: [] },
      { path: "order.lines[].children", types: ["array (empty)"], marks: [] },
      { path: "order.lines[].product", types: ["object"], marks: [] },
      { path: "order.lines[].product.name", types: ["string"], marks: ["personal?"] },
      { path: "order.lines[].product.price", types: ["null", "number"], marks: [] },
      { path: "order.lines[].quantity", types: ["number"], marks: [] },
      { path: "order.orderId", types: ["string"], marks: [] },
      { path: "order.stat", types: ["object (empty)"], marks: [] },
    ]);
  });

  it("never prints a value", () => {
    const text = formatKeyPaths(keyPaths(order));

    for (const value of ["900000000004", "Eksempelby", "11223344", "Kaffe", "7533", "karen@"]) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain("order.deliveryAddress.order_pickup_code");
  });

  it("handles a top-level array and scalars", () => {
    expect(keyPaths([1, "a"])).toEqual([
      { path: "", types: ["array"], marks: [] },
      { path: "[]", types: ["number", "string"], marks: [] },
    ]);
  });
});
