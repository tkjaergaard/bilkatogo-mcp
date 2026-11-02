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
| Delivery places | `GET .../shop/v6/AvailableDeliveryAddresses?u=w&orderByZipcode=`, header `jwt_token` | Logged in: `{activeAddress, isDefaultActiveAddress, addresses[], missing_hd_address}`. 23 entries for the developer's account: the 22 public places plus the account's home address. Each place has `id`, `sid` (the store that packs), `facility` (3 a Bilka store's pickup, 5 a standalone PickUp point, 8 home delivery), `minimum_buy` (øre: 50000 for home delivery, 0 for pickup), `name`, address fields, and `nextAvailableDeliveryDate`/`currentDeliveryDate` (the same on every place, so useless for comparing). `activeAddress` is the cart's place, the same object as the cart's `deliveryAddress`. |
| Switch place | `GET .../shop/v6/SetDeliveryAddress?u=w&…` | The website's own code (`www.bilkatogo.dk/_nuxt/*.js`) sends `id`, `zipcode`, `basketguid`, `dawa_uid`, `recipient_name`, `street`, leaving out the empty ones: `id` + `zipcode` for a store or pickup point, `dawa_uid` + `street` for a home address. Both worked live with `basketguid=` empty and no cookies, and the switch held for later calls (the answer sets `pz` and `hd_zipcode` cookies, which aren't needed). Answer: `{activeAddress, activeDeliveryPointComment, notifications[], eid: -1}`. Switching moved the cart's `deliveryAddress` and fees (the 39 kr. `Leveringsgebyr` line exists only for home delivery) and kept the cart lines and the chosen slot; a slot the new place doesn't offer is marked `closed: 1`. |
| Delivery slots | `GET .../shop/v3/AvailableDeliveryDates?u=w` | No parameters: always the slots of the cart's current place, 14 days ahead. `{deliveryDate, intervalStart, intervalEnd}` (the chosen slot), `availableDates[]`, `availableIntervals[]` (per day: `date`, `availability_bit`, `closed_text` such as "udsolgt", `intervals[]` with `id`, `intervalStart`, `intervalEnd`, `closed`, `availability_bit`, `orderBeforeTime`, `info[].message` with a little HTML), and `msg` with `eid: -2` when the chosen slot isn't offered at this place. Live, home delivery in Odense had one night slot a day (00:00–06:00, delivered 20:00–06:00 the night before); pickup at Bilka Odense had six (08–10, 10–12, 12–14, 14–16, 16–18, 18–22), and slot ids differ per place. `availability_bit` read from that one answer: 1 bookable, 2 order deadline passed (today), 4 sold out, 0 not open yet. Inferred, not documented. |
| Set the slot | `GET .../shop/v3/SetDeliveryDate?u=w&deliveryDate=2026-11-08&intervalStart=00:00&intervalEnd=06:00` | `eid: -1` and the slot as `GetDeliveryDate` gives it (`deliveryDate`, `intervalStart`, `intervalEnd`, `closed`, `delivery_message`), plus the cart's `stat` and `lines`. It reserves nothing: Bilka's own text says the slot "kan blive fuldt booket forinden". Only setting the already-chosen slot was tried live; Bilka's answer to a slot it doesn't offer is unknown, so the server checks the slot against the list first. |

Differences from the community code:
- **`api/auth/LoginJWT` isn't needed.** A cart read with only the `jwt_token` header, no cookies, returned the same logged-in cart as one after LoginJWT. So the server can skip LoginJWT and its cookies. That matters, because LoginJWT replaces the account's cart with any `cart` cookie it's sent (nickknissen).
- **OrderHistory works as `POST`**, as nickknissen sends it. stigvoss's `GET` wasn't tried.
- **Delivery places and slots** aren't in either reference client (stigvoss only reads `v3/GetDeliveryDate`). They come from the website's network calls and its JS bundle, and one live round trip on 2026-11-02: home → Bilka Odense pickup → home, then the original slot set again; the cart ended exactly as it started.
- All prices, totals and fees are in øre, as in Algolia. For example, `orderedPrice: 100934` is 1.009,34 kr.

**The logged-out answer, captured live** (2026-11-02, `AvailableDeliveryDates` with no JWT): HTTP 200 with `{"msg": "Metoden kræver login", "code": "ACCESS_DENIED", "eid": 401, "uid": -1, "info_object": null}`. The code is a *string*, unlike nickknissen's `{"code": 1, "msg": "Du er ikke logget ind"}`; the server first only knew numeric codes, so it would have missed this. It now counts HTTP 401 or 403, or the envelope `{code, msg}` with `code: 1`, `code: "ACCESS_DENIED"` or a `uid` of 0 or less, as "not logged in", and then refreshes the JWT and retries once. Any other `{code, msg}` envelope is an ordinary error with no re-login. An *expired* JWT wasn't tried, but is expected to answer the same way.

`eid` looks like an error id rather than an account id: every answer seen had `-1` on success, `-2` beside a `msg` warning, `310` on the cart right after a switch made its slot unavailable, and `401` when logged out. It's still scrubbed, which costs nothing.

**Personal-data fields.** These must go through the privacy scrub:

| Where | Fields |
|---|---|
| Cart `deliveryAddress`, place-list `activeAddress` and `addresses[]` (home delivery, `facility: 8`) | `name`, `recipient_name`, `address`, `street`, `zip`, `city`, `lat`, `lng`, `dawa_uid`, `id`, `temporary_zipcode` |
| Every place in the logged-in list, even Bilka's own stores and pickup points | `recipient_name` and `temporary_zipcode`: `temporary_zipcode` holds the *customer's* zip on every entry. The scrub keeps a place's fields by an allowlist: public places keep `id`, `name`, `address`, `zip`, `city`; every place keeps `sid`, `facility`, `minimum_buy` and a few flags; everything else is redacted. |
| Place switch answer | `activeDeliveryPointComment` (`comment`, `doorcode`, `delivery_text`, `access_choice`) |
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

**Delivery tools (2026-11-02):** four more at the user's request, so the assistant can suggest pickup when home delivery is sold out. `list_delivery_places` and `list_delivery_slots` read; `set_delivery_place` (flagged destructive: it changes fees, the minimum order and maybe the store) and `set_delivery_slot` (not destructive: Bilka reserves nothing) write to the cart. Choosing a place and slot counts as preparing the cart, not checkout: the order is still placed and paid for by a person on the website. The home address is `place_id: "home"`; Bilka's id and the address itself stay inside the server, which sends `dawa_uid` and `street` from an unscrubbed read of the place list straight back to Bilka when switching home. That read is the only unscrubbed shop answer. Slots can only be listed for the cart's current place, so comparing places means switching, which the tool descriptions tie to the user's agreement.

## 6. Risks and open questions

- **Terms of service.** This is a private API, as with nemlig, so it can change at any time. We haven't read bilkatogo.dk's terms on automated use yet. Keep traffic at what one person would generate.
- **Login.** Gigya might add CAPTCHA or bot protection to `accounts.login`. Keep the fallback of pasting a browser token.
- **Checkout stays out**, as nemlig-mcp decided: a person always places the order on the website.
- **Prompt injection.** Product names are untrusted text and should be labelled as such in tool descriptions.
- **Still unknown:** Bilka's answer to an unknown order id, an unknown product in `ChangeLineCount`, a slot it doesn't offer in `SetDeliveryDate`, and a refused `SetDeliveryAddress`; whether switching to another store's place drops cart lines that store doesn't carry; whether an account can hold more than one home address (the server numbers them "home", "home-2", …, but `get_cart` calls any of them "home"); and what `stat.promo` means.
