# bilkatogo-mcp

Let your AI assistant shop at [BilkaToGo](https://www.bilkatogo.dk): search the catalogue and this week's offers, fill your cart, pick a delivery slot and buy a past order again. You place the order yourself, on the website.

It's an unofficial MCP server that runs locally on your computer. It isn't affiliated with Bilka or Salling Group. Use it with your own account only and at your own risk (see [Disclaimer](#disclaimer)).

## What you can ask

```txt
Use Bilka Odense and find havremælk, cheapest per litre first.
```

```txt
What's on offer in Mejeri & køl this week?
```

```txt
Put everything from my last order in the cart again, but no bananas.
```

```txt
Home delivery is sold out on Friday. Switch the cart to pickup in the store and pick a slot Friday afternoon.
```

## Quick start

You need [Node.js](https://nodejs.org) 24 or later. `npx` comes with it, so there's nothing to clone or install.

**1. Log in.** This asks for your BilkaToGo email and password and saves only a login token. Your password isn't stored.

```sh
npx bilkatogo-mcp@latest login
```

**2. Add the server to your MCP client.** In Claude Code:

```sh
claude mcp add bilka -s user -- npx -y bilkatogo-mcp@latest
```

<details>
<summary>Claude Desktop and other MCP clients</summary>

Any MCP client works the same way: it runs `npx -y bilkatogo-mcp@latest` over stdio. In Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bilka": { "command": "npx", "args": ["-y", "bilkatogo-mcp@latest"] }
  }
}
```

</details>

**3. Ask for your store**, for example "use Bilka Odense". Search shows what one store carries, so the assistant picks one first and remembers it.

With `@latest`, `npx` checks for a new version each time your MCP client starts the server, so updates arrive on the next restart. To stay on one version, name it instead, e.g. `bilkatogo-mcp@0.1.1`.

## Tools

| Tool | What it does | Login |
|---|---|---|
| `search_products` | Searches or browses the catalogue at your store: by text, category, this week's leaflet (Bilka Avisen), offers or one mix offer, sorted by price or unit price. | no |
| `list_categories` | The shop's category tree, one level at a time, with product counts (all, leaflet or offers). | no |
| `get_product_details` | One product's size, prices, labels, ingredients, allergens and nutrition. | no |
| `list_stores` | The Bilka stores and the pickup points each one serves. | no |
| `select_store` | Chooses your store by id or name ("odense"). A local setting; your Bilka account doesn't change. | no |
| `get_cart` | Your cart: lines, totals, fees, and where and when it's delivered. | yes |
| `set_cart_quantity` | Sets one product's quantity in the cart (0 removes it). | yes |
| `set_cart_quantities` | Sets up to 50 cart lines in one go, e.g. a recipe or a past order, at one person's pace. | yes |
| `list_delivery_places` | Home delivery, pickup in a Bilka store and PickUp points, with their minimum orders. | yes |
| `set_delivery_place` | Moves the cart to one of those places. | yes |
| `list_delivery_slots` | The next two weeks of slots at the cart's place, with order deadlines. | yes |
| `set_delivery_slot` | Sets the cart's slot. Bilka reserves nothing until you order. | yes |
| `get_order_history` | Your past orders, newest first. | yes |
| `get_order_details` | Everything in one past order, ready to buy again with the cart tools. | yes |

### What it won't do

- **Place orders or touch payment.** Checkout stays on the website, done by you. The tool list is fixed, and a test checks it.
- **Show your personal details to the model.** Your name, address, phone, email, door and pickup codes and delivery notes are replaced with a marker first.
- **Change your cart without the client knowing.** Every tool that changes the cart is flagged destructive, so your MCP client can ask you first. Quantities are absolute: setting 2 means 2, not 2 more.
- **Hammer Bilka.** Requests stay at the pace of one person shopping.

## Your store

The assistant calls `list_stores` and `select_store` for you. A pickup-point name picks the store that serves it, and when a name matches several stores, it asks you which one. The choice is saved in `~/.config/bilkatogo-mcp/settings.json`.

When you move the cart to pickup in another store, the selected store follows it, so search shows the cart's prices.

To set a default store without asking, set `BILKATOGO_STORE_ID` (e.g. `claude mcp add bilka -e BILKATOGO_STORE_ID=1654 -- npx -y bilkatogo-mcp@latest`) or `"storeId"` in `login.json` (below). A store chosen with `select_store` wins over both.

## Logging in

Search and the store list work without a login. The cart, delivery and order tools need your BilkaToGo login.

| Command | What it does |
|---|---|
| `npx bilkatogo-mcp@latest login` | Logs in with email and password. Only the login token is saved. |
| `npx bilkatogo-mcp@latest login --token` | Logs in with a login token pasted from the browser, in case Bilka ever blocks password login. |
| `npx bilkatogo-mcp@latest status` | Checks whether the saved login still works. |
| `npx bilkatogo-mcp@latest logout` | Forgets the saved login. |

Restart your MCP client after logging in if the server is already running.

<details>
<summary>Other ways to give it your login</summary>

Instead of the `login` command, the server can log in by itself with either of these:

- **Email and password**: `BILKATOGO_EMAIL` and `BILKATOGO_PASSWORD`.
- **A pasted login token**: `BILKATOGO_LOGIN_TOKEN`. Log in on [bilkatogo.dk](https://www.bilkatogo.dk), open the browser's developer console and run `localStorage.getItem("auth")`.

Each can come from the environment or from `~/.config/bilkatogo-mcp/login.json`. The environment wins when both are set. Leave out the keys you don't use:

```sh
mkdir -p ~/.config/bilkatogo-mcp
(umask 077 && cat > ~/.config/bilkatogo-mcp/login.json) <<'JSON'
{ "email": "you@example.com", "password": "PASSWORD", "loginToken": "OPTIONAL-PASTED-TOKEN", "storeId": "1654" }
JSON
chmod 600 ~/.config/bilkatogo-mcp/login.json  # in case the file already existed
```

Keep your password and login token out of MCP config files, which are easy to commit by accident.

</details>

<details>
<summary>How the server logs in, and where it keeps things</summary>

When a tool needs your account, the server tries these in order and uses the first that works:

1. the saved login token in `session.json` (from `login`, or from an earlier run)
2. the pasted login token
3. a fresh login with your email and password

If every source fails, the tool's error says what it tried and what Bilka answered.

Its files live in `~/.config/bilkatogo-mcp/` (under `$XDG_CONFIG_HOME` when that's set), readable only by you:

| File | Holds |
|---|---|
| `session.json` | The working login token, so a restart needn't log in again. Deleted when Bilka rejects it, or by `logout`. |
| `settings.json` | The store you chose with `select_store`. |
| `login.json` | Credentials you wrote yourself (optional). The server only reads it. |

</details>

## Disclaimer

bilkatogo-mcp is unofficial and is not affiliated with, endorsed by or supported by Bilka or Salling Group A/S. "Bilka" and "BilkaToGo" are trademarks of Salling Group, used here only to say what the software works with. It talks to BilkaToGo's private web API, the same one the website uses, which can change or stop working at any time.

BilkaToGo's and Salling Group's terms don't mention tools like this, and automated use may still conflict with them. Salling Group may deactivate a Salling Group Profile it believes is misused (profile terms §5.5, §9). That profile is also your login for Bilka plus, føtex plus, Netto+ and other Salling services, so losing it affects more than BilkaToGo.

**Use it with your own profile only**, at your own risk, and at the pace of one person shopping. Don't run it for someone else or with their login. It never places orders or handles payment. This isn't legal advice.

## Development

From a clone, Node runs the TypeScript source directly, with no build step:

```sh
git clone https://github.com/tkjaergaard/bilkatogo-mcp.git
cd bilkatogo-mcp
npm install
claude mcp add bilka -- node "$PWD/src/main.ts"
```

The setup commands work the same way: `node src/main.ts login`. `npm run check` runs everything CI runs.

- [CLAUDE.md](CLAUDE.md) and [docs/research.md](docs/research.md): read these before changing how the server talks to Bilka.
- [docs/capture.md](docs/capture.md): recording real Bilka responses for test fixtures.
- [docs/releasing.md](docs/releasing.md): releases go to npm through a release PR.

## License

[MIT](LICENSE). The test fixtures derived from nickknissen/bilkatogo keep its MIT notice, see [test/fixtures/README.md](test/fixtures/README.md).
