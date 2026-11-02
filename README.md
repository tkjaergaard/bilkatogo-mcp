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

Placing orders and payment stay on the website: the server can't do either. Your name, address, door code and delivery notes are replaced with a marker before anything reaches the model.

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

Tools that use your account (so far `get_cart` and `set_cart_quantity`) need a BilkaToGo login. The server logs in only when such a tool runs; search and the store list work without any credentials.

### Credential options

Give the server one or both of these:

- **Email and password**: `BILKATOGO_EMAIL` and `BILKATOGO_PASSWORD`. The server logs in through Bilka's login service (SAP Gigya) by itself.
- **A pasted login token**: `BILKATOGO_LOGIN_TOKEN`. This is the fallback in case Bilka ever blocks automated password login. To get one, log in on [bilkatogo.dk](https://www.bilkatogo.dk), open the browser's developer console and run `localStorage.getItem("auth")`.

Each can come from the environment or from `~/.config/bilka-mcp/login.json` (under `$XDG_CONFIG_HOME` when that's set). The environment wins when both are set. Keep the file readable only by you; the server warns when it isn't:

```sh
mkdir -p ~/.config/bilka-mcp
(umask 077 && cat > ~/.config/bilka-mcp/login.json) <<'JSON'
{ "email": "you@example.com", "password": "PASSWORD", "loginToken": "OPTIONAL-PASTED-TOKEN" }
JSON
chmod 600 ~/.config/bilka-mcp/login.json  # in case the file already existed
```

Leave out the keys you don't use.

### How the server logs in

When a tool needs the account, the server tries these login sources in order, each at most once, and uses the first that works:

1. the remembered login token from the session file (see below)
2. the pasted login token
3. a fresh login with your email and password

The login token is swapped for a 24-hour session (a JWT), kept in memory and renewed a few minutes before it runs out. If Bilka still says a request isn't logged in, the server logs in again and retries that request once. If every source fails, the tool's error lists the sources it tried and what Bilka answered, without any secret in it.

### The session file

A login token that works is saved to `~/.config/bilka-mcp/session.json` (under `$XDG_CONFIG_HOME` when that's set) as `{"loginToken": "…"}`, so a restart doesn't need a fresh password login. The file is written atomically (a temp file renamed into place) with mode 600, readable only by you. If it can't be written, the server writes a warning to stderr and carries on; it will log in again after the next restart. Delete the file to make the server forget the login.

## Register it in Claude Code

From the repo directory:

```sh
claude mcp add bilka -e BILKATOGO_STORE_ID=1654 -- node "$PWD/src/main.ts"
```

Then ask Claude something like "find havremælk". Add `-s user` to make the server available in every project.

The store id isn't a secret, so it's fine in the MCP config. Your password and login token are: keep them in `~/.config/bilka-mcp/login.json` with mode 600 (or in your shell's environment), never in an MCP config you might commit.

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
