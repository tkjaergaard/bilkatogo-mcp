// A fake Bilka backend for tests: it answers as Algolia, SAP Gigya, the
// BilkaToGo shop API and Salling Group's recommendations API, chosen by
// request URL. Pass `bilka.fetch` to the server
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
  | "salling.mostBought"
  | "salling.alternatives"
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
const ALGOLIA_PRODUCT_INDEX = "prod_BILKATOGO_PRODUCTS";
/**
 * The website's two sort replicas, "Billigst" and "Laveste enhedspris", and
 * the record attribute the fake sorts each by. Live, the sort key isn't the
 * selected store's price (docs/research.md §3); the fake deliberately sorts by
 * the record's top-level list price and unit price. Like the live unit-price
 * index, they ignore the store's offer, so they differ from the store's price
 * on discounted products and the client's re-sort is tested.
 */
const ALGOLIA_SORT_INDEXES: Record<string, string> = {
  prod_r_BILKATOGO_PRODUCT_pricesort: "price",
  prod_r_BILKATOGO_PRODUCT_uompricesort: "unitOfMeasurePrice",
};
/** The shared key bilkatogo.dk sends to Salling Group's API (docs/research.md §3). */
export const SALLING_API_KEY = "45c0740c-f037-4915-89c0-171f6edf9fd3";
export const GIGYA_API_KEY = "3_tA6BbV434FQqN73HnUG1KA3qFv8KiG4OqLu9eWPh7sKRqRizH5Vfv5Larmgrb4I2";

/** The login token in the scrubbed fixtures (`gigya-login.json`). */
export const LOGIN_TOKEN = "test-login-token";
/** The JWT Gigya hands out for it (`gigya-jwt.json`). */
export const JWT = "test-jwt";
/** The account's email in the scrubbed fixtures (`gigya-login.json` profile). */
export const EMAIL = "test@example.com";
/** The password the fake Gigya accepts for EMAIL. */
export const PASSWORD = "test-password";

/** Gigya's answer to a wrong email or password. Unverified shape (SAP's error-code list, nickknissen/bilkatogo). */
const GIGYA_INVALID_PASSWORD = {
  errorCode: 403042,
  errorDetails: "invalid loginID or password",
  errorMessage: "Invalid LoginID",
  statusCode: 403,
  statusReason: "Forbidden",
};

/** Gigya's answer to an unknown or expired login token. Unverified shape (SAP's error-code list). */
const GIGYA_INVALID_TOKEN = {
  errorCode: 403005,
  errorDetails: "Unauthorized user",
  errorMessage: "Unauthorized user",
  statusCode: 403,
  statusReason: "Forbidden",
};

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
function timeoutError(): DOMException {
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
  if (host === "api.sallinggroup.com") {
    if (url.pathname === "/v2/recommendations/most-bought/bilkatogo") return "salling.mostBought";
    if (url.pathname.startsWith("/v2/recommendations/alternative-products/bilkatogo/")) {
      return "salling.alternatives";
    }
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
  /** The email and password Gigya's password login accepts. */
  email = EMAIL;
  password = PASSWORD;
  /** The login token Gigya accepts, and hands out on a password login. */
  loginToken = LOGIN_TOKEN;
  /** The JWT Gigya issues and the shop accepts. */
  jwt = JWT;
  /** The logged-in cart `shop/v6/Cart` answers with. */
  cart: Record<string, any> = loadFixture("shop-cart.json");
  /** The account's past orders, newest first, as `shop/v7/OrderHistory` lists them. */
  orders: Record<string, any>[] = loadFixture("shop-order-history.json").orders;
  /**
   * The logged-in place list (`shop-delivery-places.json`): the account's home
   * (999001, the cart's place) and three public places. Its `activeAddress` is
   * always the cart's `deliveryAddress`.
   */
  places: Record<string, any>[] = loadFixture("shop-delivery-places.json").addresses;
  /**
   * `shop/v3/AvailableDeliveryDates` answers, by place id. Home delivery has
   * one night slot a day; every other place answers with the Bilka Odense
   * pickup capture's two-hour slots.
   */
  slotsByPlace: Record<string, Record<string, any>> = {
    "999001": loadFixture("shop-delivery-dates.json"),
  };
  /** `shop/v7/OrderDetails` answers, by order id. */
  orderDetails: Record<string, Record<string, any>> = {
    "900000000001": loadFixture("shop-order-details.json").order,
  };

  /**
   * Salling's alternative products, by the sku in the request path. The
   * bananas (18381) have three: two products in the index and one it lacks.
   */
  alternativesBySku: Record<string, Record<string, any>[]> = {
    "89300500105": loadFixture("salling-alternative-products.json").output[0].suggestions,
  };

  /**
   * Salling's most-bought lists, by `customerId`: the shop's `tid` for the
   * account (`test-tid` in the cart fixture). A synthetic list of index
   * products, plus one the index lacks (999999).
   */
  mostBoughtByCustomer: Record<string, Record<string, any>[]> = {
    "test-tid": loadFixture("salling-most-bought.json").output.suggestions,
  };
  /** What most-bought answers for any other `customerId`, or none: the shop's bestsellers. */
  bestsellers: Record<string, any>[] = [
    { name: "skyr m vanilje 0,2% fedt u tilsat sukker", productId: "19753", sku: "17924601" },
  ];

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
   * Make the next `times` requests for the route fail as `fetch` does when the
   * host can't be reached (DNS failure, connection refused).
   */
  unreachable(pattern: RoutePattern, times = 1): this {
    return this.script(
      pattern,
      () => {
        throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
      },
      times,
    );
  }

  /**
   * Answer shop calls as Bilka does when the JWT is missing, expired or
   * rejected (`shop-not-logged-in.json`, captured without a JWT).
   */
  rejectJwt(times = Number.POSITIVE_INFINITY): this {
    return this.script("shop.*", () => jsonResponse(NOT_LOGGED_IN), times);
  }

  /** Answer the JWT exchange as Gigya does for an unknown or expired login token. */
  rejectLoginToken(times = Number.POSITIVE_INFINITY): this {
    return this.script("gigya.getJWT", () => jsonResponse(GIGYA_INVALID_TOKEN, 403), times);
  }

  /**
   * Answer Gigya's password login as it does for a wrong email or password.
   * Unverified shape, from nickknissen/bilkatogo; confirm against a captured response.
   */
  rejectPasswordLogin(times = Number.POSITIVE_INFINITY): this {
    return this.script("gigya.login", () => jsonResponse(GIGYA_INVALID_PASSWORD, 403), times);
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
    "shop.AvailableDeliveryAddresses": (request) => {
      if (request.method !== "GET") return jsonResponse({ message: "Method not allowed" }, 405);
      // Anonymous: the public list. Logged in: the account's own place list.
      if (!request.headers.has("jwt_token")) return jsonResponse(this.deliveryAddresses);
      return this.requireJwt(request) ?? this.placeList();
    },
    "shop.SetDeliveryAddress": (request) => this.requireJwt(request) ?? this.setPlace(request),
    "shop.AvailableDeliveryDates": (request) =>
      this.requireJwt(request) ?? jsonResponse(this.slotAnswer()),
    "shop.SetDeliveryDate": (request) => this.requireJwt(request) ?? this.setSlot(request),
    "salling.alternatives": (request) => this.alternatives(request),
    "salling.mostBought": (request) => this.mostBought(request),
    "gigya.login": (request) => this.gigyaLogin(request),
    "gigya.getJWT": (request) => this.gigyaGetJwt(request),
    "shop.Cart": (request) =>
      this.requireJwt(request) ??
      (request.method === "GET"
        ? jsonResponse(structuredClone(this.cart))
        : jsonResponse({ message: "Method not allowed" }, 405)),
    "shop.ChangeLineCount": (request) =>
      this.requireJwt(request) ??
      (request.method === "GET"
        ? this.changeLineCount(request)
        : jsonResponse({ message: "Method not allowed" }, 405)),
    "shop.OrderHistory": (request) => this.requireJwt(request) ?? this.orderHistory(request),
    "shop.OrderDetails": (request) => this.requireJwt(request) ?? this.orderDetail(request),
  };

  /**
   * Gigya's password login. Answers like the capture (`gigya-login.json`),
   * with the current login token as `sessionInfo.cookieValue`, for the right
   * email and password; otherwise with Gigya's error.
   */
  private gigyaLogin(request: RecordedRequest): Response {
    const denied = checkGigyaKey(request);
    if (denied) return denied;
    const form = request.form();
    if (form.get("loginID") !== this.email || form.get("password") !== this.password) {
      return jsonResponse(GIGYA_INVALID_PASSWORD, 403);
    }
    const answer = loadFixture<Record<string, any>>("gigya-login.json");
    answer.sessionInfo.cookieValue = this.loginToken;
    return jsonResponse(answer);
  }

  /**
   * Sets one product's line in `this.cart` to `count` (0 removes it) and
   * answers like the capture (`shop-change-line-count.json`). A product not
   * yet in the cart is added from the product index at its regular price.
   */
  private changeLineCount(request: RecordedRequest): Response {
    const productId = request.url.searchParams.get("productId") ?? "";
    const count = Number(request.url.searchParams.get("count"));
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`FakeBilka got ChangeLineCount with count ${JSON.stringify(count)}`);
    }
    const groups: { headline?: string; lines: { orderlines: Record<string, any>[] }[] }[] =
      this.cart.lines;
    let orderline: Record<string, any> | undefined;
    for (const group of groups) {
      for (const line of group.lines) {
        line.orderlines = line.orderlines.filter((candidate) => {
          if (String(candidate.product?.objectID) !== productId) return true;
          orderline = candidate;
          return count > 0;
        });
      }
      group.lines = group.lines.filter((line) => line.orderlines.length > 0);
    }
    this.cart.lines = groups.filter((group) => group.lines.length > 0);
    if (orderline === undefined && count > 0) {
      const product = this.products.find((p) => p.objectID === productId);
      if (product === undefined) {
        throw new Error(`FakeBilka has no product ${productId} to add to the cart`);
      }
      orderline = {
        quantity: 0,
        unitprice: product.price,
        amount: 0,
        comment: "",
        unavailable_reason: "",
        product: { objectID: Number(productId), name: product.name, brand: product.brand },
      };
      this.cart.lines.push({ headline: "Diverse", type: "", lines: [{ orderlines: [orderline] }] });
    }
    if (orderline !== undefined) {
      orderline.quantity = count;
      orderline.amount = orderline.unitprice * count;
    }
    const all = this.cart.lines.flatMap((group: (typeof groups)[number]) =>
      group.lines.flatMap((line) => line.orderlines),
    );
    this.cart.stat.price = all.reduce((sum: number, line: any) => sum + line.amount, 0);
    this.cart.stat.amount = all.reduce((sum: number, line: any) => sum + line.quantity, 0);
    return jsonResponse({
      ...loadFixture<object>("shop-change-line-count.json"),
      unitCount: this.cart.stat.amount,
      sum: this.cart.stat.price,
      productId,
      productAmount: count,
      productUnitPrice: count > 0 ? (orderline?.unitprice ?? 0) : 0,
    });
  }

  /** The logged-in place list, its `activeAddress` the cart's place. */
  private placeList(): Response {
    return jsonResponse({
      ...loadFixture<object>("shop-delivery-places.json"),
      activeAddress: structuredClone(this.cart.deliveryAddress),
      addresses: structuredClone(this.places),
    });
  }

  /**
   * `shop/v6/SetDeliveryAddress`, as the website calls it: `id` and `zipcode`
   * for a store or pickup point, `dawa_uid` and `street` for the home address.
   * Moves the cart there like the live round trip did: the home delivery fee
   * (`Leveringsgebyr`) and minimum order only apply at home, and the chosen
   * slot stays but is marked closed when the place doesn't offer it. An
   * unmatched request answers with an error and changes nothing (unverified shape).
   */
  private setPlace(request: RecordedRequest): Response {
    const query = request.url.searchParams;
    const place = this.places.find((p) =>
      p.facility === 8
        ? query.get("dawa_uid") === p.dawa_uid && query.get("street") === p.street
        : query.get("id") === String(p.id) && query.get("zipcode") === String(p.zip),
    );
    if (place === undefined) {
      return jsonResponse({ msg: "Adressen kunne ikke findes", eid: 5, uid: 1000001 });
    }
    const home = place.facility === 8;
    this.cart.deliveryAddress = structuredClone(place);
    const services = this.cart.lines.find((g: any) => g.headline === "Services");
    const fee = loadFixture("shop-cart.json")
      .lines.find((g: any) => g.headline === "Services")
      .lines.find((l: any) => l.orderlines[0].product.objectID === 119085);
    services.lines = services.lines.filter((l: any) => l.orderlines[0].product.objectID !== 119085);
    if (home) services.lines.push(structuredClone(fee));
    const total = (g: any[]) =>
      g.flatMap((x) => x.lines.flatMap((l: any) => l.orderlines)).reduce((n, o) => n + o.amount, 0);
    this.cart.stat.price = total(this.cart.lines);
    this.cart.stat.delivery_price = home ? 3900 : 0;
    this.cart.stat.minimum_left = home ? Math.max(0, place.minimum_buy - this.cart.stat.price) : 0;
    this.cart.deliveryDate.closed = this.offers(this.cart.deliveryDate) ? 0 : 1;
    const answer = loadFixture<Record<string, any>>(
      home ? "shop-set-delivery-address-home.json" : "shop-set-delivery-address.json",
    );
    return jsonResponse({ ...answer, activeAddress: structuredClone(place) });
  }

  /** The slot answer for the cart's place, with the cart's chosen slot, as live. */
  private slotAnswer(): Record<string, any> {
    const placeId = String(this.cart.deliveryAddress?.id);
    const answer = structuredClone(
      this.slotsByPlace[placeId] ?? loadFixture("shop-delivery-dates-pickup.json"),
    );
    const chosen = this.cart.deliveryDate ?? {};
    answer.deliveryDate = chosen.deliveryDate;
    answer.intervalStart = chosen.intervalStart;
    answer.intervalEnd = chosen.intervalEnd;
    delete answer.msg;
    answer.eid = -1;
    if (!this.offers(chosen, answer)) {
      answer.msg =
        "Det valgte udleveringstidspunkt er desværre ikke tilgængelig på det valgte udleveringssted.";
      answer.eid = -2;
    }
    return answer;
  }

  /** Whether the cart's place offers `slot` as a bookable slot. */
  private offers(
    slot: { deliveryDate?: string; intervalStart?: string },
    answer = this.slotAnswerFor(String(this.cart.deliveryAddress?.id)),
  ): boolean {
    const day = answer.availableIntervals.find((d: any) => d.date === slot.deliveryDate);
    return (day?.intervals ?? []).some(
      (i: any) => i.intervalStart === slot.intervalStart && i.closed === 0,
    );
  }

  private slotAnswerFor(placeId: string): Record<string, any> {
    return this.slotsByPlace[placeId] ?? loadFixture("shop-delivery-dates-pickup.json");
  }

  /**
   * `shop/v3/SetDeliveryDate`: sets the cart's slot when the place offers it,
   * answering like the capture. Otherwise the slot stays and the answer says
   * so (unverified shape: the server checks the slot first).
   */
  private setSlot(request: RecordedRequest): Response {
    const query = request.url.searchParams;
    const wanted = {
      deliveryDate: query.get("deliveryDate") ?? "",
      intervalStart: query.get("intervalStart") ?? "",
      intervalEnd: query.get("intervalEnd") ?? "",
    };
    const answer = loadFixture<Record<string, any>>("shop-set-delivery-date.json");
    if (this.offers(wanted)) {
      const day = new Date(`${wanted.deliveryDate}T12:00:00Z`);
      const weekday = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"][day.getUTCDay()]!;
      const [, mm, dd] = wanted.deliveryDate.split("-");
      const when =
        wanted.intervalStart === "00:00"
          ? `Senest kl. ${wanted.intervalEnd}`
          : `kl. ${wanted.intervalStart} - ${wanted.intervalEnd}`;
      Object.assign(this.cart.deliveryDate, {
        ...wanted,
        displayDeliveryDate: wanted.deliveryDate,
        deliveryDay: weekday,
        closed: 0,
        delivery_message: `${weekday}. ${dd}/${mm}. ${when}`,
      });
    } else {
      answer.msg = "Det valgte tidspunkt er ikke tilgængeligt";
    }
    const { deliveryDate, displayDeliveryDate, deliveryDay, intervalStart, intervalEnd } =
      this.cart.deliveryDate;
    return jsonResponse({
      ...answer,
      deliveryDate,
      displayDeliveryDate,
      deliveryDay,
      intervalStart,
      intervalEnd,
      closed: this.cart.deliveryDate.closed,
      delivery_message: this.cart.deliveryDate.delivery_message,
    });
  }

  /**
   * `shop/v7/OrderHistory`: a POST with `limit` and `offset` in the query,
   * answered in the captured shape (`limit` comes back as a string there).
   */
  private orderHistory(request: RecordedRequest): Response {
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);
    const fixture = loadFixture("shop-order-history.json");
    const limit = Number(request.url.searchParams.get("limit") ?? "5");
    const offset = Number(request.url.searchParams.get("offset") ?? "0");
    return jsonResponse({
      ...fixture,
      limit: String(limit),
      offset,
      orders: structuredClone(this.orders.slice(offset, offset + limit)),
      total: this.orders.length,
    });
  }

  /**
   * `shop/v7/OrderDetails?orderId=…`. No capture shows the answer for an
   * order the account doesn't have; the fake answers `{order: null}`.
   */
  private orderDetail(request: RecordedRequest): Response {
    if (request.method !== "GET") return jsonResponse({ message: "Method not allowed" }, 405);
    const fixture = loadFixture("shop-order-details.json");
    const order = this.orderDetails[request.url.searchParams.get("orderId") ?? ""];
    return jsonResponse({ ...fixture, order: order === undefined ? null : structuredClone(order) });
  }

  /**
   * Salling's most-bought list, in the captured shape. Like live (2026-11-03),
   * a known `customerId` gets that account's list with `personalized: "true"`;
   * any other, or none, gets the bestsellers with `personalized: "false"`.
   */
  private mostBought(request: RecordedRequest): Response {
    const denied = checkSallingKey(request);
    if (denied) return denied;
    const limit = Number(request.url.searchParams.get("limit") ?? "50");
    const own = this.mostBoughtByCustomer[request.url.searchParams.get("customerId") ?? ""];
    const answer = loadFixture<Record<string, any>>("salling-most-bought.json");
    answer.output = {
      suggestions: structuredClone(own ?? this.bestsellers).slice(0, limit),
      personalized: own === undefined ? "false" : "true",
    };
    return jsonResponse(answer);
  }

  /**
   * Salling's alternative products for the sku in the path, answered in the
   * captured shape. Like live (2026-11-03), only the path's sku counts: the
   * query's `productId`, `sku` and `customerId` change nothing, an unknown
   * sku gets no suggestions, and a path that isn't a sku is an HTTP 400.
   */
  private alternatives(request: RecordedRequest): Response {
    const denied = checkSallingKey(request);
    if (denied) return denied;
    const sku = decodeURIComponent(request.url.pathname.split("/").at(-1) ?? "");
    if (!/^[1-9]\d*$/.test(sku)) {
      return jsonResponse({ detail: `Bad Request. ${sku} is not a valid SAP id.` }, 400);
    }
    const limit = Number(request.url.searchParams.get("limit") ?? "20");
    const answer = loadFixture<Record<string, any>>("salling-alternative-products.json");
    answer.output[0] = {
      ...answer.output[0],
      sku,
      customerId: request.url.searchParams.get("customerId") ?? "",
      suggestions: structuredClone(this.alternativesBySku[sku] ?? []).slice(0, limit),
    };
    return jsonResponse(answer);
  }

  /**
   * Gigya's login token → JWT exchange. Answers like the capture
   * (`gigya-jwt.json`) for the known token, otherwise with Gigya's error.
   */
  private gigyaGetJwt(request: RecordedRequest): Response {
    const denied = checkGigyaKey(request);
    if (denied) return denied;
    const form = request.form();
    if (form.get("login_token") !== this.loginToken) {
      return jsonResponse(GIGYA_INVALID_TOKEN, 403);
    }
    return jsonResponse({ ...loadFixture<object>("gigya-jwt.json"), id_token: this.jwt });
  }

  /** The shop's "not logged in" answer when the request lacks the current JWT. */
  private requireJwt(request: RecordedRequest): Response | undefined {
    if (request.headers.get("jwt_token") === this.jwt) return undefined;
    return jsonResponse(NOT_LOGGED_IN);
  }

  /**
   * Algolia's single-index query. Text relevance is Algolia's job, so the fake
   * ignores the query text and returns every product that passes `filters`,
   * paged by `hitsPerPage` and `page` (0-based) and projected by
   * `attributesToRetrieve`. A page past the end is empty, with the totals.
   * `facets` count the products that pass the filter per value, like Algolia,
   * largest first and cut to `maxValuesPerFacet`. The two sort replicas
   * (ALGOLIA_SORT_INDEXES) answer the same way, in their sort order; any
   * other index is a 404.
   */
  private algoliaQuery(request: RecordedRequest): Response {
    const denied = checkAlgoliaKey(request);
    if (denied) return denied;
    const index = decodeURIComponent(request.url.pathname.split("/")[3] ?? "");
    const sortKey = ALGOLIA_SORT_INDEXES[index];
    if (index !== ALGOLIA_PRODUCT_INDEX && sortKey === undefined) {
      return jsonResponse({ message: "Index does not exist", status: 404 }, 404);
    }
    const params = request.json() as {
      query?: string;
      filters?: string;
      hitsPerPage?: number;
      page?: number;
      attributesToRetrieve?: string[];
      facets?: string[];
      maxValuesPerFacet?: number;
    };
    const filter = parseFilters(params.filters ?? "");
    const hitsPerPage = params.hitsPerPage ?? 20;
    const page = params.page ?? 0;
    const filtered = this.products.filter(filter);
    const matching = sortKey === undefined ? filtered : sortAscending(filtered, sortKey);
    const hits = matching
      .slice(page * hitsPerPage, (page + 1) * hitsPerPage)
      .map((product) => project(product, params.attributesToRetrieve ?? ["*"]));
    const facets =
      params.facets === undefined
        ? undefined
        : countFacets(matching, params.facets, params.maxValuesPerFacet ?? 100);
    return jsonResponse({
      hits,
      ...(facets && { facets }),
      nbHits: matching.length,
      page,
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

/** The shop's answer without a valid JWT, captured live (`shop-not-logged-in.json`). */
const NOT_LOGGED_IN = loadFixture("shop-not-logged-in.json");

function checkAlgoliaKey(request: RecordedRequest): Response | undefined {
  if (
    request.headers.get("x-algolia-application-id") !== ALGOLIA_APP_ID ||
    request.headers.get("x-algolia-api-key") !== ALGOLIA_SEARCH_KEY
  ) {
    return jsonResponse({ message: "Invalid Application-ID or API key", status: 403 }, 403);
  }
  return undefined;
}

function checkSallingKey(request: RecordedRequest): Response | undefined {
  if (
    request.method !== "GET" ||
    request.headers.get("authorization") !== `Bearer ${SALLING_API_KEY}`
  ) {
    return jsonResponse({ detail: "Unauthorized" }, 401);
  }
  return undefined;
}

function checkGigyaKey(request: RecordedRequest): Response | undefined {
  if (request.method !== "POST" || request.form().get("apiKey") !== GIGYA_API_KEY) {
    return jsonResponse({ errorCode: 400093, errorMessage: "Invalid ApiKey parameter" }, 400);
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
 * joined by `AND`, where `attr` may be a dotted path such as
 * `consumerFacingHierarchy.lvl1` and `value` is a bare word or a quoted string
 * such as `"Mejeri & køl > Pålæg"` (no escapes). An array attribute matches
 * when it contains the value. Anything else throws, so a test fails loudly
 * instead of matching wrongly.
 */
function parseFilters(filters: string): (product: Record<string, any>) => boolean {
  if (filters.trim() === "") return () => true;
  const term = /([A-Za-z_][\w.]*):(?:([\w-]+)|"([^"\\]*)")(?: AND (?=.)|$)/y;
  const terms: { attribute: string; value: string }[] = [];
  while (term.lastIndex < filters.length) {
    const start = term.lastIndex;
    const match = term.exec(filters);
    if (!match) {
      throw new Error(
        `FakeBilka can't parse Algolia filter: ${JSON.stringify(filters.slice(start))}`,
      );
    }
    terms.push({ attribute: match[1]!, value: (match[2] ?? match[3])! });
  }
  return (product) =>
    terms.every(({ attribute, value }) => {
      const actual = valueAt(product, attribute);
      if (Array.isArray(actual)) return actual.some((item) => String(item) === value);
      return String(actual) === value;
    });
}

/**
 * Algolia's facet counts: per attribute (a dotted path such as
 * `consumerFacingHierarchy.lvl1`), how many of `products` hold each value,
 * largest first, at most `maxValues`. An attribute no product has is left out.
 */
function countFacets(
  products: Record<string, any>[],
  attributes: string[],
  maxValues: number,
): Record<string, Record<string, number>> {
  const facets: Record<string, Record<string, number>> = {};
  for (const attribute of attributes) {
    const counts = new Map<string, number>();
    for (const product of products) {
      const value = valueAt(product, attribute);
      const values = new Set((Array.isArray(value) ? value : [value]).filter((v) => v != null));
      for (const v of values) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    facets[attribute] = Object.fromEntries(
      [...counts].sort(([, a], [, b]) => b - a).slice(0, maxValues),
    );
  }
  return facets;
}

/**
 * A sort replica's order: ascending on `attribute`, ties in index order, and
 * records without a numeric value last, as Algolia does.
 */
function sortAscending(products: Record<string, any>[], attribute: string): Record<string, any>[] {
  const key = (product: Record<string, any>) => {
    const value = valueAt(product, attribute);
    return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
  };
  return products.toSorted((a, b) => (key(a) === key(b) ? 0 : key(a) < key(b) ? -1 : 1));
}

/** The value at a dotted attribute path, e.g. `consumerFacingHierarchy.lvl1`. */
function valueAt(product: Record<string, any>, path: string): unknown {
  return path.split(".").reduce<any>((value, key) => value?.[key], product);
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
