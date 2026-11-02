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

Placing orders and payment stay on the website: the server can't do either.

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

## Register it in Claude Code

From the repo directory:

```sh
claude mcp add bilka -e BILKATOGO_STORE_ID=1654 -- node "$PWD/src/main.ts"
```

Then ask Claude something like "find havremælk". Add `-s user` to make the server available in every project.

The store id isn't a secret, so it's fine in the MCP config. Credentials (needed later for the cart and order history) belong in environment variables or in `~/.config/bilka-mcp/login.json` with mode 600, never in an MCP config you might commit.

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
