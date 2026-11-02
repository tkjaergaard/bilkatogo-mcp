// The privacy scrub: a pure function over decoded Bilka JSON. Every cart and
// order answer goes through it before anything shapes it into a tool result,
// so personal data never reaches the model.
//
// The field names come from live captures (docs/research.md §3, "Personal-data
// fields"). A personal value is replaced with REDACTED rather than deleted, so
// the model can still tell that, say, an order had a delivery address. Empty
// values ("" and null) stay as they are: they hold nothing personal.

export const REDACTED = "[personal data removed]";

// Keys whose whole value is personal: address blocks, delivery notes, the
// Gigya profile and session. The block becomes one marker.
const PERSONAL_BLOCKS = new Set(
  [
    "deliveryAddress", // cart and order: the delivery address
    "invoiceAddress",
    "pickupzone", // order: the customer's address for home delivery, the store's for pickup
    "delivery_comment", // cart and order stat: door code, delivery notes, access text
    "activeAddress", // delivery-place list and place switch: the cart's place
    "activeDeliveryPointComment", // place switch: door code, delivery and access notes
    "receipt_content", // order: pickup texts that can hold the pickup code
    "profile", // Gigya: name, email, zip, city, country
    "sessionInfo", // Gigya: the login token
    "company",
    "organisation",
  ].map((key) => key.toLowerCase()),
);

// Keys that are personal wherever they appear.
const PERSONAL_FIELDS = new Set(
  [
    // names
    "recipient_name",
    "firstName",
    "lastName",
    "fullName",
    // address
    "address",
    "street",
    "location",
    "zip",
    "zipCode",
    "zipcity",
    "temporary_zipcode",
    "city",
    "floor",
    "door",
    "lat",
    "lng",
    "dawa_uid",
    // contact
    "email",
    "loginID",
    "phone",
    "mobile",
    "phoneNumber",
    // access and delivery notes
    "doorcode",
    "comment", // also the customer's note on a cart or order line
    "delivery_text",
    "access_choice",
    "deliveryComment",
    "deliveryPointText",
    "deliveryPointId",
    "order_pickup_code",
    // account, session and payment ids
    "uid",
    "eid",
    "tid",
    "UIDSignature",
    "providerId",
    "transact",
    // secrets
    "password",
    "cookieValue",
    "login_token",
    "id_token",
  ].map((key) => key.toLowerCase()),
);

// A delivery place (`facility` beside a store id `sid`): the cart's
// `deliveryAddress`, and each entry in the place list. Bilka's own stores
// (facility 3) and pickup points (facility 5) are public; any other facility,
// such as home delivery (8), is the customer's address, and its `id` counts
// as an account id. Only these keys are kept as they are; every other key is
// redacted, so a new field stays private until someone adds it here. Even on
// public places `recipient_name` is the customer's and `temporary_zipcode` the
// customer's zip (seen live 2026-11-02).
const PLACE_KEYS = new Set([
  "sid",
  "facility",
  "minimum_buy",
  "blockbit",
  "hd_available",
  "missing_hd_address",
  "accessconditions_required",
  "nextAvailableDeliveryDate",
  "currentDeliveryDate",
]);
const PUBLIC_PLACE_KEYS = new Set(["id", "name", "address", "zip", "city"]);
export const PUBLIC_FACILITIES = new Set([3, 5]);

// `name` is a person's name on an order or address (next to `address` or
// `zipcity`, in any case) and a product's name everywhere else.
const PERSON_CONTEXT_KEYS = new Set(["address", "zipcity", "recipient_name"]);

/** A deep copy of `value` with every personal-data field replaced by REDACTED. */
export function scrubPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubPersonalData);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (isPlace(record)) return scrubPlace(record);
  const nameIsPersonal = Object.keys(record).some((key) =>
    PERSON_CONTEXT_KEYS.has(key.toLowerCase()),
  );
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(record)) {
    const lower = key.toLowerCase();
    const personal =
      PERSONAL_BLOCKS.has(lower) ||
      PERSONAL_FIELDS.has(lower) ||
      (lower === "name" && nameIsPersonal);
    if (!personal) out[key] = scrubPersonalData(field);
    else out[key] = isPlace(field) ? scrubPlace(field) : redact(field);
  }
  return out;
}

function isPlace(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).facility === "number" &&
    "sid" in value
  );
}

function scrubPlace(place: Record<string, unknown>): Record<string, unknown> {
  const isPublic = PUBLIC_FACILITIES.has(place.facility as number);
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(place)) {
    const keep = PLACE_KEYS.has(key) || (isPublic && PUBLIC_PLACE_KEYS.has(key));
    out[key] = keep && (typeof field !== "object" || field === null) ? field : redact(field);
  }
  return out;
}

function redact(value: unknown): unknown {
  return value === null || value === undefined || value === "" ? value : REDACTED;
}
