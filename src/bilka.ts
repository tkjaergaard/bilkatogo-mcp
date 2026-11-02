// The Bilka client: one narrow interface in domain terms over the three Bilka
// hosts (Algolia, Gigya, the BilkaToGo shop API). Callers never see raw HTTP
// or øre.

import { type Cart, toCart } from "./cart.ts";
import {
  type ChosenSlot,
  chosenSlot,
  type DeliveryPlace,
  type DeliverySlots,
  HOME_DELIVERY_FACILITY,
  homeLabel,
  toDeliverySlots,
  toPlace,
  toPlaces,
} from "./delivery.ts";
import { kroner } from "./money.ts";
import {
  type OrderDetails,
  type OrderHistoryPage,
  toOrderDetails,
  toOrderHistoryPage,
} from "./orders.ts";
import { scrubPersonalData } from "./scrub.ts";
import { isRecord, text } from "./values.ts";

export const ALGOLIA_APP_ID = "F9VBJLR1BK";
// The public, search-only key bilkatogo.dk ships to every browser.
export const ALGOLIA_SEARCH_KEY = "1deaf41c87e729779f7695c00f190cc9";
export const ALGOLIA_HOST = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;
export const ALGOLIA_PRODUCT_INDEX = "prod_BILKATOGO_PRODUCTS";
// The website's sort replicas of the product index, "Billigst" and "Laveste
// enhedspris". Standard replicas: price ranks above text relevance.
export const ALGOLIA_PRICE_SORT_INDEX = "prod_r_BILKATOGO_PRODUCT_pricesort";
export const ALGOLIA_UNIT_PRICE_SORT_INDEX = "prod_r_BILKATOGO_PRODUCT_uompricesort";

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

/**
 * A BilkaToGo order id. Live ids are 12 digits (e.g. "900000000001"); a little
 * slack either side keeps older or newer ids working, while still refusing
 * anything that isn't an id before it reaches Bilka.
 */
export const ORDER_ID_PATTERN = /^\d{6,16}$/;

/**
 * The deepest a category path goes: five levels, `consumerFacingHierarchy.lvl0`
 * to `lvl4`. Groceries stop at lvl3; lvl4 exists live in e.g. "Tøj & sko"
 * (docs/research.md §3).
 */
export const MAX_CATEGORY_LEVELS = 5;

// One level's name: no double quote or backslash (they could end the quoted
// filter value), no ">" or control characters, no space at either end.
const CATEGORY_NAME = String.raw`[^\s"\\>\p{Cc}](?:[^"\\>\p{Cc}]*[^\s"\\>\p{Cc}])?`;

/**
 * A category path such as "Mejeri & køl > Pålæg": one to five names joined by
 * " > ". Anything else is refused before it can reach an Algolia filter.
 */
export const CATEGORY_PATH_PATTERN = new RegExp(
  `^${CATEGORY_NAME}(?: > ${CATEGORY_NAME}){0,${MAX_CATEGORY_LEVELS - 1}}$`,
  "u",
);

/** A mix offer id: Algolia's `multipromos` value. Live ids run from 4 to 8 digits, so no length is fixed. */
export const MIX_OFFER_ID_PATTERN = /^\d+$/;

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
  /**
   * The offer text, e.g. "Skarp pris" or "Mix 10 for 25,00". Everyday price
   * labels such as "Skarp pris" count as offers too; `in_leaflet` tells this
   * week's deals apart.
   */
  offer: string | null;
  /** Offer period at the store, as dates ("2026-10-16"), when Bilka gives one. */
  offer_from: string | null;
  offer_until: string | null;
  /** Whether the product is in this week's Bilka Avisen (the leaflet), in every store. */
  in_leaflet: boolean;
  /** Null when no store was given. */
  in_stock: boolean | null;
  /**
   * The deepest menu category, e.g. "Mejeri & køl > Pålæg > Kødpålæg": a valid
   * `category` for search_products and `parent` for list_categories.
   */
  category: string | null;
  /**
   * The mix offer the product counts towards at the store, e.g. "Mix 2 for
   * 35,00"; its text is in `offer`. Null when there's none or no store was given.
   */
  mix: Mix | null;
};

/** A "buy N of these products for a set price" offer at one store. */
export type Mix = {
  /** Lists every product in the mix, as `search_products`' `mix_offer_id`. */
  mix_offer_id: string;
  /** How many items the mix takes, e.g. 2. Null when Bilka doesn't say. */
  items: number | null;
  /** What `items` cost together, in DKK. Null when Bilka gives no price, e.g. "3 for 2". */
  price: number | null;
};

/** Everything useful the product index holds about one product. */
export type ProductDetails = Product & {
  /** Bilka's longer display name, e.g. "Skyr med vanilje 0,2%". */
  display_name: string | null;
  manufacturer: string | null;
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

/** One product search at one store. Every filter narrows the search further. */
export type SearchRequest = {
  storeId: string;
  /** Free text. Empty browses: only the filters choose the products. */
  query: string;
  filters: SearchFilters;
  /**
   * `relevance` is Algolia's ranking. `price` and `unit_price` are cheapest
   * first at the store, within the page; products without one come last.
   */
  sort: SearchSort;
  /** 1-based. */
  page: number;
  /** Products per page. */
  limit: number;
};

export type SearchSort = "relevance" | "price" | "unit_price";

const SORT_INDEXES: Record<SearchSort, string> = {
  relevance: ALGOLIA_PRODUCT_INDEX,
  price: ALGOLIA_PRICE_SORT_INDEX,
  unit_price: ALGOLIA_UNIT_PRICE_SORT_INDEX,
};

/** One page of a product search. */
export type SearchResult = {
  products: Product[];
  /** 1-based, as asked for. */
  page: number;
  totalPages: number;
  totalResults: number;
};

export type SearchFilters = {
  onlyInStock: boolean;
  /** Anything with an offer text at the store, everyday labels such as "Skarp pris" included. */
  onlyOffers: boolean;
  /** This week's Bilka Avisen (the leaflet). */
  onlyLeaflet: boolean;
  /** A category path such as "Mejeri & køl > Pålæg", matching CATEGORY_PATH_PATTERN. */
  category?: string;
  /** Only the products in this mix offer (all digits) that have the offer at the store. */
  mixOfferId?: string;
};

/** Which products a category count includes. */
export type CategoryFilters = Pick<SearchFilters, "onlyInStock" | "onlyOffers" | "onlyLeaflet">;

/** One category in the shop's menu, with how many products match. */
export type Category = {
  /** The full path, e.g. "Mejeri & køl > Pålæg": a valid search `category`. */
  category: string;
  /** The last segment, e.g. "Pålæg". */
  name: string;
  product_count: number;
};

/** One level of the category tree at one store. */
export type CategoryList = {
  /** Largest first. */
  categories: Category[];
  /** How many products match in the parent category, or in all of them at the top. */
  productCount: number;
};

/** Hands the client a JWT for shop calls that need the account. */
export type Session = {
  jwt(): Promise<string>;
  /** The shop rejected this JWT: the next `jwt()` logs in afresh. */
  rejected(jwt: string): void;
};

export type BilkaClient = {
  searchProducts(request: SearchRequest): Promise<SearchResult>;
  /**
   * The direct children of `parent` in the shop's category tree, or the top
   * level without one, with product counts at the store.
   */
  listCategories(request: {
    storeId: string;
    /** A category path matching CATEGORY_PATH_PATTERN. */
    parent?: string;
    filters: CategoryFilters;
  }): Promise<CategoryList>;
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
  /** One page of the account's past orders, newest first, scrubbed. */
  getOrderHistory(request: { offset: number; limit: number }): Promise<OrderHistoryPage>;
  /** Everything in one past order, scrubbed. Null when the account has no such order. */
  getOrderDetails(orderId: string): Promise<OrderDetails | null>;
  /**
   * Sets one product's cart line to exactly `quantity`; 0 removes the line.
   * One request, no retries: a failure throws a BilkaError whose `retryable`
   * says whether trying again may help.
   */
  setLineQuantity(request: { productId: string; quantity: number }): Promise<LineChange>;
  /** The places the account's cart can be delivered to or picked up from, scrubbed. */
  getDeliveryPlaces(): Promise<{ currentPlaceId: string | null; places: DeliveryPlace[] }>;
  /**
   * Switches the cart to one of `getDeliveryPlaces`' places. Null when the
   * account has no such place. Bilka keeps the chosen slot, but it may not be
   * offered at the new place.
   */
  setDeliveryPlace(placeId: string): Promise<PlaceChange | null>;
  /** The slots at the cart's current place, for the next two weeks. */
  getDeliverySlots(): Promise<DeliverySlots>;
  /** Sets the cart's slot. Bilka reserves nothing: a slot can fill up before the order is placed. */
  setDeliverySlot(slot: ChosenSlot): Promise<SlotChange>;
};

export type PlaceChange = {
  place: DeliveryPlace;
  /** False when the cart was at this place already, so nothing was sent. */
  changed: boolean;
  /** The store that packed the cart before, or null when Bilka didn't say. */
  previousStoreId: string | null;
};

/** Bilka's answer to setting the slot. */
export type SlotChange = {
  slot: ChosenSlot;
  /** e.g. "Tir. 03/11. kl. 08:00 - 10:00". */
  text: string | null;
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
   * True for a timeout, HTTP 429 or HTTP 5xx, where the same request may
   * succeed after a short wait. False otherwise: Bilka rejected the request,
   * or couldn't be reached at all.
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

/**
 * Bilka couldn't be reached at all (DNS failure, connection refused). Not
 * retried: it rarely clears up within a retry's wait.
 */
export class UnreachableError extends BilkaError {
  constructor(what: string, cause: unknown) {
    super(`${what} failed: could not reach Bilka`, { cause });
    this.name = "UnreachableError";
  }
}

/**
 * Sends one request with the standard timeout. A timeout becomes a retryable
 * BilkaError, any other network failure an UnreachableError.
 */
async function send(
  fetch: typeof globalThis.fetch,
  what: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new BilkaError(`${what} timed out`, { retryable: true, cause: error });
    }
    throw new UnreachableError(what, error);
  }
}

async function readJson(what: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new BilkaError(`${what} answered with something that isn't JSON`, { cause: error });
  }
}

/** The decoded answer of an HTTP 2xx; any other status becomes a BilkaError. */
async function okJson(what: string, response: Response): Promise<unknown> {
  if (!response.ok) {
    const { status } = response;
    throw new BilkaError(`${what} failed with HTTP ${status}`, {
      status,
      retryable: status === 429 || status >= 500,
    });
  }
  return readJson(what, response);
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
    return okJson(what, await send(fetch, what, url, init));
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
    { scrub = true }: { scrub?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    for (let attempt = 1; ; attempt++) {
      const jwt = await session.jwt();
      const answer = await shopAnswer(
        what,
        shopUrl(endpoint, params),
        { ...init, headers: { ...(init.headers as Record<string, string>), jwt_token: jwt } },
        scrub,
      );
      if (answer !== NOT_LOGGED_IN) return answer;
      if (attempt === 2) throw new NotLoggedInError(what);
      session.rejected(jwt);
    }
  }

  /** One shop call: its answer, scrubbed unless `scrub` is false, or NOT_LOGGED_IN. */
  async function shopAnswer(
    what: string,
    url: string,
    init: RequestInit,
    scrub: boolean,
  ): Promise<Record<string, unknown> | typeof NOT_LOGGED_IN> {
    const response = await send(fetch, what, url, init);
    if (response.status === 401 || response.status === 403) return NOT_LOGGED_IN;
    const data = await okJson(what, response);
    if (!isRecord(data)) throw new BilkaError(`${what} answered with something unexpected`);
    if (isNotLoggedIn(data)) return NOT_LOGGED_IN;
    if (isShopError(data)) {
      throw new BilkaError(`${what} failed: Bilka refused the request (code ${data.code})`);
    }
    return scrub ? (scrubPersonalData(data) as Record<string, unknown>) : data;
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
    async searchProducts({ storeId, query, filters: wanted, sort, page, limit }) {
      const filters = productFilters(storeId, {
        ...wanted,
        // A mix id is the same in every store, but only some stores give the
        // product the offer: keep the mix to products on offer at this store.
        onlyOffers: wanted.onlyOffers || wanted.mixOfferId !== undefined,
      });
      if (wanted.category !== undefined) filters.push(categoryFilter(wanted.category));
      if (wanted.mixOfferId !== undefined) {
        if (!MIX_OFFER_ID_PATTERN.test(wanted.mixOfferId)) {
          throw new BilkaError(`Not a mix offer id: ${JSON.stringify(wanted.mixOfferId)}`);
        }
        filters.push(`multipromos:${wanted.mixOfferId}`);
      }
      const data = await algolia("Product search", `/1/indexes/${SORT_INDEXES[sort]}/query`, {
        query,
        hitsPerPage: limit,
        // Algolia counts pages from 0.
        page: page - 1,
        filters: filters.join(" AND "),
        attributesToRetrieve: PRODUCT_ATTRIBUTES.concat(`storeData.${storeId}`),
      });
      const hits = arrayField(data, "hits", "Product search answered without results");
      const { nbPages, nbHits } = data as { nbPages?: unknown; nbHits?: unknown };
      const products = hits.map((hit) => toProduct(hit as AlgoliaProduct, storeId));
      return {
        products: sort === "relevance" ? products : cheapestFirst(products, sort),
        page,
        totalPages: typeof nbPages === "number" ? nbPages : 0,
        totalResults: typeof nbHits === "number" ? nbHits : hits.length,
      };
    },

    async listCategories({ storeId, parent, filters: wanted }) {
      const filters = productFilters(storeId, wanted);
      if (parent !== undefined) filters.push(categoryFilter(parent));
      // The children sit one level below the parent: lvl0 without one.
      const facet = `${HIERARCHY}.lvl${parent === undefined ? 0 : categoryLevel(parent) + 1}`;
      const data = await algolia("Category list", `/1/indexes/${ALGOLIA_PRODUCT_INDEX}/query`, {
        query: "",
        hitsPerPage: 0,
        filters: filters.join(" AND "),
        facets: [facet],
        maxValuesPerFacet: MAX_VALUES_PER_FACET,
      });
      if (!isRecord(data)) throw new BilkaError("Category list answered without results");
      const counts =
        isRecord(data.facets) && isRecord(data.facets[facet]) ? data.facets[facet] : {};
      // A product filed under two parents brings the other parent's children along.
      const prefix = parent === undefined ? "" : parent + CATEGORY_SEPARATOR;
      const categories = Object.entries(counts)
        .filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" &&
            entry[0] !== UNCATEGORIZED &&
            entry[0].startsWith(prefix),
        )
        .map(([category, count]) => ({
          category,
          name: category.split(CATEGORY_SEPARATOR).at(-1) ?? category,
          product_count: count,
        }))
        .sort(
          (a, b) => b.product_count - a.product_count || a.category.localeCompare(b.category, "da"),
        );
      const { nbHits } = data;
      return { categories, productCount: typeof nbHits === "number" ? nbHits : 0 };
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

    async getDeliveryPlaces() {
      const data = await shopJson("Delivery place list", "v6/AvailableDeliveryAddresses", {
        orderByZipcode: "",
      });
      const places = arrayField(data, "addresses", "Delivery place list answered without places");
      return {
        currentPlaceId: toPlace(data.activeAddress)?.place_id ?? null,
        places: toPlaces(places),
      };
    },

    async setDeliveryPlace(placeId) {
      const what = "Changing the delivery place";
      // Read unscrubbed on purpose, and the only such read: switching to home
      // delivery means sending the account's own street and address id
      // (`dawa_uid`) back to Bilka, as the website does. They go from this
      // answer straight into the request and are never returned or logged.
      const list = await shopJson(
        "Delivery place list",
        "v6/AvailableDeliveryAddresses",
        { orderByZipcode: "" },
        { method: "GET" },
        { scrub: false },
      );
      const places = (Array.isArray(list.addresses) ? list.addresses : []).filter(isRecord);
      const homes = places.filter((place) => place.facility === HOME_DELIVERY_FACILITY);
      const target =
        homes.find((_, index) => homeLabel(index + 1) === placeId) ??
        places.find(
          (place) => place.facility !== HOME_DELIVERY_FACILITY && String(place.id) === placeId,
        );
      if (target === undefined) return null;
      // toPlace keeps only the kind, store and minimum, plus the id and name
      // of a public place, so it's safe on the unscrubbed entry.
      const place = toPlace(target, placeId);
      if (place === null) return null;
      const active = isRecord(list.activeAddress) ? list.activeAddress : {};
      const previousStoreId = text(String(active.sid ?? ""));
      if (String(active.id) === String(target.id)) {
        return { place, changed: false, previousStoreId };
      }
      const params: Record<string, string> =
        target.facility === HOME_DELIVERY_FACILITY
          ? { dawa_uid: text(target.dawa_uid) ?? "", street: text(target.street) ?? "" }
          : { id: placeId, zipcode: String(target.zip ?? "") };
      if (target.facility === HOME_DELIVERY_FACILITY && (!params.dawa_uid || !params.street)) {
        throw new BilkaError(`${what} failed: Bilka's place list holds no home address to send`);
      }
      const answer = await shopJson(what, "v6/SetDeliveryAddress", { ...params, basketguid: "" });
      // The answer is scrubbed, so a home address shows only its kind.
      const now = toPlace(answer.activeAddress, placeId);
      if (now === null || now.kind !== place.kind || now.place_id !== placeId) {
        throw new BilkaError(`${what} failed: Bilka didn't switch the cart${saying(answer.msg)}`);
      }
      return { place, changed: true, previousStoreId };
    },

    async getDeliverySlots() {
      return toDeliverySlots(await shopJson("Delivery slot list", "v3/AvailableDeliveryDates", {}));
    },

    async setDeliverySlot(slot) {
      const what = "Setting the delivery slot";
      const answer = await shopJson(what, "v3/SetDeliveryDate", {
        deliveryDate: slot.date,
        intervalStart: slot.start,
        intervalEnd: slot.end,
      });
      const set = chosenSlot(
        text(answer.deliveryDate) ?? undefined,
        text(answer.intervalStart) ?? undefined,
        text(answer.intervalEnd) ?? undefined,
      );
      if (set?.date !== slot.date || set.start !== slot.start) {
        throw new BilkaError(`${what} failed: Bilka didn't set the slot${saying(answer.msg)}`);
      }
      return { slot: set, text: text(answer.delivery_message) };
    },

    async getOrderHistory({ offset, limit }) {
      // POST, as the website and nickknissen send it (docs/research.md §3).
      // `muah: "1"` is sent because the website sends it; what it means is
      // unconfirmed (orders carry a boolean `muah` field too).
      const data = await shopJson(
        "Order history",
        "v7/OrderHistory",
        { limit: String(limit), offset: String(offset), muah: "1", ordertype: "dibs,pgw" },
        { method: "POST" },
      );
      return toOrderHistoryPage(data, { offset, limit });
    },

    async getOrderDetails(orderId) {
      const data = await shopJson("Order details", "v7/OrderDetails", { orderId });
      return isRecord(data.order) ? toOrderDetails(data.order) : null;
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

/** ": <Bilka's message>" when the answer carries one, for error messages. */
function saying(message: unknown): string {
  const said = text(message);
  return said === null ? "" : `. Bilka says: ${JSON.stringify(said)}`;
}

/** The shop said the request isn't logged in. */
const NOT_LOGGED_IN = Symbol("not logged in");

/**
 * The shop's error envelope: HTTP 200 with a `code` and a `msg`. The code is
 * a number in the reference clients (`code: 1`) and a string live
 * (`code: "ACCESS_DENIED"`, 2026-11-02). Real answers carry no `code`.
 */
function isShopError(
  data: Record<string, unknown>,
): data is Record<string, unknown> & { code: number | string; msg: string } {
  const { code } = data;
  const isCode =
    (typeof code === "number" && code !== 0) ||
    (typeof code === "string" && code !== "" && code !== "0");
  return isCode && typeof data.msg === "string";
}

/**
 * The shop's "not logged in" answer: the error envelope with a `uid` of 0 or
 * less. Live (2026-11-02, no JWT sent): `{msg: "Metoden kræver login", code:
 * "ACCESS_DENIED", eid: 401, uid: -1}`. `code: 1` (`{code: 1, msg: "Du er ikke
 * logget ind"}`, nickknissen/bilkatogo) counts too. Other errors carry the
 * account's own uid. HTTP 401 and 403 count as well (see `shopAnswer`).
 */
function isNotLoggedIn(data: Record<string, unknown>): boolean {
  if (!isShopError(data)) return false;
  const uid = Number(data.uid);
  return (
    data.code === 1 ||
    data.code === "ACCESS_DENIED" ||
    (data.uid !== undefined && Number.isFinite(uid) && uid <= 0)
  );
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

/**
 * The page in the store's order for `sort`: a sort replica's key isn't the
 * selected store's price (docs/research.md §3). Ties keep the index's order;
 * products without the price come last.
 */
function cheapestFirst(products: Product[], sort: "price" | "unit_price"): Product[] {
  const key = (product: Product) => product[sort] ?? Number.POSITIVE_INFINITY;
  return products.toSorted((a, b) => (key(a) === key(b) ? 0 : key(a) < key(b) ? -1 : 1));
}

/**
 * The Algolia filter terms every product query at `storeId` starts with: the
 * store's assortment, searchable products, and the flags that are on.
 */
function productFilters(storeId: string, wanted: CategoryFilters): string[] {
  const filters = [`isInAssortmentIn:${storeId}`, "nonsearchable:false"];
  if (wanted.onlyInStock) filters.push(`inStockStore:${storeId}`);
  if (wanted.onlyOffers) filters.push(`isInOffer:${storeId}`);
  // A global flag: the leaflet is the same in every store (docs/research.md §3).
  if (wanted.onlyLeaflet) filters.push("isInCurrentLeaflet:true");
  return filters;
}

// The menu's category tree: `<HIERARCHY>.lvlN` holds a product's level-N paths.
const HIERARCHY = "consumerFacingHierarchy";
// Category paths join their levels' names with this, e.g. "Mejeri & køl > Pålæg".
const CATEGORY_SEPARATOR = " > ";
// The bucket of products outside the menu's tree. It isn't a menu category.
const UNCATEGORIZED = "Not Categorized";
// Algolia's ceiling. One level under one parent is far smaller, so nothing is cut off.
const MAX_VALUES_PER_FACET = 1000;

/**
 * A category path's level in the tree: 0 at the top, one more per " > ".
 * Throws on anything that isn't a category path, so no other text can reach
 * a filter.
 */
function categoryLevel(path: string): number {
  if (!CATEGORY_PATH_PATTERN.test(path)) {
    throw new BilkaError(`${JSON.stringify(path)} isn't a category path`);
  }
  return path.split(CATEGORY_SEPARATOR).length - 1;
}

/** The filter term for products in the category `path`, at any depth below it. */
function categoryFilter(path: string): string {
  // The pattern rules out `"` and `\`, so the path can't end the quoted value.
  return `${HIERARCHY}.lvl${categoryLevel(path)}:"${path}"`;
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
  isInCurrentLeaflet?: boolean;
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
  /** Ids of the mix offers the product is part of, e.g. ["2680"]. The same in every store. */
  multipromos?: (number | string)[];
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
  /** Items a mix offer takes, e.g. 2 for "Mix 2 for 35,00"; 0 otherwise. */
  offerCount?: number;
  /** What a mix's items cost together, in øre as a string ("3500"); "" when the mix has no price. */
  multiPromoPrice?: string;
  // Not read: `unitsOfMeasureOfferPrice` is filled even on products that aren't on offer.
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
  "isInCurrentLeaflet",
  "inStockStore",
  "deepestCategoryPath",
  "multipromos",
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
    offer_from: store?.offerFrom || null,
    offer_until: store?.offerUntil || null,
    in_leaflet: hit.isInCurrentLeaflet === true,
    in_stock:
      storeId === undefined ? null : (store?.inStock ?? includesStore(hit.inStockStore, storeId)),
    category: hit.deepestCategoryPath || null,
    mix: toMix(hit.multipromos, store, offerText),
  };
}

/**
 * A product is in a mix at the store when it has a mix id and the store gives
 * it an offer text. With several ids the first is used (docs/research.md §3).
 */
function toMix(
  mixIds: (number | string)[] | undefined,
  store: AlgoliaStoreData | undefined,
  offerText: string,
): Mix | null {
  const [mixId] = mixIds ?? [];
  if (mixId === undefined || store === undefined || offerText === "") return null;
  const items = store.offerCount;
  const priceOre = Number(store.multiPromoPrice || Number.NaN);
  return {
    mix_offer_id: String(mixId),
    items: typeof items === "number" && items >= 2 ? items : null,
    price: Number.isFinite(priceOre) && priceOre > 0 ? kroner(priceOre) : null,
  };
}

function toProductDetails(hit: AlgoliaProduct, storeId: string | undefined): ProductDetails {
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
