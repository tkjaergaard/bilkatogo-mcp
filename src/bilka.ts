// The Bilka client: one narrow interface in domain terms over the three Bilka
// hosts (Algolia, Gigya, the BilkaToGo shop API). Callers never see raw HTTP
// or øre.

const ALGOLIA_APP_ID = "F9VBJLR1BK";
// The public, search-only key bilkatogo.dk ships to every browser.
const ALGOLIA_SEARCH_KEY = "1deaf41c87e729779f7695c00f190cc9";
const ALGOLIA_HOST = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;
const ALGOLIA_PRODUCT_INDEX = "prod_BILKATOGO_PRODUCTS";

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
  on_offer: boolean;
  /** The offer text, e.g. "Skarp pris" or "Mix 10 for 25,00". */
  offer: string | null;
  in_stock: boolean;
  /** e.g. "Mejeri & køl > Mejeri > Skyr". */
  category: string | null;
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

  return {
    async searchProducts({ storeId, query, limit, onlyInStock, onlyOffers }) {
      const filters = [`isInAssortmentIn:${storeId}`, "nonsearchable:false"];
      if (onlyInStock) filters.push(`inStockStore:${storeId}`);
      if (onlyOffers) filters.push(`isInOffer:${storeId}`);
      const data = await requestJson(
        "Product search",
        `${ALGOLIA_HOST}/1/indexes/${ALGOLIA_PRODUCT_INDEX}/query`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-algolia-application-id": ALGOLIA_APP_ID,
            "x-algolia-api-key": ALGOLIA_SEARCH_KEY,
          },
          body: JSON.stringify({
            query,
            hitsPerPage: limit,
            filters: filters.join(" AND "),
            attributesToRetrieve: PRODUCT_ATTRIBUTES.concat(`storeData.${storeId}`),
          }),
        },
      );
      const hits = (data as { hits?: unknown } | null)?.hits;
      if (!Array.isArray(hits)) throw new BilkaError("Product search answered without results");
      return hits.map((hit) => toProduct(hit as AlgoliaProduct, storeId));
    },
  };
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
  storeData?: Record<string, AlgoliaStoreData | undefined>;
};

// Prices and offers for one store. Amounts are in øre.
type AlgoliaStoreData = {
  inStock?: boolean;
  price?: number;
  beforePrice?: number;
  offerDescription?: string;
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

function toProduct(hit: AlgoliaProduct, storeId: string): Product {
  const store = hit.storeData?.[storeId];
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
    on_offer: includesStore(hit.isInOffer, storeId),
    offer: PLACEHOLDER_OFFER_LABELS.has(offerText.toLowerCase()) ? null : offerText,
    in_stock: store?.inStock ?? includesStore(hit.inStockStore, storeId),
    category: hit.deepestCategoryPath || null,
  };
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
