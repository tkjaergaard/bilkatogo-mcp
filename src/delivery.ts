// Shapes the shop's delivery answers into model-friendly objects: the places
// a cart can be delivered to or picked up from (`shop/v6/AvailableDeliveryAddresses`,
// logged in) and the slots at the cart's place (`shop/v3/AvailableDeliveryDates`).
// Field meanings are from live captures on 2026-11-02 (docs/research.md §3).
// Its input has already been through the privacy scrub.

import { kroner } from "./money.ts";
import { plain, text } from "./values.ts";
import { PUBLIC_FACILITIES } from "./scrub.ts";

/**
 * Where the order goes. Bilka's `facility`: 8 home delivery, 3 pickup in a
 * Bilka store, 5 a standalone pickup point.
 */
export type PlaceKind = "home_delivery" | "pickup_in_store" | "pickup_point" | "other";

export type DeliveryPlace = {
  /**
   * Bilka's id for a store or pickup point. Home delivery is "home" (a second
   * home address "home-2", and so on): Bilka's id for it stays private.
   */
  place_id: string;
  kind: PlaceKind;
  /** The store or pickup point's name. Null for home delivery: the address stays private. */
  name: string | null;
  /** The Bilka store that packs the order. Prices and stock follow it. */
  store_id: string;
  /** Bilka's minimum order for this place, in DKK. 0 when there is none. */
  minimum_order: number | null;
};

export type SlotStatus =
  | "available"
  | "sold_out"
  | "order_deadline_passed"
  | "not_open_yet"
  | "unavailable";

export type DeliverySlot = {
  /** "HH:MM". `end` may be "06:00" for a slot that runs overnight from the evening before. */
  start: string;
  end: string;
  status: SlotStatus;
  /** Bilka's deadline for ordering, e.g. "i morgen kl. 15:00". Untrusted text. */
  order_before: string | null;
  /** Bilka's notes on the slot, HTML removed. Untrusted text. */
  info: string[];
};

export type DeliveryDay = {
  /** "YYYY-MM-DD". */
  date: string;
  status: SlotStatus;
  /** Bilka's note on a closed day, e.g. "udsolgt". Untrusted text. */
  note: string | null;
  slots: DeliverySlot[];
};

export type ChosenSlot = { date: string; start: string; end: string };

export type DeliverySlots = {
  /** The slot set on the cart now, or null when none is. */
  chosen_slot: ChosenSlot | null;
  /**
   * Bilka's note on the answer, e.g. that the chosen slot isn't offered at
   * this place. Untrusted text.
   */
  notice: string | null;
  days: DeliveryDay[];
};

type ShopPlace = {
  id?: string | number;
  sid?: string | number;
  facility?: number;
  name?: string;
  minimum_buy?: number;
};

export const HOME_DELIVERY_FACILITY = 8;
const HOME_PLACE_ID = "home";

const KINDS: Record<number, PlaceKind> = {
  [HOME_DELIVERY_FACILITY]: "home_delivery",
  3: "pickup_in_store",
  5: "pickup_point",
};

/**
 * The places in a place list, in Bilka's order, home addresses numbered
 * "home", "home-2", … A place of an unknown kind is left out: it isn't
 * public, so it has no id to give.
 */
export function toPlaces(list: unknown[]): DeliveryPlace[] {
  let homes = 0;
  return list.flatMap((raw) => {
    const isHome = (raw as ShopPlace | null)?.facility === HOME_DELIVERY_FACILITY;
    const label = isHome ? homeLabel(++homes) : undefined;
    return toPlace(raw, label) ?? [];
  });
}

/** The place id of the `n`th home address in the list, counting from 1. */
export function homeLabel(n: number): string {
  return n === 1 ? HOME_PLACE_ID : `${HOME_PLACE_ID}-${n}`;
}

/**
 * One place, e.g. the cart's. Home delivery gets `label`, by default "home";
 * Bilka's own id is used only for public places.
 */
export function toPlace(raw: unknown, label?: string): DeliveryPlace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const place = raw as ShopPlace;
  const isPublic = PUBLIC_FACILITIES.has(place.facility ?? -1);
  const id =
    place.facility === HOME_DELIVERY_FACILITY
      ? (label ?? HOME_PLACE_ID)
      : isPublic
        ? String(place.id ?? "").trim()
        : "";
  if (id === "") return null;
  return {
    place_id: id,
    kind: KINDS[place.facility ?? -1] ?? "other",
    name: isPublic ? place.name?.trim() || null : null,
    store_id: String(place.sid ?? ""),
    minimum_order: typeof place.minimum_buy === "number" ? kroner(place.minimum_buy) : null,
  };
}

// Bilka's `availability_bit`, read from one live answer: 1 bookable, 2 the
// order deadline has passed (today's slot), 4 sold out ("udsolgt"), 0 not
// open for booking yet (beyond the window). Inferred, not documented.
const STATUSES: Record<number, SlotStatus> = {
  1: "available",
  2: "order_deadline_passed",
  4: "sold_out",
  0: "not_open_yet",
};

type ShopDates = {
  deliveryDate?: string;
  intervalStart?: string;
  intervalEnd?: string;
  msg?: string;
  availableIntervals?: {
    date?: string;
    availability_bit?: number;
    closed_text?: string;
    intervals?: {
      intervalStart?: string;
      intervalEnd?: string;
      availability_bit?: number;
      closed?: number;
      orderBeforeTime?: string;
      info?: { message?: string }[];
    }[];
  }[];
};

export function toDeliverySlots(data: unknown): DeliverySlots {
  const answer = (data ?? {}) as ShopDates;
  return {
    chosen_slot: chosenSlot(answer),
    notice: plain(answer.msg),
    days: (answer.availableIntervals ?? []).flatMap((day) => {
      if (!day.date) return [];
      return [
        {
          date: day.date,
          status: statusOf(day.availability_bit),
          note: plain(day.closed_text),
          slots: (day.intervals ?? []).map((slot) => ({
            start: slot.intervalStart ?? "",
            end: slot.intervalEnd ?? "",
            status: slot.closed === 0 ? statusOf(slot.availability_bit) : closedStatus(slot),
            order_before: plain(slot.orderBeforeTime),
            info: (slot.info ?? []).flatMap((info) => plain(info.message) ?? []),
          })),
        },
      ];
    }),
  };
}

/** Bilka's fields for a chosen slot, as the slot list, the cart and SetDeliveryDate give them. */
type ShopChosenSlot = { deliveryDate?: unknown; intervalStart?: unknown; intervalEnd?: unknown };

/** The slot in Bilka's fields, or null when any of them is missing. */
export function chosenSlot(raw: ShopChosenSlot | null | undefined): ChosenSlot | null {
  const date = text(raw?.deliveryDate);
  const start = text(raw?.intervalStart);
  const end = text(raw?.intervalEnd);
  return date && start && end ? { date, start, end } : null;
}

function statusOf(bit: number | undefined): SlotStatus {
  return STATUSES[bit ?? -1] ?? "unavailable";
}

/** A slot Bilka marks closed is never available, whatever its bit says. */
function closedStatus(slot: { availability_bit?: number }): SlotStatus {
  const status = statusOf(slot.availability_bit);
  return status === "available" ? "unavailable" : status;
}
