# Test fixtures

Small JSON files shaped like real Bilka responses. The fake Bilka (`test/support/fake-bilka.ts`) answers from them. Keep them small, and scrub personal data by hand before committing one.

| File | What it is | Source |
|---|---|---|
| `algolia-products.json` | An Algolia query response from `prod_BILKATOGO_PRODUCTS` with five products (query "skyr", store 1653). The fake uses its `hits` as the product index. | Trimmed from `tests/fixtures/algolia_products.json` in [nickknissen/bilkatogo](https://github.com/nickknissen/bilkatogo): `storeData` kept for stores 1653 and 1661 only, `last_syncronized` dropped. |
| `algolia-object-19753.json` | The full Algolia record for product 19753, from the objects endpoint. The fake puts it in its index in place of the trimmed copy in `algolia-products.json`, so `get_product_details` sees `infos` (nutrition, ingredients, storage). | Captured live on 2026-11-02 with the public search-only key (no login, no personal data): `storeData` kept for stores 1653 and 1661 only, `last_syncronized` dropped, `popularity` set to the search fixture's value. Every other field matches the search fixture's copy. |
| `available-delivery-addresses.json` | A `shop/v6/AvailableDeliveryAddresses` response, fetched without login. Covers a store alone (1654, 1653), a pickup point listed before its store (1662) and a store with two pickup points (1652). | Trimmed from `tests/fixtures/available_delivery_addresses.json` in nickknissen/bilkatogo: 7 of 22 addresses kept. Public store addresses only. |
| `gigya-login.json` | Gigya `accounts.login` answer for a password login. `sessionInfo.cookieValue` is the login token. | Captured live on 2026-11-02 with the developer's account (`scripts/capture.ts`), then scrubbed (see below). |
| `gigya-jwt.json` | Gigya `accounts.getJWT` answer; `id_token` is the JWT. | Captured and scrubbed, as above. |
| `shop-login-jwt.json` | `api/auth/LoginJWT` answer (`msg: "authenticated"`). Not needed for the shop calls, see `docs/research.md` §3. | Captured and scrubbed, as above. |
| `shop-cart.json` | `shop/v6/Cart?extra=deliveryAddress,deliveryDate`, logged in, home delivery. Holds only the two service lines (`Pakkeservice`, product 81474); no groceries were in the cart. For carts with groceries, build lines in the `lines[].lines[].orderlines[]` shape from `shop-order-details.json`. | Captured and scrubbed, as above. |
| `shop-change-line-count.json` / `shop-change-line-count-zero.json` | `shop/v6/ChangeLineCount` setting product 156353 to 1, then to 0. | Captured and scrubbed, as above. |
| `shop-order-history.json` | `shop/v7/OrderHistory`, trimmed to two orders: one home delivery and one pickup. | Captured and scrubbed, as above. |
| `shop-order-details.json` | `shop/v7/OrderDetails` for the first order in the history, trimmed to the first three line groups with at most two lines each. | Captured and scrubbed, as above. |

Covered cases in `algolia-products.json`, store 1653: a plain product (19753), a "Skarp pris" discount with no `beforePrice` (128298), a "Mix 10 for 25,00" multibuy (18381), out of stock (140787) and a "Spar 4,95" discount with `beforePrice` that is out of stock (169794).

nickknissen/bilkatogo is MIT licensed:

> MIT License
>
> Copyright (c) 2026 Nick Nissen
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Scrubbed account fixtures

The `gigya-*` and `shop-*` files come from one live capture of the developer's account. Every personal value was replaced with an obvious fake before committing, so tests can check the privacy scrub against them:

- names `Test Testesen`, address `Testvej 1, 1. tv`, `0000 Testby`, coordinates `55.0000000, 10.0000000`
- door code `FAKE-DOORCODE-1234`, pickup code `FAKE-PICKUP-9876`, delivery notes starting `FAKE-NOTE:`, access text `FAKE-ACCESS:`
- account and session ids (`uid` 1000001, `eid` 2000001, `tid`, Gigya `UID`, signatures) and order ids (`900000000001` …), kept consistent across files
- the login token, JWT and payment provider id as `test-…` strings; Gigya account dates as 2026-01-01

A script checked that none of the real personal values from the capture appear anywhere in these files. The developer then reviewed them by hand.
