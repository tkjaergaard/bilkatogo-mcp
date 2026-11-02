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

// `name` is a person's name on an order or address (next to `address` or
// `zipcity`, in any case) and a product's name everywhere else.
const PERSON_CONTEXT_KEYS = new Set(["address", "zipcity", "recipient_name"]);

/** A deep copy of `value` with every personal-data field replaced by REDACTED. */
export function scrubPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubPersonalData);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
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
    out[key] = personal ? redact(field) : scrubPersonalData(field);
  }
  return out;
}

function redact(value: unknown): unknown {
  return value === null || value === undefined || value === "" ? value : REDACTED;
}
