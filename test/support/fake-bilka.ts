// A fake Bilka backend for tests: it answers as Algolia, SAP Gigya and the
// BilkaToGo shop API, chosen by request URL. Pass `bilka.fetch` to the server
// factory in place of the real `fetch`.
//
// Each request is matched to a route name (see `routeOf`). A scripted
// response queued for that route answers first; otherwise the route's default
// handler does. Every request is recorded in `bilka.requests`.
//
// Extending it for a new endpoint: add the route to `routeOf` if it isn't
// covered, then add a default handler in `defaultHandlers` that answers from a
// fixture the way the real endpoint does.

import { readFileSync } from "node:fs";

export type RouteName =
  | "algolia.query"
  | "algolia.objects"
  | "gigya.login"
  | "gigya.getJWT"
  | `shop.${string}`
  | "unknown";

/** A route name, or a prefix pattern such as `shop.*`. */
export type RoutePattern = RouteName | `${string}.*`;

export type RecordedRequest = {
  route: RouteName;
  method: string;
  url: URL;
  headers: Headers;
  body: string | undefined;
  /** The body parsed as JSON. */
  json(): unknown;
  /** The body parsed as a form (`application/x-www-form-urlencoded`). */
  form(): URLSearchParams;
};

export type Responder = (request: RecordedRequest) => Response | Promise<Response>;

type Script = { pattern: RoutePattern; respond: Responder; remaining: number };

export const ALGOLIA_APP_ID = "F9VBJLR1BK";
export const ALGOLIA_SEARCH_KEY = "1deaf41c87e729779f7695c00f190cc9";
export const ALGOLIA_PRODUCT_INDEX = "prod_BILKATOGO_PRODUCTS";

export function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** What `fetch` throws when its `AbortSignal.timeout()` fires. */
export function timeoutError(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

export function routeOf(url: URL): RouteName {
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".algolia.net")) {
    if (/^\/1\/indexes\/[^/]+\/query$/.test(url.pathname)) return "algolia.query";
    if (url.pathname === "/1/indexes/*/objects") return "algolia.objects";
  }
  if (host === "accounts.eu1.gigya.com") {
    if (url.pathname === "/accounts.login") return "gigya.login";
    if (url.pathname === "/accounts.getJWT") return "gigya.getJWT";
  }
  if (host === "api.bilkatogo.dk") {
    // `/api/shop/v6/Cart` → `shop.Cart`. The version stays visible in `url`.
    const match = /^\/api\/shop\/v\d+\/([^/]+)$/.exec(url.pathname);
    if (match) return `shop.${match[1]}`;
  }
  return "unknown";
}

function matches(pattern: RoutePattern, route: RouteName): boolean {
  return pattern.endsWith(".*") ? route.startsWith(pattern.slice(0, -1)) : pattern === route;
}

export class FakeBilka {
  /** Every request received, in order. */
  readonly requests: RecordedRequest[] = [];
  /**
   * The Algolia product index. The search fixture's hits, with full live
   * records (which carry `infos`: nutrition, ingredients and so on) in place
   * of their trimmed copies.
   */
  products: Record<string, any>[] = replaceById(loadFixture("algolia-products.json").hits, [
    loadFixture("algolia-object-19753.json"),
  ]);
  /** The public delivery-address list (stores and pickup points). */
  deliveryAddresses: Record<string, any> = loadFixture("available-delivery-addresses.json");

  private scripts: Script[] = [];

  /** Use in place of the real `fetch`. */
  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.body === null ? undefined : await request.text();
    const recorded: RecordedRequest = {
      route: routeOf(url),
      method: request.method,
      url,
      headers: request.headers,
      body,
      json: () => JSON.parse(body ?? ""),
      form: () => new URLSearchParams(body ?? ""),
    };
    this.requests.push(recorded);
    return this.respond(recorded);
  };

  /** Recorded requests for a route or pattern such as `shop.*`. */
  calls(pattern: RoutePattern): RecordedRequest[] {
    return this.requests.filter((request) => matches(pattern, request.route));
  }

  /**
   * Answer the next `times` requests for the route with `respond` instead of
   * the default handler. Scripts answer in the order they were queued.
   */
  script(pattern: RoutePattern, respond: Responder, times = 1): this {
    this.scripts.push({ pattern, respond, remaining: times });
    return this;
  }

  /** Fail the next `times` requests for the route with an HTTP status, then answer normally. */
  failTimes(pattern: RoutePattern, times: number, status = 503): this {
    return this.script(
      pattern,
      () => jsonResponse({ message: `fake HTTP ${status}` }, status),
      times,
    );
  }

  /** Make the next `times` requests for the route time out, as `fetch` does when its timeout signal fires. */
  timeOut(pattern: RoutePattern, times = 1): this {
    return this.script(
      pattern,
      () => {
        throw timeoutError();
      },
      times,
    );
  }

  /**
   * Answer shop calls as Bilka does when the JWT is missing, expired or
   * rejected. Unverified shape, from nickknissen/bilkatogo; confirm against a
   * captured response.
   */
  rejectJwt(times = Number.POSITIVE_INFINITY): this {
    return this.script(
      "shop.*",
      () => jsonResponse({ code: 1, msg: "Du er ikke logget ind" }),
      times,
    );
  }

  /**
   * Answer Gigya's password login as it does for a wrong email or password.
   * Unverified shape, from nickknissen/bilkatogo; confirm against a captured response.
   */
  rejectPasswordLogin(times = Number.POSITIVE_INFINITY): this {
    return this.script(
      "gigya.login",
      () =>
        jsonResponse(
          {
            errorCode: 403042,
            errorDetails: "invalid loginID or password",
            errorMessage: "Invalid LoginID",
            statusCode: 403,
            statusReason: "Forbidden",
          },
          403,
        ),
      times,
    );
  }

  private async respond(request: RecordedRequest): Promise<Response> {
    const script = this.scripts.find((s) => s.remaining > 0 && matches(s.pattern, request.route));
    if (script) {
      script.remaining -= 1;
      return script.respond(request);
    }
    const handler = this.defaultHandlers[request.route];
    if (handler) return handler(request);
    return jsonResponse(
      { message: `FakeBilka has no handler for ${request.method} ${request.url.href}` },
      request.route === "unknown" ? 404 : 501,
    );
  }

  private readonly defaultHandlers: Partial<Record<RouteName, Responder>> = {
    "algolia.query": (request) => this.algoliaQuery(request),
    "algolia.objects": (request) => this.algoliaObjects(request),
    "shop.AvailableDeliveryAddresses": (request) =>
      request.method === "GET"
        ? jsonResponse(this.deliveryAddresses)
        : jsonResponse({ message: "Method not allowed" }, 405),
  };

  /**
   * Algolia's single-index query. Text relevance is Algolia's job, so the fake
   * ignores the query text and returns every product that passes `filters`,
   * limited by `hitsPerPage` and projected by `attributesToRetrieve`.
   */
  private algoliaQuery(request: RecordedRequest): Response {
    const denied = checkAlgoliaKey(request);
    if (denied) return denied;
    const index = decodeURIComponent(request.url.pathname.split("/")[3] ?? "");
    if (index !== ALGOLIA_PRODUCT_INDEX) {
      return jsonResponse({ message: "Index does not exist", status: 404 }, 404);
    }
    const params = request.json() as {
      query?: string;
      filters?: string;
      hitsPerPage?: number;
      attributesToRetrieve?: string[];
    };
    const filter = parseFilters(params.filters ?? "");
    const hitsPerPage = params.hitsPerPage ?? 20;
    const matching = this.products.filter(filter);
    const hits = matching
      .slice(0, hitsPerPage)
      .map((product) => project(product, params.attributesToRetrieve ?? ["*"]));
    return jsonResponse({
      hits,
      nbHits: matching.length,
      page: 0,
      nbPages: Math.ceil(matching.length / hitsPerPage),
      hitsPerPage,
      query: params.query ?? "",
      index,
    });
  }

  /**
   * Algolia's multi-index object lookup. Like the live index (checked
   * 2026-11-02), a request without `attributesToRetrieve` gets only the
   * objectID back, and an unknown objectID gets `null` plus a message.
   */
  private algoliaObjects(request: RecordedRequest): Response {
    const denied = checkAlgoliaKey(request);
    if (denied) return denied;
    const { requests } = request.json() as {
      requests: { indexName: string; objectID: string; attributesToRetrieve?: string[] }[];
    };
    const missing: string[] = [];
    const results = requests.map(({ indexName, objectID, attributesToRetrieve }) => {
      if (indexName !== ALGOLIA_PRODUCT_INDEX) {
        throw new Error(`FakeBilka has no Algolia index ${JSON.stringify(indexName)}`);
      }
      const product = this.products.find((p) => p.objectID === objectID);
      if (!product) {
        missing.push(objectID);
        return null;
      }
      return project(product, attributesToRetrieve ?? []);
    });
    return jsonResponse(
      missing.length === 0
        ? { results }
        : { results, message: missing.map((id) => `ObjectID ${id} does not exist. `).join("") },
    );
  }
}

function checkAlgoliaKey(request: RecordedRequest): Response | undefined {
  if (
    request.headers.get("x-algolia-application-id") !== ALGOLIA_APP_ID ||
    request.headers.get("x-algolia-api-key") !== ALGOLIA_SEARCH_KEY
  ) {
    return jsonResponse({ message: "Invalid Application-ID or API key", status: 403 }, 403);
  }
  return undefined;
}

function replaceById(
  records: Record<string, any>[],
  replacements: Record<string, any>[],
): Record<string, any>[] {
  const byId = new Map(replacements.map((record) => [record.objectID, record]));
  return records.map((record) => byId.get(record.objectID) ?? record);
}

/**
 * Supports the Algolia filter syntax the server uses: `attr:value` terms
 * joined by `AND`. An array attribute matches when it contains the value.
 * Anything else throws, so a test fails loudly instead of matching wrongly.
 */
function parseFilters(filters: string): (product: Record<string, any>) => boolean {
  if (filters.trim() === "") return () => true;
  const terms = filters.split(" AND ").map((term) => {
    const match = /^\s*([A-Za-z_][\w.]*):([\w-]+)\s*$/.exec(term);
    if (!match)
      throw new Error(`FakeBilka can't parse Algolia filter term: ${JSON.stringify(term)}`);
    return { attribute: match[1]!, value: match[2]! };
  });
  return (product) =>
    terms.every(({ attribute, value }) => {
      const actual = product[attribute];
      if (Array.isArray(actual)) return actual.some((item) => String(item) === value);
      return String(actual) === value;
    });
}

function project(product: Record<string, any>, attributes: string[]): Record<string, any> {
  if (attributes.includes("*")) return structuredClone(product);
  const out: Record<string, any> = { objectID: product.objectID };
  for (const path of attributes) {
    const [head, ...rest] = path.split(".");
    if (head === undefined || !(head in product)) continue;
    if (rest.length === 0) {
      out[head] = structuredClone(product[head]);
      continue;
    }
    const key = rest.join(".");
    const nested = product[head]?.[key];
    if (nested !== undefined) out[head] = { ...out[head], [key]: structuredClone(nested) };
  }
  return out;
}
