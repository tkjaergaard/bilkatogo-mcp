// Shapes the shop's order answers (`shop/v7/OrderHistory`, `shop/v7/OrderDetails`)
// into model-friendly objects: DKK instead of øre, clear field names, fees
// apart from groceries. Their input has already been through the privacy scrub.

import { type CartFee, type CartLine, type ShopLineGroup, splitLines } from "./cart.ts";
import { kroner } from "./money.ts";
import { text } from "./values.ts";

/** One past order in the history. */
export type OrderSummary = {
  /** The id `get_order_details` takes, e.g. "900000000001". */
  order_id: string;
  /** The day the order was placed, e.g. "2026-07-25". */
  ordered_on: string | null;
  delivery_date: string | null;
  /** Bilka's text for the slot, e.g. "Lør. 17/05. kl. 12:00 - 14:00". */
  delivery_slot: string | null;
  /** e.g. "Faktureret". */
  status: string | null;
  /** What the order came to once packed (`packedPrice`), in DKK. */
  total: number | null;
  /** What it came to when ordered (`orderedPrice`), in DKK. Differs when items were missing or replaced. */
  ordered_total: number | null;
  /** The number of grocery items. */
  item_count: number | null;
  /** The first few item names, as Bilka abbreviates them. */
  preview: string | null;
};

/**
 * An order in the history list. Bilka's personal fields stay in, each as the
 * privacy marker, so the model can see the order had them.
 */
export type OrderHistoryEntry = OrderSummary & {
  /** The customer's name. Always a privacy marker when set. */
  name: unknown;
  /** The delivery address. Always a privacy marker when set. */
  address: unknown;
  /** Postcode and town. Always a privacy marker when set. */
  zipcity: unknown;
  /** The delivery or pickup point. Always a privacy marker when set. */
  pickupzone: unknown;
};

export type OrderHistoryPage = {
  currency: "DKK";
  offset: number;
  limit: number;
  /** How many orders the account has in all. */
  total_orders: number | null;
  /** The offset of the next page, or null when this is the last one. */
  next_offset: number | null;
  orders: OrderHistoryEntry[];
};

export type OrderItem = Omit<CartLine, "line_total"> & {
  /** What the line cost: quantity × unit price after line discounts, in DKK. */
  price_paid: number | null;
  /** The offer the item was bought on, e.g. "Plus pris 10,00". */
  offer: string | null;
};

export type OrderDetails = {
  currency: "DKK";
  order_id: string;
  status: string | null;
  ordered_on: string | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  /** The Bilka store that packed the order, e.g. "Bilka: Odense". */
  store: string | null;
  item_count: number | null;
  totals: {
    /** What the order cost, fees included. */
    total: number | null;
    /** The groceries alone. */
    products: number | null;
    /** Bottle deposit (pant). */
    deposit: number | null;
    /** What Bilka's offers took off (`stat.promo`). */
    offer_savings: number | null;
    /** The VAT included in `total`. */
    vat: number | null;
  };
  /** Service lines such as "Pakkeservice" and "Leveringsgebyr". */
  fees: CartFee[];
  items: OrderItem[];
  /** The delivery address or pickup point. Always a privacy marker when set. */
  delivery_address: unknown;
  /** Door code, delivery and access notes. Always a privacy marker when set. */
  delivery_notes: unknown;
};

type ShopOrderSummary = {
  orderId?: string | number;
  ordered?: { date?: string };
  deliveryDate?: string;
  deliveryMessage?: string;
  status?: string;
  orderedPrice?: number;
  packedPrice?: number;
  totalProductAmount?: number;
  content?: string;
};

type ShopHistoryOrder = ShopOrderSummary & {
  name?: unknown;
  address?: unknown;
  zipcity?: unknown;
  pickupzone?: unknown;
};

type ShopOrderHistory = { offset?: number | string; total?: number | string; orders?: unknown };

type ShopOrder = ShopOrderSummary & {
  price?: number;
  warehouse?: string;
  stat?: {
    price?: number;
    prod_price?: number;
    deposit?: number;
    promo?: number;
    price_vat?: number;
    delivery_comment?: unknown;
  };
  lines?: ShopLineGroup[];
  deliveryAddress?: unknown;
  pickupzone?: unknown;
};

export function toOrderHistoryPage(
  data: unknown,
  request: { offset: number; limit: number },
): OrderHistoryPage {
  const history = (data ?? {}) as ShopOrderHistory;
  const orders = Array.isArray(history.orders)
    ? (history.orders as ShopHistoryOrder[]).map(toOrderHistoryEntry)
    : [];
  const offset = toNumber(history.offset) ?? request.offset;
  const total = toNumber(history.total);
  const next = offset + orders.length;
  return {
    currency: "DKK",
    offset,
    limit: request.limit,
    total_orders: total,
    next_offset: orders.length > 0 && total !== null && next < total ? next : null,
    orders,
  };
}

export function toOrderDetails(order: ShopOrder): OrderDetails {
  const { items, fees } = splitLines(
    order.lines,
    ({ line_total, ...line }, orderline): OrderItem => ({
      ...line,
      price_paid: line_total,
      offer: text(orderline.product?.cpOfferMsg),
    }),
  );
  const summary = toOrderSummary(order);
  return {
    currency: "DKK",
    order_id: summary.order_id,
    status: summary.status,
    ordered_on: summary.ordered_on,
    delivery_date: summary.delivery_date,
    delivery_slot: summary.delivery_slot,
    store: text(order.warehouse),
    item_count: summary.item_count,
    totals: {
      total: kroner(order.stat?.price ?? order.price),
      products: kroner(order.stat?.prod_price),
      deposit: kroner(order.stat?.deposit),
      offer_savings: kroner(order.stat?.promo),
      vat: kroner(order.stat?.price_vat),
    },
    fees,
    items,
    delivery_address: order.deliveryAddress ?? order.pickupzone ?? null,
    delivery_notes: order.stat?.delivery_comment ?? null,
  };
}

function toOrderHistoryEntry(order: ShopHistoryOrder): OrderHistoryEntry {
  return {
    ...toOrderSummary(order),
    name: order.name ?? null,
    address: order.address ?? null,
    zipcity: order.zipcity ?? null,
    pickupzone: order.pickupzone ?? null,
  };
}

function toOrderSummary(order: ShopOrderSummary): OrderSummary {
  return {
    order_id: String(order.orderId ?? ""),
    ordered_on: text(order.ordered?.date),
    delivery_date: text(order.deliveryDate),
    delivery_slot: text(order.deliveryMessage),
    status: text(order.status),
    total: kroner(order.packedPrice ?? order.orderedPrice),
    ordered_total: kroner(order.orderedPrice),
    item_count: order.totalProductAmount ?? null,
    preview: text(order.content),
  };
}

/** Bilka sends some counts as strings (`limit: "5"`). */
function toNumber(value: number | string | undefined): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}
