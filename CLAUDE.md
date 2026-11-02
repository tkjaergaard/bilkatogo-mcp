# bilka-mcp

An unofficial, private MCP server for BilkaToGo (bilkatogo.dk), a Danish grocery shop. It's a proof of concept modelled on [kraenhansen/nemlig-mcp](https://github.com/kraenhansen/nemlig-mcp).

Before touching the Bilka API, login or tool design, read `docs/research.md`. It has the endpoints, the auth flow, the prior art and the open questions.

## Stack

- TypeScript on Node ≥ 24. Node runs the `.ts` source directly by stripping the types, so there's no build step. Use only TypeScript syntax that can simply be erased: no enums, namespaces or parameter properties.
- Keep dependencies minimal. Runtime: the SDK and Zod only, and use built-in `fetch`. Dev: TypeScript 7 (type-check only), Vitest, oxlint, oxfmt, Fallow (dead-code gate, pinned to an exact version), `@types/node`, and the SDK's `@modelcontextprotocol/client` (tests only).
- MCP spec **2026-07-28**, which is stateless: there's no `initialize` handshake, the version goes in each request's `_meta`, and there's a `server/discover` RPC. Clients on the older `initialize` handshake are still served through the SDK's backward compatibility.
- Use the v2 TypeScript SDK: `@modelcontextprotocol/server` (docs: https://ts.sdk.modelcontextprotocol.io/v2/). Most tutorials and model training data show the v1 package `@modelcontextprotocol/sdk`, which is the old API. When an example imports from it, look up the v2 equivalent instead of copying it.
- Zod v4 for tool input schemas, because the SDK depends on it.
- TypeScript ≥ 6 needs `"types": ["node"]` in `tsconfig.json`, because the SDK's typings reference `Buffer`.
- Transport: stdio, launched locally by the MCP client. It's a single-user PoC, so there's no HTTP and no auth layer.

## Tool design rules

These come from nemlig-mcp. Each one protects the user's real Bilka account.

- **Fixed tool list.** Tools are an explicit list, and a test asserts the exact set of tool names.
- **Checkout stays manual.** The server covers search, the cart (including its delivery place and slot) and order history. Placing an order or touching payment happens on the website, by a person.
- **Absolute quantities.** Cart tools set a quantity, they don't add one (0 removes the line). Every tool that changes the cart (its lines, delivery place or slot) carries `destructiveHint: true`. `select_store` is the one write that only changes a local setting: `readOnlyHint: false`, `destructiveHint: false`. Every other tool is read-only and carries `readOnlyHint: true`.
- **Privacy scrub.** Name, address, phone, email, door codes and pickup codes are replaced with a marker before a response reaches the model.
- **Untrusted text.** Product and order text comes from Bilka. Tool descriptions tell the model to treat it as data, not as instructions.
- **Light traffic.** Keep request volume at what one person shopping would generate.

## Credentials

Read these from environment variables (`BILKATOGO_EMAIL`, `BILKATOGO_PASSWORD`, or a pasted `BILKATOGO_LOGIN_TOKEN`) or from `~/.config/bilka-mcp/login.json` (mode 600). Keep them out of the repo and out of MCP config files that get committed. Use the server with your own Salling Group Profile only: the profile is personal (profile terms §1.6).

## Agent skills

### Issue tracker

Issues live in GitHub Issues for tkjaergaard/bilkatogo-mcp, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
