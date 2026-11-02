# Research: an unofficial BilkaToGo MCP

Status: initial research, 2026-11-02.

## 1. The nemlig.com MCP that inspired this

[kraenhansen/nemlig-mcp](https://github.com/kraenhansen/nemlig-mcp): Python, MIT, local stdio server.
It is a thin layer over [eisbaw/nemlig_cli](https://github.com/eisbaw/nemlig_cli), which does the login work.

Design choices worth copying:

| Idea | Detail |
|---|---|
| Allowlisted tools | 7 tools: search, product details, get basket, set quantity, set quantities (batch), order history, order details. A test checks that the tool list is exactly this. |
| No checkout or payment | Placing orders and reading cards are deliberately left out, even though the API supports both. |
| Absolute quantities | `set_*_quantity` sets a number and doesn't add one. These tools are marked `destructive_hint=True`, so clients ask the user before running them. |
| Batch with retry | One call fills a basket from a recipe. It retries only on timeouts, 429 and 5xx. When one item fails, the rest still go through and the result reports each item. |
| Privacy filter | Name, address, phone, door code and delivery notes are removed before anything reaches the model. |
| Credentials | In `~/.config/nemlig/login.json` (mode 600) or in environment variables, not in the MCP config. |

Other nemlig projects: `mikkelkaas/nemligmcp`, `mhattingpete/nemlig-shopper` (turns a recipe into a cart), `AndersMollgaard/nemlig` (agent skills).

## 2. Existing Bilka MCPs and libraries

**An unofficial BilkaToGo MCP already exists.** Bilka has no official one.

| Repo | What it is | State | License |
|---|---|---|---|
| [stigvoss/bilkatogo-mcp](https://github.com/stigvoss/bilkatogo-mcp) | A full MCP. Python, one 675-line `server.py`, streamable HTTP plus an API key, Docker/GHCR. Tools: `search_products`, `get_cart`, `set_cart_quantity`, `add_to_cart`, `clear_cart`, `list_orders`, `get_order`, `get_favourites`, `get_delivery_date`. No checkout. | Active (last commit 2026-10-31), 0 stars | **None**, so all rights reserved and the code can't be reused |
| [nickknissen/bilkatogo](https://github.com/nickknissen/bilkatogo) | Async Python library, CLI and Home Assistant integration. Covers orders, current order and substitutions, pickup points, cart (get/set/add/remove/clear) and search. Has tests and a fake Bilka server. On PyPI as `bilkatogo`. | Active (2026-10-30) | **MIT** |
| [KristianSchmidt/bilka_mcp](https://github.com/KristianSchmidt/bilka_mcp) | An early stub: Algolia search and nothing else. | Abandoned (2025-07) | None |
| `ffMathy/hey-jarvis` (`mcp/mastra/verticals/shopping/bilka/client.ts`) | A TypeScript Bilka client inside a bigger assistant project | – | – |
| `aleenprd/bilka2go-scraper` | A catalogue scraper | 2025 | MIT |

Bilka is now roughly where nemlig was: someone has written a client library (nickknissen's, playing the role nemlig_cli plays) and someone has written an MCP (stigvoss).

## 3. How BilkaToGo works (checked live on 2026-11-02)

```
Search  ─► Algolia (public key the site ships to browsers, no login)
           POST https://F9VBJLR1BK-dsn.algolia.net/1/indexes/prod_BILKATOGO_PRODUCTS/query
           filters: isInAssortmentIn:<sid>, inStockStore:<sid>, isInOffer:<sid>
           details: POST .../1/indexes/*/objects

Login   ─► SAP Gigya (eu1)
           accounts.login (email+password)  → login_token (sessionInfo.cookieValue)
           accounts.getJWT (login_token)    → JWT (24 h)
           A login_token can also be read in the browser: localStorage.getItem("auth")

Shop    ─► https://api.bilkatogo.dk/api/shop/<ver>/<Endpoint>?u=w   header: jwt_token: <JWT>
           v6/Cart · v6/ChangeLineCount(productId,count) · v6/EmptyCart
           v7/OrderHistory · v7/OrderDetails(orderId)
           v3/GetFavs · v3/GetDeliveryDate
           v6/AvailableDeliveryAddresses (no login; store ids = "sid")
```

Checked live today: Algolia search returns products with no login, and `AvailableDeliveryAddresses` returns 22 pickup points with their store ids (e.g. 1654 Bilka Odense) with no login.

**Login, cart and orders, checked live on 2026-11-02** with the developer's account (`scripts/capture.ts`, see `docs/capture.md`). Every step answered HTTP 200. The scrubbed answers are in `test/fixtures/` (`gigya-*`, `shop-*`).

| Step | Request | Answer |
|---|---|---|
| Password login | `POST https://accounts.eu1.gigya.com/accounts.login`, form `loginID, password, apiKey, httpStatusCodes=true` | `errorCode: 0`. **Works headless**: no CAPTCHA or bot protection. The login token is `sessionInfo.cookieValue`. The answer also carries the account `profile` (first and last name, email, zip, city, country) and `UID`. |
| JWT exchange | `POST .../accounts.getJWT`, form `apiKey, login_token, expiration=86400, httpStatusCodes=true` | `id_token` is the JWT. |
| Cart | `GET https://api.bilkatogo.dk/api/shop/v6/Cart?u=w&extra=deliveryAddress,deliveryDate`, header `jwt_token` | The logged-in cart. Lines sit in `lines[].lines[].orderlines[]`, each with `quantity`, `amount`, `unitprice`, `net_unitprice` and a `product` (`objectID`, `name`, `brand`, `price`, …). Totals in `stat` (`price`, `amount`, …). Service fees such as `Pakkeservice` (product 81474) are ordinary lines under the headline "Services". |
| Set a line | `GET .../shop/v6/ChangeLineCount?u=w&productId=<objectID>&count=<n>&fullCart=0` | `{unitCount, sum, productId, productAmount, productUnitPrice, message, offerLimitMessage}`: the cart's new unit count and total, and the line's new quantity. `count=0` removes the line. The Algolia `objectID` is the product id the shop accepts. |
| Order history | `POST .../shop/v7/OrderHistory?u=w&limit=5&offset=0&muah=1&ordertype=dibs,pgw` | `{limit, offset, total, orders[]}`. Each order: `orderId` (12 digits), `status` (e.g. "Faktureret"), `orderedPrice`, `packedPrice`, `totalProductAmount`, `deliveryDate`, `deliveryInterval`, `deliveryMessage`, `content` (a preview of item names), and the delivery data in `name`, `address`, `zipcity`, `pickupzone`. |
| Order details | `GET .../shop/v7/OrderDetails?u=w&orderId=<orderId>` | `{order}` with the same line shape as the cart, `stat` (fees, deposits, discounts), `price`, `payments[]` (`providerId`, `amount`), `deliveryAddress`, `pickupzone` and `receipt_content`. |

Differences from the community code:
- **`api/auth/LoginJWT` isn't needed.** A cart read with only the `jwt_token` header, no cookies, returned the same logged-in cart as one after LoginJWT. So the server can skip LoginJWT and its cookies. That matters, because LoginJWT replaces the account's cart with any `cart` cookie it's sent (nickknissen).
- **OrderHistory works as `POST`**, as nickknissen sends it. stigvoss's `GET` wasn't tried.
- All prices, totals and fees are in øre, as in Algolia. For example, `orderedPrice: 100934` is 1.009,34 kr.

Not captured: a shop answer to an expired or rejected JWT, so the logged-out shape is **still unconfirmed live**. The server follows the two reference clients: it counts HTTP 401 or 403, or the HTTP 200 envelope `{code, msg}` with `code: 1` (nickknissen: `{"code": 1, "msg": "Du er ikke logget ind"}`) or a `uid` of 0 or less (stigvoss: `uid: -1`), as "not logged in", and then refreshes the JWT and retries once. Any other `{code ≠ 0, msg}` envelope is an ordinary error with no re-login (stigvoss notes such errors, e.g. "order not found", carry the account's own `uid`). The fake answers `{"code": 1, "msg": "Du er ikke logget ind", "uid": -1}`. Check this against a capture when one turns up.

**Personal-data fields.** These must go through the privacy scrub:

| Where | Fields |
|---|---|
| Cart `deliveryAddress` | `name`, `recipient_name`, `address`, `street`, `zip`, `city`, `lat`, `lng`, `dawa_uid`, `id`, `temporary_zipcode` |
| Cart and order `stat.delivery_comment` | `comment`, `doorcode`, `delivery_text`, `access_choice` |
| Cart and order lines | `orderlines[].comment` (the customer's note on a line) |
| Order history `orders[]` and order details `order` | `name`, `address`, `zipcity` |
| Order `deliveryAddress` and `pickupzone` | `recipient_name`, `address`, `location`, `city`, `zipCode`, `lat`, `lng`, `door`, `doorcode`, `floor`, `deliveryComment`, `deliveryPointText`, `deliveryPointId`, `order_pickup_code` |
| Order details | `receipt_content` (pickup texts that can hold the pickup code), `payments[].providerId`, `transact` |
| Every shop answer | `uid`, `eid`, `tid` (account and session ids), `company`, `orders[].organisation` |
| Gigya login | `profile` (name, email, zip, city, country), `UID`, `UIDSignature`, `sessionInfo.cookieValue` (the login token) |

No phone number appeared in any answer. For pickup orders `pickupzone` holds the store's public address, but for home delivery it holds the customer's, so it's scrubbed either way.

Product details, checked live on 2026-11-02 (one request, no login): `POST .../1/indexes/*/objects` with `{"requests":[{"indexName":"prod_BILKATOGO_PRODUCTS","objectID":"19753","attributesToRetrieve":[...]}]}` answers `{"results":[record]}`. Without `attributesToRetrieve` the record holds only `objectID`, so name the attributes. An unknown id gives `null` in `results` plus a `message` ("ObjectID … does not exist."). Full records carry more than search hits show: `infos` holds the product page's sections (`description`, `ingredients` with allergens in capitals, `nutritional_100`, `product_details`, `productspecification`), each with `items` of type 1 (free text with some HTML) or type 2 (name/value row). There are also `attributes` (labels such as "Europæisk ejerskab"), `energyInfo`, `safetyText(s)`, `safetyIcons` and `imageGUIDs`.

Notes:
- Prices are in øre, so divide by 100.
- Search results depend on the store. Without a store id you get products the chosen store doesn't stock.
- Salling Group's official developer portal (developer.sallinggroup.dev) only offers Anti Food Waste, Product Suggestions, Stores, Holidays and Jobs. It has no catalogue, cart or ordering API.

## 4. Gaps: what a new project could add

Compared with stigvoss/bilkatogo-mcp, and with nemlig-mcp as the model:

1. **A local stdio server you install with one command** (`uvx` / `npx`). stigvoss's server needs Docker, a reverse proxy and an API key, which is a lot of setup for a single user.
2. **Batch cart updates** (`set_cart_quantities`) with retries and a result for each item, like nemlig-mcp. This is the key feature for "turn this recipe or meal plan into a cart".
3. **An open license**, so others can contribute and reuse it.
4. **A privacy filter as its own tested module**, plus a test that pins the tool allowlist.
5. **Features nobody has yet:** a separate product details tool (nutrition and allergens, if Algolia has them), browsing offers, picking a store by name instead of by id, delivery slots, and "reorder from order X".
6. **Tool annotations** (`readOnlyHint` / `destructiveHint`).

## 5. Options

| Option | Effort | Notes |
|---|---|---|
| A. Use stigvoss/bilkatogo-mcp as it is | 0 | Works today, but needs Docker and has no license. |
| B. Contribute to stigvoss (batching, stdio mode) | Low | Depends on the owner. Ask them to add a license. |
| **C. New MCP built on `nickknissen/bilkatogo` (MIT)** | Low–medium | Copies the nemlig-mcp setup exactly: an existing library underneath, our tool surface, privacy filter and batching on top. Python + FastMCP. |
| D. New MCP from scratch (e.g. TypeScript) | Medium | Full control, but we'd have to rebuild the Gigya login and the endpoint knowledge ourselves. |

**Decision (2026-11-02): D, in TypeScript**, as a private PoC. The client is written from scratch using the endpoints in §3. nickknissen's library (MIT) and stigvoss's server are references for how the endpoints behave. They aren't dependencies. Since the project is private, stigvoss's missing license isn't a blocker for reading their code.

**Tool list (2026-11-02):** the eight tools pinned in #1 grew to nine at the user's request. `select_store` picks the store by id or by store or pickup-point name (gap 5, "picking a store by name instead of by id") and saves it in `settings.json`, a local setting of this server that never touches the Bilka account.

## 6. Risks and open questions

- **Terms of service.** This is a private API, as with nemlig, so it can change at any time. We haven't read bilkatogo.dk's terms on automated use yet. Keep traffic at what one person would generate.
- **Login.** Gigya might add CAPTCHA or bot protection to `accounts.login`. Keep the fallback of pasting a browser token.
- **Checkout stays out**, as nemlig-mcp decided: a person always places the order on the website.
- **Prompt injection.** Product names are untrusted text and should be labelled as such in tool descriptions.
- **To find out with a real account:** whether a fresh login works headless, the cart write endpoints, what product details contain (nutrition and allergens?), and the endpoints for delivery slots.
