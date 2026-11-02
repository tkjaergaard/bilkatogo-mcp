<img src="assets/icon.svg" width="64" height="64" alt="">

# bilka-mcp

Created in [T3 Code](https://t3.codes).

An unofficial, private MCP server for [BilkaToGo](https://www.bilkatogo.dk), the Danish grocery shop. It's a local proof of concept: your MCP client starts it over stdio, and it talks to BilkaToGo for you. It isn't affiliated with Bilka or Salling Group.

It speaks MCP 2026-07-28 and still serves clients that use the older `initialize` handshake.

## Tools

| Tool | What it does | Needs login |
|---|---|---|
| `search_products` | Searches the catalogue at your store. Prices in DKK, with regular price, saving and offer text for discounted products. Only in-stock products by default; can be limited to offers. | no |
| `get_product_details` | Everything the catalogue holds about one product: size, prices, unit price, category, labels, and ingredients, allergens and nutrition where Bilka publishes them. | no |
| `list_stores` | Lists the Bilka stores with their store ids, and the pickup points each store serves. | no |
| `get_cart` | Reads your cart: each line's product, quantity, unit price and line total, the cart total, item count and fees, in DKK. A compact summary by default; `full` adds brand, size, delivery slot and the distance to Bilka's minimum order. | yes |
| `set_cart_quantity` | Sets one product's cart line to an exact quantity, from 0 to 50 (0 removes the line). Returns the line as Bilka reports it, Bilka's note on the change when there is one, and the cart afterwards. Your MCP client sees it flagged destructive, so it can ask you first. | yes |
| `get_order_history` | Lists your past orders, newest first and a page at a time: order id, order date, delivery date and slot, status, total in DKK, item count and a short preview of item names. | yes |
| `get_order_details` | Everything in one past order: each item's name, brand, size, quantity, price paid and offer text, the fees and totals, and the delivery or pickup slot. The product ids work with the cart tools, so you can buy an order again. | yes |

Placing orders and payment stay on the website: the server can't do either. Your name, address, door and pickup codes and delivery notes are replaced with a marker before anything reaches the model.

## Requirements

Node.js 24 or later. Node runs the TypeScript source directly, so there's no build step.

```sh
git clone <this repo> bilka-mcp
cd bilka-mcp
npm install
```

## Choose your store

Search only shows what one Bilka store carries, so the server needs that store's id in `BILKATOGO_STORE_ID`, for example `1654` for Bilka Odense.

To find your store's id, ask your assistant to run `list_stores` ("which Bilka stores are there?"). It works before a store is configured and needs no login. Without a store id, `search_products` answers with an error that says how to set one.

## Log in

Tools that use your account (`get_cart`, `set_cart_quantity` and the order tools) need a BilkaToGo login token. The server reads it only when such a tool runs; search and the store list work without it.

1. Log in on [bilkatogo.dk](https://www.bilkatogo.dk) in your browser.
2. Open the developer console and run `localStorage.getItem("auth")`. The value is your login token.
3. Give it to the server in one of two ways (the environment wins when both are set):
   - the environment variable `BILKATOGO_LOGIN_TOKEN`, or
   - `~/.config/bilka-mcp/login.json` (or under `$XDG_CONFIG_HOME`), readable only by you:

     ```sh
     mkdir -p ~/.config/bilka-mcp
     printf '{"loginToken": "%s"}\n' 'PASTE-TOKEN-HERE' > ~/.config/bilka-mcp/login.json
     chmod 600 ~/.config/bilka-mcp/login.json
     ```

The server swaps the token for a 24-hour session with Bilka's login service and keeps that session in memory. When the token expires or you log out in the browser, those tools say so; paste a fresh one. Logging in with email and password comes later.

## Register it in Claude Code

From the repo directory:

```sh
claude mcp add bilka -e BILKATOGO_STORE_ID=1654 -- node "$PWD/src/main.ts"
```

Then ask Claude something like "find havremælk". Add `-s user` to make the server available in every project.

The store id isn't a secret, so it's fine in the MCP config. The login token is: keep it in `~/.config/bilka-mcp/login.json` with mode 600 (or in your shell's environment), never in an MCP config you might commit.

Any other MCP client works the same way: run `node /path/to/bilka-mcp/src/main.ts` over stdio with `BILKATOGO_STORE_ID` set.

## Development

| Script | What it does |
|---|---|
| `npm start` | Runs the server on stdio. |
| `npm test` | Runs the test suite (Vitest). It's offline: a fake Bilka answers every request. |
| `npm run typecheck` | Type-checks with TypeScript 7. Nothing is emitted. |
| `npm run lint` | Lints with oxlint. |
| `npm run format` | Formats with oxfmt (`format:check` only checks). |
| `npm run check` | All of the above. It must pass before a change counts as done. |

Before changing how the server talks to Bilka, read [docs/research.md](docs/research.md) and [CLAUDE.md](CLAUDE.md).

To record real Bilka responses from your own account for test fixtures, see [docs/capture.md](docs/capture.md).
