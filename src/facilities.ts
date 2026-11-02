// Bilka's `facility` number on a delivery place says what kind of place it
// is (live captures, 2026-11-02, docs/research.md §3). This is the one map of
// them: the delivery shaping names the kinds from it, and the privacy scrub
// keeps only the public kinds' names and addresses.

/** Where the order goes. */
export type PlaceKind = "home_delivery" | "pickup_in_store" | "pickup_point";

const FACILITY_KINDS = new Map<unknown, PlaceKind>([
  [8, "home_delivery"],
  [3, "pickup_in_store"], // a Bilka store
  [5, "pickup_point"], // a standalone pickup point
]);

/** The kind of place a facility number is, or undefined for one not seen yet. */
export function placeKind(facility: unknown): PlaceKind | undefined {
  return FACILITY_KINDS.get(facility);
}

export function isHomeDelivery(facility: unknown): boolean {
  return placeKind(facility) === "home_delivery";
}

/**
 * Whether the place is Bilka's own store or pickup point, so its id, name
 * and address are public. Home delivery, and any facility not seen yet, is
 * the customer's address.
 */
export function isPublicFacility(facility: unknown): boolean {
  const kind = placeKind(facility);
  return kind !== undefined && kind !== "home_delivery";
}
