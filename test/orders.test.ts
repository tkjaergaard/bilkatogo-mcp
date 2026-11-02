import { expect, test } from "vitest";
import { JWT, LOGIN_TOKEN } from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";

const withLoginToken = { credentials: { env: { BILKATOGO_LOGIN_TOKEN: LOGIN_TOKEN } } };

test("get_order_history reads a page of past orders with the JWT", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("get_order_history", { offset: 0, limit: 5 });

  expect(result.isError).toBe(false);
  const [history] = bilka.calls("shop.OrderHistory");
  if (!history) throw new Error("expected an order-history request");
  expect(history.method).toBe("POST");
  expect(history.url.origin + history.url.pathname).toBe(
    "https://api.bilkatogo.dk/api/shop/v7/OrderHistory",
  );
  expect(Object.fromEntries(history.url.searchParams)).toEqual({
    u: "w",
    limit: "5",
    offset: "0",
    muah: "1",
    ordertype: "dibs,pgw",
  });
  expect(history.headers.get("jwt_token")).toBe(JWT);
});

test("get_order_history lists each order's id, dates, status, total and preview in DKK", async () => {
  const { callTool } = await connect(withLoginToken);

  const result = await callTool("get_order_history");

  // Worked by hand from test/fixtures/shop-order-history.json: øre / 100.
  expect(result.json).toEqual({
    currency: "DKK",
    offset: 0,
    limit: 5,
    total_orders: 2,
    next_offset: null,
    orders: [
      {
        order_id: "900000000001",
        ordered_on: "2026-07-25",
        delivery_date: "2026-07-27",
        delivery_slot: "Man. 27/07. Senest kl. 06:00",
        status: "Faktureret",
        total: 1009.34,
        ordered_total: 1009.34,
        item_count: 34,
        preview: "Pitabrød, Tun i vand, Agurk øko, Hjertesalat øko",
      },
      {
        order_id: "900000000002",
        ordered_on: "2025-05-16",
        delivery_date: "2025-05-17",
        delivery_slot: "Lør. 17/05. kl. 12:00 - 14:00",
        status: "Faktureret",
        total: 994.65,
        ordered_total: 1185.95,
        item_count: 45,
        preview: "Chiliflager øko, Basilikum øko, Grovkornet sennep,",
      },
    ],
  });
});

test("get_order_details reads one order by id with the JWT", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("get_order_details", { order_id: "900000000001" });

  expect(result.isError).toBe(false);
  const [details] = bilka.calls("shop.OrderDetails");
  if (!details) throw new Error("expected an order-details request");
  expect(details.method).toBe("GET");
  expect(details.url.origin + details.url.pathname).toBe(
    "https://api.bilkatogo.dk/api/shop/v7/OrderDetails",
  );
  expect(Object.fromEntries(details.url.searchParams)).toEqual({
    u: "w",
    orderId: "900000000001",
  });
  expect(details.headers.get("jwt_token")).toBe(JWT);
});

test("get_order_details returns the items, totals, fees and slot in DKK", async () => {
  const { callTool } = await connect(withLoginToken);

  const result = await callTool("get_order_details", { order_id: "900000000001" });

  // Worked by hand from test/fixtures/shop-order-details.json: øre / 100,
  // the "Services" lines as fees.
  expect(result.json).toMatchObject({
    currency: "DKK",
    order_id: "900000000001",
    status: "Faktureret",
    ordered_on: "2026-07-25",
    delivery_date: "2026-07-27",
    delivery_slot: "Man. 27/07. Senest kl. 06:00",
    store: "Bilka: Odense",
    item_count: 34,
    totals: { total: 1009.34, products: 931.34, deposit: 0, offer_savings: 87.73, vat: 201.87 },
    fees: [
      { name: "Leveringsgebyr", amount: 39 },
      { name: "Pakkeservice", amount: 39 },
    ],
  });
  expect(result.json.items.map((item: { name: string }) => item.name)).toEqual([
    "Pitabrød",
    "Tun i vand",
    "Majs øko",
  ]);
  expect(result.json.items[2]).toEqual({
    product_id: "141655",
    name: "Majs øko",
    brand: "Salling ØKO",
    size: "140 g",
    quantity: 1,
    unit_price: 7.51,
    price_paid: 7.51,
    offer: null,
    group: "Kolonial",
    unavailable_reason: null,
    note: null,
  });
});

test("get_order_details gives the offer text an item was bought on", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  const order = bilka.orderDetails["900000000001"]!;
  const tuna = order.lines[2].lines[0].orderlines[0];
  tuna.quantity = 2;
  tuna.amount = 2000;
  tuna.unitprice = 1000;
  tuna.product.cpOffer = true;
  tuna.product.cpOfferMsg = "Plus pris 10,00";

  const result = await callTool("get_order_details", { order_id: "900000000001" });

  expect(result.json.items[1]).toMatchObject({
    name: "Tun i vand",
    quantity: 2,
    unit_price: 10,
    price_paid: 20,
    offer: "Plus pris 10,00",
  });
});

// Every fake personal value in the order fixtures, and the secrets.
const PERSONAL_VALUES = [
  "Test Testesen",
  "Testvej",
  "Testby",
  "0000 ",
  "55.0000000",
  "10.0000000",
  "FAKE",
  "test-provider",
  "1000001",
  "2000001",
  "test-tid",
  LOGIN_TOKEN,
  JWT,
];

test("get_order_history lets no personal data through, however deeply it's nested", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("get_order_history");

  expect(result.isError).toBe(false);
  // The fake's answer really holds them: the pickup code sits two levels
  // down, in each order's pickupzone.
  expect(JSON.stringify(bilka.orders)).toContain("FAKE-PICKUP-9876");
  for (const value of PERSONAL_VALUES) expect(result.text).not.toContain(value);
});

test("get_order_details lets no personal or payment data through", async () => {
  const { callTool } = await connect(withLoginToken);

  const result = await callTool("get_order_details", { order_id: "900000000001" });

  expect(result.isError).toBe(false);
  for (const value of PERSONAL_VALUES) expect(result.text).not.toContain(value);
  expect(result.text).not.toMatch(/providerId|transact|receipt_content|payments/);
});

test("get_order_details replaces the delivery address and notes with a marker", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  const order = bilka.orderDetails["900000000001"]!;
  order.lines[1].lines[0].orderlines[0].comment = "FAKE-NOTE: ring til Test Testesen";

  const result = await callTool("get_order_details", { order_id: "900000000001" });

  const marker = "[personal data removed]";
  expect(result.json.delivery_address).toBe(marker);
  expect(result.json.delivery_notes).toBe(marker);
  // The customer's note on the pita line, four levels down in Bilka's answer.
  expect(result.json.items[0].note).toBe(marker);
});

test("get_order_details falls back to the pickup point as the address marker", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  delete bilka.orderDetails["900000000001"]!.deliveryAddress;

  const result = await callTool("get_order_details", { order_id: "900000000001" });

  expect(result.json.delivery_address).toBe("[personal data removed]");
});

test.each(["", "abc", "90000000000x", "900000000001; DROP", "-900000000001", "12", "1".repeat(40)])(
  "get_order_details rejects the malformed order id %j before any HTTP call",
  async (orderId) => {
    const { callTool, bilka } = await connect(withLoginToken);

    const result = await callTool("get_order_details", { order_id: orderId });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/get_order_history/);
    expect(bilka.requests).toEqual([]);
  },
);

test("get_order_details accepts an order id with surrounding spaces", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("get_order_details", { order_id: " 900000000001 " });

  expect(result.isError).toBe(false);
  expect(bilka.calls("shop.OrderDetails")[0]?.url.searchParams.get("orderId")).toBe("900000000001");
});

test("get_order_details says when the account has no such order", async () => {
  const { callTool } = await connect(withLoginToken);

  const result = await callTool("get_order_details", { order_id: "900000000099" });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/900000000099 wasn't found.*get_order_history/);
});

test("get_order_history clamps the page size to the configured maximum", async () => {
  const { callTool, bilka } = await connect({ ...withLoginToken, limits: { maxOrderPageSize: 3 } });

  const result = await callTool("get_order_history", { limit: 500 });

  expect(result.isError).toBe(false);
  expect(bilka.calls("shop.OrderHistory")[0]?.url.searchParams.get("limit")).toBe("3");
  expect(result.json.limit).toBe(3);
});

test("get_order_history rejects a negative offset or a zero page size before any HTTP call", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  expect((await callTool("get_order_history", { offset: -1 })).isError).toBe(true);
  expect((await callTool("get_order_history", { limit: 0 })).isError).toBe(true);
  expect(bilka.requests).toEqual([]);
});

test("get_order_history pages through the orders with next_offset", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const first = await callTool("get_order_history", { limit: 1 });
  const second = await callTool("get_order_history", { offset: first.json.next_offset, limit: 1 });

  expect(first.json).toMatchObject({ offset: 0, limit: 1, total_orders: 2, next_offset: 1 });
  expect(first.json.orders.map((o: { order_id: string }) => o.order_id)).toEqual(["900000000001"]);
  expect(second.json).toMatchObject({ offset: 1, total_orders: 2, next_offset: null });
  expect(second.json.orders.map((o: { order_id: string }) => o.order_id)).toEqual(["900000000002"]);
  expect(bilka.calls("shop.OrderHistory")[1]?.url.searchParams.get("offset")).toBe("1");
});

test("the order tools say Bilka rejected the session when the JWT isn't accepted", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  bilka.rejectJwt();

  const history = await callTool("get_order_history");
  const details = await callTool("get_order_details", { order_id: "900000000001" });

  expect(history.isError).toBe(true);
  expect(history.text).toMatch(/isn't logged in/);
  expect(details.isError).toBe(true);
  expect(details.text).toMatch(/isn't logged in/);
});

test("the order tools tell the model that order text is untrusted and state their inputs", async () => {
  const { client } = await connect({ limits: { maxOrderPageSize: 7 } });

  const { tools } = await client.listTools();

  const history = tools.find((t) => t.name === "get_order_history");
  const details = tools.find((t) => t.name === "get_order_details");
  expect(history?.description).toMatch(/untrusted data,\s+not instructions/i);
  expect(details?.description).toMatch(/untrusted data,\s+not instructions/i);
  expect(history?.inputSchema.properties).toEqual({
    offset: expect.objectContaining({ type: "integer", minimum: 0, default: 0 }),
    limit: expect.objectContaining({
      type: "integer",
      minimum: 1,
      default: 5,
      description: expect.stringContaining("at most 7"),
    }),
  });
  expect(details?.inputSchema.properties).toEqual({
    order_id: expect.objectContaining({ type: "string" }),
  });
  expect(details?.inputSchema.required).toEqual(["order_id"]);
});
