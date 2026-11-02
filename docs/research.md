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

## 3. How BilkaToGo works (from the code above, partly checked live)

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
Login and the cart endpoints have not been tried yet. That needs a real account.

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

## 6. Risks and open questions

- **Terms of service.** This is a private API, as with nemlig, so it can change at any time. We haven't read bilkatogo.dk's terms on automated use yet. Keep traffic at what one person would generate.
- **Login.** Gigya might add CAPTCHA or bot protection to `accounts.login`. Keep the fallback of pasting a browser token.
- **Checkout stays out**, as nemlig-mcp decided: a person always places the order on the website.
- **Prompt injection.** Product names are untrusted text and should be labelled as such in tool descriptions.
- **To find out with a real account:** whether a fresh login works headless, the cart write endpoints, what product details contain (nutrition and allergens?), and the endpoints for delivery slots.
