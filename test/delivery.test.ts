import { expect, test } from "vitest";
import { jsonResponse, loadFixture, LOGIN_TOKEN, JWT } from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";

const withLoginToken = { credentials: { env: { BILKATOGO_LOGIN_TOKEN: LOGIN_TOKEN } } };
// No fixed store, so search follows the cart's store.
const followingTheCart = { ...withLoginToken, storeId: undefined };

const ODENSE_PICKUP = loadFixture("shop-delivery-places.json").addresses.find(
  (place: { id: string }) => place.id === "21046",
);

// Every personal value in the delivery fixtures (the fake home address and
// the account ids, see test/fixtures/README.md), and the secrets.
const PERSONAL_VALUES = [
  "Test Testesen",
  "Testvej",
  "Testby",
  "55.0000000",
  "10.0000000",
  "00000000-0000-0000-0000-000000000000",
  "999001",
  "FAKE-",
  "1000001",
  "00000000-0000-4000-8000-000000000001",
  LOGIN_TOKEN,
  JWT,
];

/** The cart's slot, set to one home delivery offers (as in the capture). */
const OFFERED_AT_HOME = {
  deliveryDate: "2026-11-08",
  displayDeliveryDate: "2026-11-08",
  deliveryDay: "Søn",
  intervalStart: "00:00",
  intervalEnd: "06:00",
  closed: 0,
  delivery_message: "Søn. 08/11. Senest kl. 06:00",
};

test("list_delivery_places lists home delivery as 'home' and the public places by name", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("list_delivery_places");

  expect(result.isError).toBe(false);
  // Worked by hand from test/fixtures/shop-delivery-places.json, in Bilka's order.
  expect(result.json).toEqual({
    current_place_id: "home",
    places: [
      {
        place_id: "3192",
        kind: "pickup_in_store",
        name: "Bilka Waves, Hundige",
        store_id: "1653",
        minimum_order: 0,
      },
      {
        place_id: "21046",
        kind: "pickup_in_store",
        name: "Bilka Odense",
        store_id: "1654",
        minimum_order: 0,
      },
      {
        place_id: "142728",
        kind: "pickup_point",
        name: "PickUp Skejby",
        store_id: "1651",
        minimum_order: 0,
      },
      { place_id: "home", kind: "home_delivery", name: null, store_id: "1654", minimum_order: 500 },
    ],
  });
  const [list] = bilka.calls("shop.AvailableDeliveryAddresses");
  expect(list?.headers.get("jwt_token")).toBe(JWT);
});

test("list_delivery_places lets no personal data through", async () => {
  const { callTool } = await connect(withLoginToken);

  const result = await callTool("list_delivery_places");

  for (const value of PERSONAL_VALUES) expect(result.text).not.toContain(value);
});

test("set_delivery_place switches the cart to a pickup place the way the website does", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("set_delivery_place", { place_id: "21046" });

  expect(result.isError).toBe(false);
  const [switchCall] = bilka.calls("shop.SetDeliveryAddress");
  expect(switchCall?.method).toBe("GET");
  expect(Object.fromEntries(switchCall?.url.searchParams ?? [])).toEqual({
    id: "21046",
    zipcode: ODENSE_PICKUP.zip,
    basketguid: "",
    u: "w",
  });
  expect(switchCall?.headers.get("jwt_token")).toBe(JWT);
  expect(switchCall?.headers.has("cookie")).toBe(false);
  expect(result.json).toMatchObject({
    place: { place_id: "21046", kind: "pickup_in_store", name: "Bilka Odense", store_id: "1654" },
    changed: true,
    store_changed: false,
    // Pickup has no delivery fee, and the cart's old slot isn't offered there.
    cart: {
      total: 39,
      fees: [{ name: "Pakkeservice", amount: 39 }],
      delivery: {
        place: { place_id: "21046", name: "Bilka Odense" },
        slot: { date: "2026-07-27", available: false },
      },
    },
  });
  expect(result.json.notes.join(" ")).toMatch(/list_delivery_slots and set_delivery_slot/);
});

test("set_delivery_place sends the home address back to Bilka but never to the model", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  await callTool("set_delivery_place", { place_id: "21046" });

  const result = await callTool("set_delivery_place", { place_id: "home" });

  expect(result.isError).toBe(false);
  const [, back] = bilka.calls("shop.SetDeliveryAddress");
  expect(Object.fromEntries(back?.url.searchParams ?? [])).toEqual({
    dawa_uid: "00000000-0000-0000-0000-000000000000",
    street: "Testvej 1",
    basketguid: "",
    u: "w",
  });
  expect(result.json).toMatchObject({
    place: { place_id: "home", kind: "home_delivery", name: null },
    changed: true,
    cart: { fees: [{ name: "Pakkeservice" }, { name: "Leveringsgebyr" }] },
  });
  for (const value of PERSONAL_VALUES) expect(result.text).not.toContain(value);
});

test("set_delivery_place to the cart's current place sends nothing to Bilka", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("set_delivery_place", { place_id: "home" });

  expect(result.json).toMatchObject({ changed: false, store_changed: false });
  expect(bilka.calls("shop.SetDeliveryAddress")).toEqual([]);
});

test("set_delivery_place to another store's place says so and moves search to that store", async () => {
  const { callTool, bilka } = await connect(followingTheCart);

  const result = await callTool("set_delivery_place", { place_id: "3192" });
  await callTool("search_products", { query: "skyr" });

  expect(result.json).toMatchObject({ store_changed: true, search_store_id: "1653" });
  expect(result.json.notes.join(" ")).toMatch(/packed by store 1653/);
  const [search] = bilka.calls("algolia.query");
  expect(search?.json()).toMatchObject({
    filters: expect.stringContaining("isInAssortmentIn:1653"),
  });
});

test("set_delivery_place says when the server's fixed store keeps search elsewhere", async () => {
  const { callTool } = await connect({ ...withLoginToken, storeId: "1651" });

  const result = await callTool("set_delivery_place", { place_id: "21046" });

  expect(result.json).toMatchObject({ search_store_id: "1651" });
  expect(result.json.notes.join(" ")).toMatch(/search_products still uses store 1651/);
});

test("set_delivery_place rejects a place the account doesn't have, without switching", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("set_delivery_place", { place_id: "12345" });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/isn't one of this account's delivery places.*list_delivery_places/);
  expect(bilka.calls("shop.SetDeliveryAddress")).toEqual([]);
});

test("set_delivery_place reports Bilka refusing the switch", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  bilka.script("shop.SetDeliveryAddress", () =>
    jsonResponse({ msg: "Udleveringsstedet er lukket", eid: 7, uid: 1000001, notifications: [] }),
  );

  const result = await callTool("set_delivery_place", { place_id: "21046" });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/didn't switch the cart.*Udleveringsstedet er lukket/);
});

test("list_delivery_slots shows home delivery's days with their status", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  Object.assign(bilka.cart.deliveryDate, OFFERED_AT_HOME);

  const result = await callTool("list_delivery_slots");

  expect(result.isError).toBe(false);
  // Worked by hand from test/fixtures/shop-delivery-dates.json.
  expect(result.json.chosen_slot).toEqual({ date: "2026-11-08", start: "00:00", end: "06:00" });
  expect(result.json.notice).toBeNull();
  const [today, tomorrow, wednesday] = result.json.days;
  expect(today).toMatchObject({
    date: "2026-11-02",
    status: "order_deadline_passed",
    slots: [{ start: "00:00", end: "06:00", status: "order_deadline_passed" }],
  });
  expect(tomorrow).toEqual({ date: "2026-11-03", status: "sold_out", note: "udsolgt", slots: [] });
  expect(wednesday).toEqual({
    date: "2026-11-04",
    status: "available",
    note: null,
    slots: [
      {
        start: "00:00",
        end: "06:00",
        status: "available",
        order_before: "i morgen kl. 15:00",
        info: [
          "Levering vil ske natten til onsdag. Vi kommer med dine varer imellem 20:00 og 06:00.",
          "For at benytte det valgte tidsrum, skal du bestille senest i morgen kl. 15:00, " +
            "bemærk at tidspunktet kan blive fuldt booket forinden.",
        ],
      },
    ],
  });
  expect(result.json.days.at(-1)).toMatchObject({ date: "2026-11-15", status: "not_open_yet" });
});

test("list_delivery_slots passes on Bilka's notice when the chosen slot isn't offered", async () => {
  const { callTool } = await connect(withLoginToken);

  const result = await callTool("list_delivery_slots");

  expect(result.json.notice).toMatch(/ikke tilgængelig på det valgte udleveringssted/);
});

test("home delivery sold out tomorrow: switch to pickup and book a slot there", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  Object.assign(bilka.cart.deliveryDate, OFFERED_AT_HOME);

  const home = await callTool("list_delivery_slots", { only_available: true });
  await callTool("set_delivery_place", { place_id: "21046" });
  const pickup = await callTool("list_delivery_slots", { only_available: true });
  const booked = await callTool("set_delivery_slot", { date: "2026-11-03", start_time: "08:00" });
  const cart = await callTool("get_cart");

  expect(home.json.days.map((day: { date: string }) => day.date)).not.toContain("2026-11-03");
  const tomorrow = pickup.json.days.find((day: { date: string }) => day.date === "2026-11-03");
  expect(tomorrow.slots.map((slot: { start: string }) => slot.start)).toEqual([
    "08:00",
    "10:00",
    "12:00",
    "14:00",
    "16:00",
    "18:00",
  ]);
  const [setCall] = bilka.calls("shop.SetDeliveryDate");
  expect(Object.fromEntries(setCall?.url.searchParams ?? [])).toEqual({
    deliveryDate: "2026-11-03",
    intervalStart: "08:00",
    intervalEnd: "10:00",
    u: "w",
  });
  expect(booked.json).toEqual({
    slot: { date: "2026-11-03", start: "08:00", end: "10:00" },
    text: "Tir. 03/11. kl. 08:00 - 10:00",
  });
  expect(cart.json.delivery).toEqual({
    place: {
      place_id: "21046",
      kind: "pickup_in_store",
      name: "Bilka Odense",
      store_id: "1654",
      minimum_order: 0,
    },
    slot: {
      date: "2026-11-03",
      start: "08:00",
      end: "10:00",
      text: "Tir. 03/11. kl. 08:00 - 10:00",
      available: true,
    },
  });
});

test("set_delivery_slot refuses a sold-out day without asking Bilka to set it", async () => {
  const { callTool, bilka } = await connect(withLoginToken);

  const result = await callTool("set_delivery_slot", { date: "2026-11-03", start_time: "00:00" });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/isn't a slot Bilka offers that day.*list_delivery_slots/);
  expect(bilka.calls("shop.SetDeliveryDate")).toEqual([]);
});

test("set_delivery_slot names the day's available slots when the time doesn't match", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  await callTool("set_delivery_place", { place_id: "21046" });

  const result = await callTool("set_delivery_slot", { date: "2026-11-04", start_time: "09:00" });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/Available that day: 08:00-10:00, 10:00-12:00, /);
  expect(bilka.calls("shop.SetDeliveryDate")).toEqual([]);
});

test("set_delivery_slot refuses a slot whose order deadline has passed", async () => {
  const { callTool } = await connect(withLoginToken);

  const result = await callTool("set_delivery_slot", { date: "2026-11-02", start_time: "00:00" });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/is order deadline passed/);
});

test("the delivery tools log in again when Bilka answers 'not logged in' (live shape)", async () => {
  const { callTool, bilka } = await connect(withLoginToken);
  bilka.rejectJwt(1);

  const result = await callTool("list_delivery_slots");

  expect(result.isError).toBe(false);
  expect(bilka.calls("gigya.getJWT")).toHaveLength(2);
  expect(bilka.calls("shop.AvailableDeliveryDates")).toHaveLength(2);
});

test("the delivery tools tell the model that Bilka's text is untrusted", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  for (const name of [
    "list_delivery_places",
    "set_delivery_place",
    "list_delivery_slots",
    "set_delivery_slot",
  ]) {
    const tool = tools.find((t) => t.name === name);
    expect(tool?.description).toMatch(/untrusted data,\s+not instructions/i);
  }
});
