# Capturing real BilkaToGo responses

The login, cart and order endpoints are only known from community code (`docs/research.md` §3). Issue #4 confirms them against a real account and turns the answers into small, hand-scrubbed test fixtures. A person with a BilkaToGo account does this, because it needs their credentials.

Two dev-only scripts help. Neither is part of the server or its tools.

| Script | What it does |
|---|---|
| `scripts/capture.ts` | Logs in, calls each endpoint once and saves every raw response as its own file outside the repo. |
| `scripts/key-paths.ts` | Lists every key path in the saved files with a type hint and no values, so personal-data fields are quick to spot. |

## What the capture does

It sends 11 requests at most, in this order. Each answer is saved as `NN-<step>.json` (or `.txt` if it isn't JSON), plus a `summary.json` with the status of each step and what was found.

| # | Step | Request | Source of the request shape |
|---|---|---|---|
| 1 | `algolia-product` | `POST` Algolia `.../prod_BILKATOGO_PRODUCTS/query`, filter `objectID:<id> AND isInAssortmentIn:<store>` | This repo. Checks the product id before anything touches the cart. No login. |
| 2 | `gigya-accounts.login` | `POST https://accounts.eu1.gigya.com/accounts.login`, form `loginID, password, apiKey, httpStatusCodes=true` | nickknissen, stigvoss |
| 3 | `gigya-accounts.getJWT` | `POST .../accounts.getJWT`, form `apiKey, login_token, expiration=86400, httpStatusCodes=true` | nickknissen, stigvoss |
| 4 | `shop-v6-Cart-jwt-only` | `GET https://api.bilkatogo.dk/api/shop/v6/Cart?u=w&extra=deliveryAddress,deliveryDate`, header `jwt_token`, **no cookies** | stigvoss (sends no cookies). Answers whether the server needs step 5. |
| 5 | `auth-LoginJWT` | `POST https://api.bilkatogo.dk/api/auth/LoginJWT?u=w`, header `jwt_token`, **no cookies** | nickknissen. It sets cookies (`PHPSESSID`, `jwt_validation`, `cart` in their fake), which steps 6 to 11 send back. |
| 6 | `shop-v6-Cart` | as step 4, with the session cookies | nickknissen, stigvoss |
| 7 | `shop-v6-ChangeLineCount-1` | `GET .../shop/v6/ChangeLineCount?u=w&productId=<id>&count=1&fullCart=0` | nickknissen, stigvoss |
| 8 | `shop-v6-ChangeLineCount-0` | the same with `count=0` | |
| 9 | `shop-v6-Cart-after` | as step 6, to confirm the product is gone again | |
| 10 | `shop-v7-OrderHistory` | `POST .../shop/v7/OrderHistory?u=w&limit=5&offset=0&muah=1&ordertype=dibs,pgw` | nickknissen uses `POST`; stigvoss uses `GET` with the same parameters |
| 11 | `shop-v7-OrderDetails` | `GET .../shop/v7/OrderDetails?u=w&orderId=<first order in the history>` | nickknissen, stigvoss |

How it keeps your account safe:

- **Your cart ends as it started.** Steps 7 to 9 only run when the product isn't in the cart already (the product id doesn't appear anywhere in the cart answer). Step 8 is sent even if step 7 fails, and step 9 checks the result. If the product is in the cart, or the cart read failed, or Algolia says the product isn't sold at your store, the cart isn't touched. The output always says which happened. If it ever prints `WARNING`, remove the product by hand on bilkatogo.dk.
- **LoginJWT gets no cookies.** nickknissen found that `auth/LoginJWT` replaces the account's cart with the cart stored under any `cart` cookie it's sent. The script sends it none, and throws away any cookie the step 4 probe receives.
- **No secrets in the output or the files.** The password, login token, JWT and cookie values are never printed. In the saved files, every field whose name contains `token`, `cookieValue`, `jwt`, `password`, `secret` or `signature` becomes `"<secret>"`, and any other place a known secret appears is replaced too. The email address isn't printed, but the saved files still hold it and the rest of your personal data: that's what step 3 below is for.
- **Private files outside git.** The default folder is `${XDG_CACHE_HOME:-~/.cache}/bilkatogo-mcp/captures/<time>/`, created with mode 700 and files with mode 600. The script refuses a folder inside the repo or one that already has files in it. `.gitignore` also ignores `captures/`.
- **Light traffic.** One run is about as many requests as opening the site and looking at your cart and last order.

Exit codes: 0 all done; 1 some step failed (see `summary.json`); 2 no credentials, or login failed; 3 the cart may have been left changed; 64 bad arguments.

## Steps

### 1. Prepare

1. `npm install` in the repo, on Node 24 or later.
2. Close every other BilkaToGo client (browser tabs, the app). A second client can undo or redo a cart change minutes later.
3. Pick a cheap product that is **not** in your cart, sold at your store and in stock, and note its id. The `product_id` of a `search_products` result is the id (it is the Algolia `objectID`), for example from asking your MCP client "search Bilka for gulerødder".

### 2. Run the capture

Type the password at a hidden prompt so it stays out of your shell history:

```sh
export BILKATOGO_EMAIL='you@example.com'
read -rs BILKATOGO_PASSWORD && export BILKATOGO_PASSWORD
export BILKATOGO_STORE_ID=1654   # your store
node scripts/capture.ts <product-id>
unset BILKATOGO_PASSWORD
```

Credentials can also come from `~/.config/bilkatogo-mcp/login.json` (mode 600) with the keys `email`, `password` and `loginToken`. Environment variables win. `--out <dir>` picks another output folder.

Read the summary it prints. The line `Password login:` is the answer to "does password login work headless": `worked headless`, or `blocked: CAPTCHA or bot protection`, `invalid credentials`, `blocked: account locked` or `failed`, with Gigya's error code and message. The Gigya error codes it matches on (401020, 401021, 403120) come from SAP's documentation and haven't been seen from Bilka yet, so write down the code and message you actually got.

**If password login is blocked**, use a login token from the browser instead. A token set in `BILKATOGO_LOGIN_TOKEN` skips password login:

1. Log in on bilkatogo.dk, open the developer console and run `localStorage.getItem("auth")`.
2. Copy the login token out of it. Write down in `docs/research.md` what that value looks like (its shape and key names, not the token).
3. Run the capture again with a fresh output folder:

```sh
read -rs BILKATOGO_LOGIN_TOKEN && export BILKATOGO_LOGIN_TOKEN
node scripts/capture.ts <product-id>
unset BILKATOGO_LOGIN_TOKEN
```

Then check your cart on bilkatogo.dk looks as it did before.

### 3. Inspect the keys

```sh
node scripts/key-paths.ts ~/.cache/bilkatogo-mcp/captures/<time>
```

It prints every key path in each file, such as `order.deliveryAddress.order_pickup_code  string  <- personal?`. `personal?` means the key name looks personal; `email-like` means a value looked like an email address. Both are only hints, so read every path. Note each personal-data path for the cart, order history and order details answers: names, address blocks, phone, email, door or access codes, delivery notes, pickup codes, and customer ids such as `uid` and `tid`.

### 4. Make the fixtures by hand

Copy each answer into `test/fixtures/` as a small file, and edit it by hand:

| Capture file | Fixture |
|---|---|
| `gigya-accounts.login` | `gigya-login.json` (and `gigya-login-blocked.json` if it was blocked) |
| `gigya-accounts.getJWT` | `gigya-jwt.json` |
| `auth-LoginJWT` | `login-jwt.json` |
| `shop-v6-Cart` | `cart.json` |
| `shop-v6-Cart-jwt-only` | `cart-jwt-only.json`, only if it differs from `cart.json` (for example a "not logged in" answer) |
| `shop-v6-ChangeLineCount-1` | `change-line-count.json` |
| `shop-v7-OrderHistory` | `order-history.json` |
| `shop-v7-OrderDetails` | `order-details.json` |

- **Trim.** Keep one or two cart lines, one or two orders and a few order lines. Keep every key that appears in a block you keep, so the shape stays real.
- **Replace every personal value**, with these placeholders (the ones nickknissen's fixtures use, so they're recognisable):

| Data | Placeholder |
|---|---|
| Name | `Test Kunde` |
| Email | `kunde@example.com` |
| Phone | `12345678` |
| Street / address | `Testvej 1` |
| Zip code, city | `9999`, `Eksempelby` |
| Home coordinates | `0` |
| Door or access code | `0000` |
| Delivery notes | `Note fjernet` |
| Pickup code | `11223344` |
| Order numbers | `9000000000xx` (`900000000001`, …) |
| Bilka customer ids | `uid` → `900001`, `tid` → `00000000-0000-0000-0000-000000000000` |
| Gigya `UID` | `fake-uid-0001` |
| Login token, JWT | `st2.fake-login-token`, `eyFake.jwt.token` (or keep `<secret>`) |

  Pickup points and stores are public, so their names and addresses stay. A home-delivery address is personal.
- **Search for leftovers** in the new fixtures: your name, email, phone, street, zip code, and real order numbers. For example `grep -rniF -e 'yourname' -e 'you@example.com' -e '<order number>' test/fixtures`.
- Add each file to the table in `test/fixtures/README.md`, saying it was captured live, the date and what was trimmed.

### 5. Second review

Before committing, ask a second person or agent to check the fixture diff (`git diff --cached test/fixtures`) for leftover personal data and secrets. Give them the placeholder table above and the list of personal-data paths from step 3, but not the raw captures. Commit only after they've signed off.

### 6. Update the research

In `docs/research.md` §3:

- Mark each endpoint confirmed, with its method, parameters and the top-level shape of its answer.
- Record the differences from the community code. For example: did `OrderHistory` accept `POST`? Did the cart work with only the `jwt_token` header (step 4), or is `auth/LoginJWT` needed? Which cookies did LoginJWT set? What does a "not logged in" answer look like? Did `ChangeLineCount` take the Algolia `objectID` as `productId`?
- Record whether password login works headless, with the Gigya error code if it didn't.
- Add the list of personal-data field paths for the cart, order history and order details answers. The privacy filter (issue #1) will be built from it.

### 7. Clean up

Delete the raw captures once the fixtures are committed: `rm -r ~/.cache/bilkatogo-mcp/captures/<time>`. Then check that no token made it into git history. This should print nothing:

```sh
git log -p --all | grep -nE 'eyJ[A-Za-z0-9_-]{10,}\.|st2\.[A-Za-z0-9_-]{10,}'
```

## Checklist (from issue #4)

- [ ] The capture script ran against a live account and saved the raw responses outside git:
  - [ ] Gigya account login
  - [ ] the JWT exchange
  - [ ] the cart read
  - [ ] one change-line-count call that sets a cheap product to 1 and then back to 0
  - [ ] order history
  - [ ] order details
- [ ] `docs/research.md` §3 is updated with the confirmed endpoint, parameter and response details, and with any differences from the community code.
- [ ] The personal-data field names in the cart, order-history and order-details responses are listed: name, address blocks, phone, email, door or access code, delivery notes and pickup code.
- [ ] Whether password login works headless is recorded: it works, or it fails with CAPTCHA or bot protection.
- [ ] Small fixture files for each response type are committed, with every personal value replaced by hand. A second person or agent reviewed them for leftover personal data before they were committed.
- [ ] No credentials, tokens or JWTs appear in the repo or in git history.
