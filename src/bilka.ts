// The Bilka client: one narrow interface in domain terms over the three Bilka
// hosts (Algolia, Gigya, the BilkaToGo shop API). Callers never see raw HTTP
// or øre.

import { type Cart, toCart } from "./cart.ts";
import { kroner } from "./money.ts";
import { scrubPersonalData } from "./scrub.ts";

export const ALGOLIA_APP_ID = "F9VBJLR1BK";
// The public, search-only key bilkatogo.dk ships to every browser.
export const ALGOLIA_SEARCH_KEY = "1deaf41c87e729779f7695c00f190cc9";
export const ALGOLIA_HOST = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;
export const ALGOLIA_PRODUCT_INDEX = "prod_BILKATOGO_PRODUCTS";

export const SHOP_HOST = "https://api.bilkatogo.dk";

export const GIGYA_HOST = "https://accounts.eu1.gigya.com";
// BilkaToGo's public Gigya site key, the one the website sends.
export const GIGYA_API_KEY = "3_tA6BbV434FQqN73HnUG1KA3qFv8KiG4OqLu9eWPh7sKRqRizH5Vfv5Larmgrb4I2";
/** How long a JWT from Gigya's exchange lives: 24 hours, the most Bilka's site asks for. */
export const JWT_LIFETIME_SECONDS = 86_400;

// Order history can take well over 5 seconds to answer.
export const REQUEST_TIMEOUT_MS = 30_000;

/** A Bilka product id: Algolia's numeric `objectID`. */
export const PRODUCT_ID_PATTERN = /^\d{1,12}$/;

// Offer labels that say nothing; the price fields tell the story instead.
const PLACEHOLDER_OFFER_LABELS = new Set(["", "se her"]);

export type Product = {
  product_id: string;
  name: string;
  brand: string | null;
  /** Package size as Bilka writes it, e.g. "800 g". */
  size: string | null;
  /** What one item costs now, in DKK. */
  price: number | null;
  /** The price before the discount, in DKK, when the product is discounted. */
  regular_price: number | null;
  /** `regular_price - price`, in DKK, when the product is discounted. */
  saving: number | null;
  /** Price per `unit`, in DKK. */
  unit_price: number | null;
  /** e.g. "kg", "l", "stk". */
  unit: string | null;
  /** Null when no store was given. */
  on_offer: boolean | null;
  /** The offer text, e.g. "Skarp pris" or "Mix 10 for 25,00". */
  offer: string | null;
  /** Null when no store was given. */
  in_stock: boolean | null;
  /** e.g. "Mejeri & køl > Mejeri > Skyr". */
  category: string | null;
};

/** Everything useful the product index holds about one product. */
export type ProductDetails = Product & {
  /** Bilka's longer display name, e.g. "Skyr med vanilje 0,2%". */
  display_name: string | null;
  manufacturer: string | null;
  /** Offer period at the store, as dates ("2026-10-16"), when Bilka gives one. */
  offer_from: string | null;
  offer_until: string | null;
  /** Whether the store carries the product at all. Null when no store was given. */
  in_store_assortment: boolean | null;
  /** e.g. "Skyr m. smag". */
  product_type: string | null;
  /** The EAN barcode. */
  gtin: string | null;
  /** Labels such as "Økologisk", "Nøglehul" or "Europæisk ejerskab". */
  labels: string[];
  country_of_origin: string[];
  /** Whether a bottle deposit (pant) is added at checkout. */
  deposit: boolean;
  /** Minimum buyer age, when the product has one. */
  age_limit: number | null;
  image_url: string | null;
  /**
   * The product page's information sections as Bilka publishes them, e.g.
   * description, ingredients (allergens in capitals), nutrition per 100 g and
   * storage. Free text goes in `text`, name/value tables in `facts`.
   */
  sections: ProductSection[];
};

export type ProductSection = {
  /** Bilka's section code, e.g. "ingredients" or "nutritional_100". */
  code: string;
  /** The Danish heading, e.g. "Næringsindhold". */
  title: string;
  text?: string;
  facts?: { name: string; value: string }[];
};

export type Store = {
  /** The id `BILKATOGO_STORE_ID` takes, e.g. "1654". */
  store_id: string;
  name: string;
  /** Names of the pickup points served by this store. */
  pickup_points: string[];
};

export type SearchRequest = {
  storeId: string;
  query: string;
  limit: number;
  onlyInStock: boolean;
  onlyOffers: boolean;
};

/** Hands the client a JWT for shop calls that need the account. */
export type Session = {
  jwt(): Promise<string>;
  /** The shop rejected this JWT: the next `jwt()` logs in afresh. */
  rejected(jwt: string): void;
};

export type BilkaClient = {
  searchProducts(request: SearchRequest): Promise<Product[]>;
  /**
   * One product by id, with the store's prices when `storeId` is given.
   * Null when the index has no such product.
   */
  getProduct(request: {
    productId: string;
    storeId: string | undefined;
  }): Promise<ProductDetails | null>;
  /** Bilka's stores, one entry per store id. Public: needs no login. */
  listStores(): Promise<Store[]>;
  /** The logged-in cart, with personal data already scrubbed. */
  getCart(): Promise<Cart>;
  /**
   * Sets one product's cart line to exactly `quantity`; 0 removes the line.
   * One request, no retries: a failure throws a BilkaError whose `retryable`
   * says whether trying again may help.
   */
  setLineQuantity(request: { productId: string; quantity: number }): Promise<LineChange>;
};

/** Bilka's answer to setting one cart line. */
export type LineChange = {
  product_id: string;
  /** The line's quantity now, as Bilka reports it. */
  quantity: number;
  /** What one item costs, in DKK. Null once the line is removed. */
  unit_price: number | null;
  /** Bilka's note on the change, e.g. a stock or offer limit. Untrusted text. */
  message: string | null;
  offer_limit_message: string | null;
};

/** A failure talking to Bilka. The message is safe to show the model. */
export class BilkaError extends Error {
  readonly status: number | undefined;
  /**
   * True for transport failures (timeout, unreachable, HTTP 429 or 5xx),
   * where the same request may succeed later. False when Bilka answered and
   * rejected it, which a retry won't change.
   */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "BilkaError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

/** The shop answered that the request isn't logged in: the JWT is missing, expired or rejected. */
export class NotLoggedInError extends BilkaError {
  constructor(what: string) {
    super(
      `${what} failed: Bilka says the session isn't logged in, even after logging in again. ` +
        "Try again later; if it keeps happening, log in on bilkatogo.dk and copy a fresh login " +
        "token into BILKATOGO_LOGIN_TOKEN.",
    );
    this.name = "NotLoggedInError";
  }
}

/** Sends one request with the standard timeout. Network failures become a BilkaError. */
async function send(
  fetch: typeof globalThis.fetch,
  what: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new BilkaError(timedOut ? `${what} timed out` : `${what} failed: could not reach Bilka`, {
      retryable: true,
      cause: error,
    });
  }
}

async function readJson(what: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new BilkaError(`${what} answered with something that isn't JSON`, { cause: error });
  }
}

/** The outcome of a Gigya call: Gigya reports errors in the body as well as the status. */
export type GigyaAnswer = { status: number; body: Record<string, unknown> };

/**
 * Exchanges a Gigya login token for a shop JWT (`accounts.getJWT`). Throws a
 * BilkaError when Gigya can't be reached; a rejection comes back as the answer
 * so the caller can explain it without ever quoting the token.
 */
export async function exchangeLoginToken(
  fetch: typeof globalThis.fetch,
  loginToken: string,
): Promise<{ jwt: string } | { rejected: GigyaAnswer }> {
  const what = "BilkaToGo login (Gigya JWT exchange)";
  const response = await send(fetch, what, `${GIGYA_HOST}/accounts.getJWT`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      apiKey: GIGYA_API_KEY,
      login_token: loginToken,
      expiration: String(JWT_LIFETIME_SECONDS),
      httpStatusCodes: "true",
    }),
  });
  const data = await readJson(what, response).catch(() => undefined);
  const body = isRecord(data) ? data : {};
  if (response.ok && body.errorCode === 0 && typeof body.id_token === "string" && body.id_token) {
    return { jwt: body.id_token };
  }
  return { rejected: { status: response.status, body } };
}

/**
 * Logs in to Gigya with email and password (`accounts.login`) and returns the
 * login token (`sessionInfo.cookieValue`). Checked live: it works headless
 * (docs/research.md §3). Throws a BilkaError when Gigya can't be reached; a
 * rejection comes back as the answer. The answer's account profile is never
 * passed on.
 */
export async function passwordLogin(
  fetch: typeof globalThis.fetch,
  email: string,
  password: string,
): Promise<{ loginToken: string } | { rejected: GigyaAnswer }> {
  const what = "BilkaToGo login (Gigya password login)";
  const response = await send(fetch, what, `${GIGYA_HOST}/accounts.login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      loginID: email,
      password,
      apiKey: GIGYA_API_KEY,
      httpStatusCodes: "true",
    }),
  });
  const data = await readJson(what, response).catch(() => undefined);
  const body = isRecord(data) ? data : {};
  const session = body.sessionInfo;
  const token = isRecord(session) ? session.cookieValue : undefined;
  if (response.ok && body.errorCode === 0 && typeof token === "string" && token) {
    return { loginToken: token };
  }
  return { rejected: { status: response.status, body: { errorCode: body.errorCode } } };
}

export function createBilkaClient(options: { fetch: typeof fetch; session: Session }): BilkaClient {
  const { fetch, session } = options;

  async function requestJson(what: string, url: string, init: RequestInit): Promise<unknown> {
    const response = await send(fetch, what, url, init);
    if (!response.ok) {
      const { status } = response;
      throw new BilkaError(`${what} failed with HTTP ${status}`, {
        status,
        retryable: status === 429 || status >= 500,
      });
    }
    return readJson(what, response);
  }

  /**
   * A shop call that needs the account: the JWT goes in the `jwt_token` header
   * and nothing else (no cookies; see docs/research.md §3). When the shop says
   * "not logged in", the session logs in afresh and the call is retried once.
   * The answer is scrubbed of personal data before anything reads it.
   */
  async function shopJson(
    what: string,
    endpoint: string,
    params: Record<string, string>,
    init: RequestInit = { method: "GET" },
  ): Promise<Record<string, unknown>> {
    for (let attempt = 1; ; attempt++) {
      const jwt = await session.jwt();
      const data = await requestJson(what, shopUrl(endpoint, params), {
        ...init,
        headers: { ...(init.headers as Record<string, string>), jwt_token: jwt },
      });
      if (!isRecord(data)) throw new BilkaError(`${what} answered with something unexpected`);
      if (!isNotLoggedIn(data)) return scrubPersonalData(data) as Record<string, unknown>;
      if (attempt === 2) throw new NotLoggedInError(what);
      session.rejected(jwt);
    }
  }

  /** A shop API URL. The website adds `u=w` to every shop call, so do we. */
  function shopUrl(endpoint: string, params: Record<string, string> = {}): string {
    const query = new URLSearchParams({ ...params, u: "w" });
    return `${SHOP_HOST}/api/shop/${endpoint}?${query}`;
  }

  async function algolia(what: string, path: string, body: unknown): Promise<unknown> {
    return requestJson(what, `${ALGOLIA_HOST}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-algolia-application-id": ALGOLIA_APP_ID,
        "x-algolia-api-key": ALGOLIA_SEARCH_KEY,
      },
      body: JSON.stringify(body),
    });
  }

  return {
    async searchProducts({ storeId, query, limit, onlyInStock, onlyOffers }) {
      const filters = [`isInAssortmentIn:${storeId}`, "nonsearchable:false"];
      if (onlyInStock) filters.push(`inStockStore:${storeId}`);
      if (onlyOffers) filters.push(`isInOffer:${storeId}`);
      const data = await algolia("Product search", `/1/indexes/${ALGOLIA_PRODUCT_INDEX}/query`, {
        query,
        hitsPerPage: limit,
        filters: filters.join(" AND "),
        attributesToRetrieve: PRODUCT_ATTRIBUTES.concat(`storeData.${storeId}`),
      });
      const hits = arrayField(data, "hits", "Product search answered without results");
      return hits.map((hit) => toProduct(hit as AlgoliaProduct, storeId));
    },

    async getProduct({ productId, storeId }) {
      // The index returns only the objectID unless attributes are named, and
      // naming one store keeps the other stores' price blocks out.
      const attributes = PRODUCT_ATTRIBUTES.concat(DETAIL_ATTRIBUTES);
      if (storeId !== undefined) attributes.push(`storeData.${storeId}`);
      const data = await algolia("Product lookup", "/1/indexes/*/objects", {
        requests: [
          {
            indexName: ALGOLIA_PRODUCT_INDEX,
            objectID: productId,
            attributesToRetrieve: attributes,
          },
        ],
      });
      const results = arrayField(data, "results", "Product lookup answered without results");
      const [record] = results as (AlgoliaProduct | null)[];
      return record ? toProductDetails(record, storeId) : null;
    },

    async listStores() {
      // Sent without a JWT on purpose: anonymously the list holds only Bilka's
      // own stores and pickup points, never a customer's home address.
      const data = await requestJson(
        "Store list",
        shopUrl("v6/AvailableDeliveryAddresses", { orderByZipcode: "1" }),
        { method: "GET" },
      );
      const addresses = arrayField(data, "addresses", "Store list answered without stores");
      return toStores(addresses as DeliveryAddress[]);
    },

    async getCart() {
      const data = await shopJson("Cart read", "v6/Cart", {
        extra: "deliveryAddress,deliveryDate",
      });
      return toCart(data);
    },

    async setLineQuantity({ productId, quantity }) {
      const what = "Setting the cart quantity";
      const data = await shopJson(what, "v6/ChangeLineCount", {
        productId,
        count: String(quantity),
        fullCart: "0",
      });
      return toLineChange(what, productId, data);
    },
  };
}

/** Shapes the ChangeLineCount answer (docs/research.md §3). */
function toLineChange(what: string, productId: string, data: Record<string, unknown>): LineChange {
  const quantity = data.productAmount;
  if (typeof quantity !== "number" || String(data.productId) !== productId) {
    throw new BilkaError(`${what} got an answer from Bilka without the line's new quantity`);
  }
  const unitPrice = typeof data.productUnitPrice === "number" ? data.productUnitPrice : undefined;
  return {
    product_id: productId,
    quantity,
    unit_price: quantity > 0 ? kroner(unitPrice) : null,
    message: text(data.message),
    offer_limit_message: text(data.offerLimitMessage),
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The shop's "not logged in" answer: HTTP 200 with a non-zero `code` and a
 * `msg`, e.g. `{code: 1, msg: "Du er ikke logget ind"}`. Unverified shape,
 * from nickknissen/bilkatogo; no live capture of it yet.
 */
function isNotLoggedIn(data: Record<string, unknown>): boolean {
  return typeof data.code === "number" && data.code !== 0 && typeof data.msg === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The array under `key` in a decoded response, or a BilkaError saying what was missing. */
function arrayField(data: unknown, key: string, missing: string): unknown[] {
  const value = (data as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(value)) throw new BilkaError(missing);
  return value;
}

// One entry in AvailableDeliveryAddresses: a store or a pickup point. `sid` is
// the store that serves it, so pickup points share their parent store's sid.
type DeliveryAddress = { name?: string; sid?: string | number };

/**
 * One entry per store id, in Bilka's order. The entry named "Bilka …" names
 * the store; the others sharing its id are its pickup points.
 */
function toStores(addresses: DeliveryAddress[]): Store[] {
  const byId = new Map<string, string[]>();
  for (const address of addresses) {
    const storeId = String(address.sid ?? "").trim();
    const name = (address.name ?? "").trim();
    if (storeId === "" || name === "") continue;
    const names = byId.get(storeId) ?? [];
    names.push(name);
    byId.set(storeId, names);
  }
  return [...byId].map(([storeId, names]) => {
    const name = names.find((n) => /^bilka\b/i.test(n)) ?? names[0] ?? storeId;
    return { store_id: storeId, name, pickup_points: names.filter((n) => n !== name) };
  });
}

// The Algolia product record fields this client reads. Real records carry many more.
type AlgoliaProduct = {
  objectID: string;
  name?: string;
  brand?: string;
  netcontent?: string;
  price?: number;
  sales_price?: number;
  unitOfMeasurePrice?: number;
  unitOfMeasurePriceUnits?: string;
  isInOffer?: (number | string)[];
  inStockStore?: (number | string)[];
  deepestCategoryPath?: string;
  isInAssortmentIn?: (number | string)[];
  productName?: string;
  manufacturer?: string;
  productType?: string;
  gtin?: string;
  properties?: string[];
  attributes?: { attributeName?: string }[];
  countryOfOrigin?: string[];
  pant?: boolean;
  ageCode?: number;
  images?: string[];
  infos?: AlgoliaInfo[];
  storeData?: Record<string, AlgoliaStoreData | undefined>;
};

// Prices and offers for one store. Amounts are in øre.
type AlgoliaStoreData = {
  inStock?: boolean;
  price?: number;
  beforePrice?: number;
  offerDescription?: string;
  offerFrom?: string;
  offerUntil?: string;
  unitsOfMeasurePrice?: number;
  unitsOfMeasureShowPrice?: number;
  unitsOfMeasurePriceUnit?: string;
};

const PRODUCT_ATTRIBUTES = [
  "objectID",
  "name",
  "brand",
  "netcontent",
  "price",
  "sales_price",
  "unitOfMeasurePrice",
  "unitOfMeasurePriceUnits",
  "isInOffer",
  "inStockStore",
  "deepestCategoryPath",
];

// One section of the product page. Item type 1 is free text (may hold HTML),
// type 2 a name/value row.
type AlgoliaInfo = {
  code?: string;
  title?: string;
  items?: { type?: number; title?: string; value?: string }[];
};

// Read only by product details. `infos` is where nutrition and ingredients live.
const DETAIL_ATTRIBUTES = [
  "isInAssortmentIn",
  "productName",
  "manufacturer",
  "productType",
  "gtin",
  "properties",
  "attributes",
  "countryOfOrigin",
  "pant",
  "ageCode",
  "images",
  "infos",
];

function toProduct(hit: AlgoliaProduct, storeId: string | undefined): Product {
  const store = storeId === undefined ? undefined : hit.storeData?.[storeId];
  const priceOre = positive(store?.price) ?? positive(hit.sales_price) ?? positive(hit.price);
  const regularOre = positive(store?.beforePrice) ?? positive(hit.price);
  const savingOre =
    priceOre !== undefined && regularOre !== undefined && regularOre > priceOre
      ? regularOre - priceOre
      : undefined;
  const unitPriceOre =
    positive(store?.unitsOfMeasureShowPrice) ??
    positive(store?.unitsOfMeasurePrice) ??
    positive(hit.unitOfMeasurePrice);
  const offerText = (store?.offerDescription ?? "").trim();
  return {
    product_id: String(hit.objectID),
    name: hit.name ?? "",
    brand: hit.brand || null,
    size: hit.netcontent || null,
    price: kroner(priceOre),
    regular_price: savingOre === undefined ? null : kroner(regularOre),
    saving: kroner(savingOre),
    unit_price: kroner(unitPriceOre),
    unit: normaliseUnit(store?.unitsOfMeasurePriceUnit ?? hit.unitOfMeasurePriceUnits),
    on_offer: storeId === undefined ? null : includesStore(hit.isInOffer, storeId),
    offer: PLACEHOLDER_OFFER_LABELS.has(offerText.toLowerCase()) ? null : offerText,
    in_stock:
      storeId === undefined ? null : (store?.inStock ?? includesStore(hit.inStockStore, storeId)),
    category: hit.deepestCategoryPath || null,
  };
}

function toProductDetails(hit: AlgoliaProduct, storeId: string | undefined): ProductDetails {
  const store = storeId === undefined ? undefined : hit.storeData?.[storeId];
  const labels = [
    ...(hit.properties ?? []),
    ...(hit.attributes ?? []).map((attribute) => attribute.attributeName ?? ""),
  ]
    .map((label) => label.trim())
    .filter((label) => label !== "");
  return {
    ...toProduct(hit, storeId),
    display_name: hit.productName || null,
    manufacturer: hit.manufacturer || null,
    offer_from: store?.offerFrom || null,
    offer_until: store?.offerUntil || null,
    in_store_assortment:
      storeId === undefined ? null : includesStore(hit.isInAssortmentIn, storeId),
    product_type: hit.productType || null,
    gtin: hit.gtin || null,
    labels: [...new Set(labels)],
    country_of_origin: hit.countryOfOrigin ?? [],
    deposit: hit.pant === true,
    age_limit: positive(hit.ageCode) ?? null,
    image_url: hit.images?.[0] ?? null,
    sections: (hit.infos ?? []).flatMap((info) => toSection(info)),
  };
}

function toSection(info: AlgoliaInfo): ProductSection[] {
  const texts: string[] = [];
  const facts: { name: string; value: string }[] = [];
  for (const item of info.items ?? []) {
    const value = plainText(item.value ?? "");
    const name = plainText(item.title ?? "");
    if (value === "") continue;
    if (item.type === 2 && name !== "") facts.push({ name, value });
    else texts.push(name === "" ? value : `${name}: ${value}`);
  }
  if (texts.length === 0 && facts.length === 0) return [];
  const section: ProductSection = { code: info.code ?? "", title: plainText(info.title ?? "") };
  if (texts.length > 0) section.text = texts.join("\n\n");
  if (facts.length > 0) section.facts = facts;
  return [section];
}

/** Bilka's product texts carry a little HTML (`<BR>`, `<H2>`). Reduce it to plain text. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:h[1-6]|p|div|ul|ol|li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

function normaliseUnit(unit: string | undefined): string | null {
  const normalised = (unit ?? "").trim().replace(/\.$/, "").toLowerCase();
  return normalised || null;
}

function includesStore(stores: (number | string)[] | undefined, storeId: string): boolean {
  return (stores ?? []).some((store) => String(store) === storeId);
}
