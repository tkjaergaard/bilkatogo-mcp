// Cart answers for tests, built from the scrubbed captures. The captured cart
// (`shop-cart.json`) holds only the two service lines, so grocery lines are
// taken from `shop-order-details.json`, which has the same
// `lines[].lines[].orderlines[]` shape.

import { loadFixture } from "./fake-bilka.ts";

/**
 * The captured cart's `delivery`, worked by hand from shop-cart.json: home
 * delivery from store 1654 with a 500 kr. minimum, and a past slot Bilka
 * marks closed.
 */
export const CAPTURED_DELIVERY = {
  place: {
    place_id: "home",
    kind: "home_delivery",
    name: null,
    store_id: "1654",
    minimum_order: 500,
  },
  slot: {
    date: "2026-07-27",
    start: "18:00",
    end: "22:00",
    text: "Man. 27/07. kl. 18:00 - 22:00",
    available: false,
  },
};

/** A grocery order line from the captured order, with a new quantity and an optional customer note. */
function groceryLine(productId: number, quantity: number, comment = ""): Record<string, any> {
  const order = loadFixture("shop-order-details.json").order;
  for (const group of order.lines) {
    for (const line of group.lines) {
      for (const orderline of line.orderlines) {
        if (orderline.product.objectID === productId) {
          return {
            ...structuredClone(orderline),
            quantity,
            amount: orderline.unitprice * quantity,
            comment,
          };
        }
      }
    }
  }
  throw new Error(`no line for product ${productId} in shop-order-details.json`);
}

/**
 * The captured cart plus two grocery lines: 2 × Pitabrød (22,01 kr.) in
 * "Frost" and 1 × Tun i vand (15,11 kr.) in "Kolonial", the tuna with a
 * personal note. Total 44,02 + 15,11 + 78,00 in fees = 137,13 kr.
 */
export function groceryCart(): Record<string, any> {
  const cart = loadFixture("shop-cart.json");
  const pita = groceryLine(199126, 2);
  const tuna = groceryLine(142207, 1, "FAKE-NOTE: ring til Test Testesen på 12345678");
  cart.lines.push(
    { headline: "Frost", type: "", lines: [{ orderlines: [pita], discounts: [] }] },
    { headline: "Kolonial", type: "", lines: [{ orderlines: [tuna], discounts: [] }] },
  );
  cart.stat.price += pita.amount + tuna.amount;
  cart.stat.amount += 3;
  cart.stat.prod_amount = 3;
  cart.stat.prod_price = pita.amount + tuna.amount;
  return cart;
}
