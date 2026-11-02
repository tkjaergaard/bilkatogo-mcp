// The Bilka client: one narrow interface in domain terms over the three Bilka
// hosts (Algolia, Gigya, the BilkaToGo shop API). Callers never see raw HTTP
// or øre.

const ALGOLIA_APP_ID = "F9VBJLR1BK";
// The public, search-only key bilkatogo.dk ships to every browser.
const ALGOLIA_SEARCH_KEY = "1deaf41c87e729779f7695c00f190cc9";
const ALGOLIA_HOST = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;
const ALGOLIA_PRODUCT_INDEX = "prod_BILKATOGO_PRODUCTS";

const SHOP_HOST = "https://api.bilkatogo.dk";

const REQUEST_TIMEOUT_MS = 30_000;

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
};

/** A failure talking to Bilka. The message is safe to show the model. */
export class BilkaError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "BilkaError";
    this.status = options.status;
  }
}

export function createBilkaClient(options: { fetch: typeof fetch }): BilkaClient {
  const { fetch } = options;

  async function requestJson(what: string, url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new BilkaError(
        timedOut ? `${what} timed out` : `${what} failed: could not reach Bilka`,
        {
          cause: error,
        },
      );
    }
    if (!response.ok) {
      throw new BilkaError(`${what} failed with HTTP ${response.status}`, {
        status: response.status,
      });
    }
    try {
      return await response.json();
    } catch (error) {
      throw new BilkaError(`${what} answered with something that isn't JSON`, { cause: error });
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
      const hits = (data as { hits?: unknown } | null)?.hits;
      if (!Array.isArray(hits)) throw new BilkaError("Product search answered without results");
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
      const results = (data as { results?: unknown } | null)?.results;
      if (!Array.isArray(results)) throw new BilkaError("Product lookup answered without results");
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
      const addresses = (data as { addresses?: unknown } | null)?.addresses;
      if (!Array.isArray(addresses)) throw new BilkaError("Store list answered without stores");
      return toStores(addresses as DeliveryAddress[]);
    },
  };
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

/** øre → DKK. */
function kroner(ore: number | undefined): number | null {
  return ore === undefined ? null : Math.round(ore) / 100;
}

function normaliseUnit(unit: string | undefined): string | null {
  const normalised = (unit ?? "").trim().replace(/\.$/, "").toLowerCase();
  return normalised || null;
}

function includesStore(stores: (number | string)[] | undefined, storeId: string): boolean {
  return (stores ?? []).some((store) => String(store) === storeId);
}
