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
           filters: isInAssortmentIn:<sid>, inStockStore:<sid>, isInOffer:<sid>,
                    isInCurrentLeaflet:true (the leaflet)
           sorted:  prod_r_BILKATOGO_PRODUCT_pricesort, ..._uompricesort (same body)
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
| Password login | `POST https://accounts.eu1.gigya.com/accounts.login`, form `loginID, password, apiKey, httpStatusCodes=true` | `errorCode: 0`. Answers without a browser. The login token is `sessionInfo.cookieValue`. The answer also carries the account `profile` (first and last name, email, zip, city, country) and `UID`. |
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
- All prices, totals and fees are in øre, as in Algolia. For example, `orderedPrice: 60145` is 601,45 kr.

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

### Algolia: offers, the leaflet and paging (checked live on 2026-11-02, public key, no login)

**Bilka Avisen (the leaflet) isn't a separate service.** It's the product index filtered on `isInCurrentLeaflet:true`, a *global* boolean on each record (not per store, unlike `isInOffer:<sid>`). The website's leaflet page sends it together with its usual store filters: `inStockStore:<sid> AND isInAssortmentIn:<sid> AND nonsearchable:false AND isInCurrentLeaflet:true`. `search_products` sends the same set (`only_leaflet`), with the stock filter only when `only_in_stock` is on.

Live counts:
- Bilka Odense (1654), in stock: 11,081 products "on offer" (`isInOffer:1654`) against 2,952 in the leaflet. `isInOffer` counts every product with an offer text, so it includes Bilka's everyday price labels.
- Store 1653, in stock: 2,959 leaflet products.
- The first 200 leaflet products at 1653 carried these offer texts: "Skarp pris" 107, "Mix N for N,NN" 50, "Se Her" 39, "N for N" 3, "Spar N" 1. So the leaflet holds labelled everyday prices too; it is "this week's leaflet", not "discounted".
- Offer dates are rare: only 4 of those 200 had `offerFrom`/`offerUntil` in the store's data (a "3 for 2" mix, 2026-10-29 → 2026-11-12, and a "Spar 7,95", 2026-10-23 → 2026-11-05). Most offers, "Skarp pris" included, have empty dates, so `offer_from`/`offer_until` are usually null.

**Paging.** The query takes `page` (0-based) beside `hitsPerPage`, and answers with `page`, `nbPages` and `nbHits`. A leaflet query at 1653 with `hitsPerPage: 5, page: 1` answered `nbHits: 2959, nbPages: 592`, so `nbPages` isn't cut to Algolia's default limit of 1,000 reachable hits. Whether pages past hit 1,000 actually return products wasn't tried. `search_products` takes a 1-based `page` and returns `page`, `total_pages` and `total_results`.

**Search hits return only `objectID`** unless `attributesToRetrieve` names attributes, like the objects endpoint.

### Algolia: mix offers (checked live on 2026-11-02, public key, no login)

A mix offer is "buy N of these products for a set price", e.g. "Mix 2 for 35,00". The website can't list the other products in a mix; the index can.

- **Mix ids live on the record.** Each product carries `multipromos`, a list of mix ids, e.g. `["2680"]`. The filter `multipromos:<id>` returns every product in that mix. `search_products` sends it for `mix_offer_id`, after checking the id is all digits.
- **The terms live in the store's data.** `storeData.<sid>` has `offerDescription` ("Mix 10 for 25,00"), `offerCount` (10, the items the mix takes) and `multiPromoPrice` ("2500": what those items cost together, in øre, as a string). It also has `multipromo`, the store's mix id as a single string ("2680", "" without a mix); in every record seen it equals `multipromos[0]`.
- **Mix ids aren't per store; the offer text is.** Odense's offers (1654) hold 262 mix ids. A product can carry a mix id while a store gives it no offer text, so `search_products` with `mix_offer_id` also sends `isInOffer:<sid>`: only products on offer at the selected store are listed. The nine mix records checked (mixes 2680 and 11220188) had the same mix text in all 18 stores, so the "other store only" case in the tests is a hand-edited fixture (test/fixtures/README.md).
- **Not every mix has a price.** The "3 for 2" mix `11220188` (Pizzadej 81452, Pølsehornsdej 81451, Fettuccine 185411 and Fuldkornspølsehornsdej 134103 at store 1653) has `offerCount: 3` and an empty `multiPromoPrice`. "Mix N for N,NN" mixes have a price, e.g. `2680` (Bananer, Pærer, Æbler, Kiwi, Blommer: "Mix 10 for 25,00", `multiPromoPrice` "2500").
- **A mix id can be long**: 4 digits ("2680", "1679") or 8 ("11220188"), so `mix_offer_id` takes any all-digit id.
- **The product's `mix` block** is `{ mix_offer_id, items, price }` when the product has a mix id and the store gives it an offer text. `price` (DKK, for all `items` together) is null when `multiPromoPrice` is empty or not positive; `items` is null when `offerCount` is below 2. With several mix ids, the first is used.
- Mix offers have `beforePrice` 0, so there's no saving to compute.
- **`storeData.<sid>.unitsOfMeasureOfferPrice` is unreliable**: it's filled even on products not on offer (Dumle Original had 140.00 kr without an offer). It's never read.
- **Open question:** whether one product can carry several mix ids in one store. No live record with more than one id has been seen; the store's `multipromo` field holds a single id, which suggests one mix per product per store.

### Algolia: the sort indexes (checked live on 2026-11-02, public key, no login)

The website's "Billigst" and "Laveste enhedspris" sorts query two other indexes with the same body and filters as the main one: `prod_r_BILKATOGO_PRODUCT_pricesort` and `prod_r_BILKATOGO_PRODUCT_uompricesort`. `search_products` sends `sort: "price"` and `sort: "unit_price"` there; `relevance` stays on `prod_BILKATOGO_PRODUCTS`.

- **They're standard replicas**, not virtual ones: the price ranks above text relevance. Browsing (a category, the leaflet, a mix) works well, but a free-text search is poor. "kaffe" at store 1654 matched 349 products on the price index against 720 on the main index, and coffee cream and latte drinks came first. So `search_products` adds a note to `notes` when a sorted search has a `query` but no `category`, `only_leaflet` or `mix_offer_id`.
- **The sort key isn't the selected store's current price.** On the price index the store prices came back as 9.95, 7, 7, 10.50. On the unit-price index (leaflet, "Mejeri & køl", store 1653, one query) the order followed `storeData.1653.unitsOfMeasurePrice`, the unit price *before* the offer (4.10, 15.60, 17.05, 17.50 …), not `unitsOfMeasureShowPrice`, the one shown and returned as `unit_price` (2.50, 14.00, 14.00, 16.00 …). What either index actually sorts on is unknown. `search_products` therefore re-sorts each returned page by the store's `price` or `unit_price`; ties keep the index's order and products without the price go last. Pages still follow the index's order, so a product can sit one page off from where the store price would put it.
- **Unit prices aren't comparable across units.** A page can mix "stk", "l" and "kg" (eggs per piece came first above, then milk per litre); the re-sort compares the numbers as they are.
- **There's no "biggest saving" index**, and mix offers have `beforePrice` 0, so a saving sort can't be computed either.

### Algolia: the category tree (checked live on 2026-11-02, public key, no login)

**The website's menu is `consumerFacingHierarchy`.** Each record has `consumerFacingHierarchy.lvl0` … `lvlN`, arrays of paths whose names are joined by " > ", e.g. `lvl1: ["Mejeri & køl > Pålæg"]`. A product's `deepestCategoryPath` is its deepest path in the same format, so it works as a filter value.

- **Filter:** `consumerFacingHierarchy.lvlN:"<path>"`, where N is the number of " > " separators. The quoted form works live with spaces and `&` (`consumerFacingHierarchy.lvl0:"Mejeri & køl"`). Filtering on a level also matches every product deeper down.
- **Counts:** a query with `hitsPerPage: 0`, `facets: ["consumerFacingHierarchy.lvl<N+1>"]` and the parent's filter answers with `facets[...]`, a map from child path to product count, plus `nbHits` for the parent. The counts follow every filter in the query (store, stock, offers, leaflet). Algolia caps `maxValuesPerFacet` at 1,000, and reports `exhaustiveFacetsCount: true` on these queries.
- **Top level:** at store 1653, in stock, there are 22 categories plus a "Not Categorized" bucket (117 products), from "Personlig pleje" (6,056) down to "Biludstyr" (143). In the leaflet the same 22 values hold 2,959 products, e.g. "Personlig pleje" 746, "Mejeri & køl" 214, "Frugt & grønt" 13 (recorded in `test/fixtures/algolia-categories-leaflet.json`).
- **Under one parent:** "Mejeri & køl" has 10 children at 1653 (e.g. "Mejeri" 675, "Pålæg" 398), and "Mejeri & køl > Pålæg" has 9 (e.g. "Kødpålæg" 162).
- **Depth: five levels exist, lvl0 to lvl4.** The level-3 question from #10 is settled: lvl3 has 999 values at store 1653, groceries included (e.g. "Mejeri & køl > Mejeri > Yoghurt & syrnede mælkeprodukter > Skyr"). lvl4 has 176 values across all stores (170 at 1653, in stock, with 2,301 products), only outside groceries, e.g. "Tøj & sko > Børnetøj > Overdel > Toppe > Toppe Langærmet" (product 145872, whose `deepestCategoryPath` has those five names). lvl5 has no values. So `search_products.category` and `list_categories.parent` accept up to five names.
- **Names:** none of the 1,233 facet values fetched contains `"`, `\` or `>` inside a name, or a space at either end of one. The server refuses those characters, so a category can't end the quoted filter value.
- **A product filed under two parents** would bring the other parent's children into a child facet, so `list_categories` keeps only children whose path starts with the parent's. No such product has been seen.

### Salling Group recommendations API (checked live on 2026-11-03)

bilkatogo.dk gets its "most bought" and "alternatives" product lists from `https://api.sallinggroup.com/v2/recommendations/…` (in the site code: `utils/salling-api-util.js`). These are the issues #23 and #24.

- **Auth is a shared key, not a login.** Each request sends `Authorization: Bearer 45c0740c-f037-4915-89c0-171f6edf9fd3`. That key is built into the site's JavaScript (`NUXT_ENV_SALLING_API_BEARER_TOKEN`) and is the same for every visitor, like the Algolia search key. Without it the API answers HTTP 401. The site's Origin, Referer and browser User-Agent headers aren't needed.
- **`customerId` is the shop's `tid`.** It's a UUID, and the shop API returns it as `tid` next to `eid`/`uid` in every response (checked against `Profile`). It isn't the Gigya UID, which is the JWT's `sub`. `src/scrub.ts` removes `tid` before anything reaches the model.
- **Anyone with a `tid` can read that person's purchase history.** The shared key plus a `tid` is enough to get most-bought, with no login. So treat `tid` as a secret: never show it to the model, and never put it in logs, issues or test fixtures.
- **Responses list products, not prices.** Each suggestion has `name`, `productId`, `sku` and `eans`. `productId` is the Algolia `objectID` (checked: 72008 is "Bananer 4 pak øko"). To show prices or stock, fetch the products from Algolia.

**Most bought:** `GET /v2/recommendations/most-bought/bilkatogo?customerId=<tid>&fields=productId&limit=50`. The site's limit is 50, and it can also send `brand`, `onSale` and `shopCategoryPath`.

- The answer is `{output: {suggestions: [...], personalized: "true"|"false"}, model_name: "MostBoughtProductsModelV1", model_version}`. `personalized` is a string.
- Without `customerId` the call still succeeds, but returns the shop-wide bestsellers with `personalized: "false"`. A tool must check the flag, or it will present the general bestsellers as the account's own.

**Alternatives:** `GET /v2/recommendations/alternative-products/bilkatogo/<sku>?limit=20`.

- **The path takes the sku, which Salling calls the SAP id.** The site also sends `productId`, `sku` and `customerId` as query parameters, but they change nothing. With `productId=1` and the right sku in the path, the answer was the same. With a product id in the path the list is empty, and `/0` answers HTTP 400 with `"0 is not a valid SAP id."`.
- **The sku is Algolia's `article` field** (the same value is in `erp_product_id`). It isn't returned unless asked for by name in `attributesToRetrieve`. So product id → sku takes one Algolia lookup.
- The answer is `{output: [{sku, customerId, suggestions: [...], personalized}], model_name: "PQEBasedAlternativeProducts", model_version}`. Each suggestion also has a `score` (0.49 to 0.76 for bananas). It echoes `customerId` back.
- Sending `customerId` made no difference: the same list either way, `personalized: "false"`. So a tool can leave it out, which keeps it working with no login and keeps the `tid` out of the request and the response.
- The site supports `excludeOwnCategory`, `onlyOwnCategory`, `onSale` and `shopCategoryPath` as well. These haven't been tested.

**Not explored yet:** the site also calls `trending-products/bilkatogo` (with `days`), `complementary-products/bilkatogo/<sku>`, `next-product/bilkatogo` (POST with `productIds`) and `search-rerankings/bilkatogo`.

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

**Delivery tools (2026-11-02):** four more at the user's request, so the assistant can suggest pickup when home delivery is sold out. `list_delivery_places` and `list_delivery_slots` read; `set_delivery_place` (flagged destructive: it changes fees, the minimum order and maybe the store) and `set_delivery_slot` (flagged destructive too: it overwrites the cart's slot, though Bilka reserves nothing) write to the cart. Choosing a place and slot counts as preparing the cart, not checkout: the order is still placed and paid for by a person on the website. The home address is `place_id: "home"`; Bilka's id and the address itself stay inside the server, which sends `dawa_uid` and `street` from an unscrubbed read of the place list straight back to Bilka when switching home. That read and the account id read for `get_most_bought` (only its `tid` is kept, see the Salling section in §3) are the only unscrubbed shop answers. Slots can only be listed for the cart's current place, so comparing places means switching, which the tool descriptions tie to the user's agreement.

## 6. Risks and open questions

- **Terms of service.** This is a private API, as with nemlig, so it can change at any time. A review of the terms (2026-11-02) found that neither BilkaToGo's Handelsbetingelser (v18, 06.10.2026), the Salling Group Profilbetingelser nor the BilkaToGo privacy policy say anything about automated access, scraping or third-party tools. The realistic risk is the profile terms' broad discretion: Salling Group may deactivate or delete a profile it considers misused (§5.5, §9.1–9.2), and that profile is also the login for other Salling Group services. So use it only with your own profile, and keep traffic at what one person would generate. Recheck the terms on each release.
- **Login.** Gigya might add CAPTCHA or bot protection to `accounts.login`. Keep the fallback of pasting a browser token.
- **Checkout stays out**, as nemlig-mcp decided: a person always places the order on the website.
- **Prompt injection.** Product names are untrusted text and should be labelled as such in tool descriptions.
- **Still unknown:** Bilka's answer to an unknown order id, an unknown product in `ChangeLineCount`, a slot it doesn't offer in `SetDeliveryDate`, and a refused `SetDeliveryAddress`; whether switching to another store's place drops cart lines that store doesn't carry; whether an account can hold more than one home address (the server numbers them "home", "home-2", …, but `get_cart` calls any of them "home"); what `stat.promo` means; whether a product can carry several mix ids in one store (see "Algolia: mix offers"); what the two sort indexes actually sort on (see "Algolia: the sort indexes"); and whether `isInCurrentLeaflet` ever differs between regions. It's one flag per record, not per store, so the server treats the leaflet as the same in every store; nobody has checked whether some regions get a different leaflet.
