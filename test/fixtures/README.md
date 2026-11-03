# Test fixtures

Small JSON files shaped like real Bilka responses. The fake Bilka (`test/support/fake-bilka.ts`) answers from them. Keep them small, and scrub personal data by hand before committing one.

Product fixtures are a handful of records kept for tests, with no images; they aren't a copy of Bilka's catalogue. Never commit image files: fixtures only hold image URLs, and a test that needs a new one should use a fake host such as `https://images.example/…`.

| File | What it is | Source |
|---|---|---|
| `algolia-products.json` | An Algolia query response from `prod_BILKATOGO_PRODUCTS` with six products (query "skyr", store 1653). The fake uses its `hits` as the product index. | The first five trimmed from `tests/fixtures/algolia_products.json` in [nickknissen/bilkatogo](https://github.com/nickknissen/bilkatogo): `storeData` kept for stores 1653 and 1661 only, `last_syncronized` dropped. The sixth (91454, a leaflet product) captured live on 2026-11-02 with the public search-only key (no login, no personal data), trimmed the same way and to the fields the other five have (no `infos`, `attributes`, `energyInfo`, `safety*`, `imageGUIDs`, search hierarchies or `alternativeSearchWords`); `nbHits` and `hitsPerPage` set to 6. |
| `algolia-object-19753.json` | The full Algolia record for product 19753, from the objects endpoint. The fake puts it in its index in place of the trimmed copy in `algolia-products.json`, so `get_product_details` sees `infos` (nutrition, ingredients, storage). | Captured live on 2026-11-02 with the public search-only key (no login, no personal data): `storeData` kept for stores 1653 and 1661 only, `last_syncronized` dropped, `popularity` set to the search fixture's value. Every other field matches the search fixture's copy. **Hand-edited:** the marketing text (`infos` section `description`) and the storage advice (`Opbevaringsinstruktioner`) are replaced with synthetic text, so no Bilka or supplier prose is redistributed; the description keeps the captured HTML (`<BR>`, `<H2>`) for the text-cleanup test. Ingredients, nutrition and the other product facts are as captured. |
| `algolia-categories-leaflet.json` | An Algolia query answer with no hits and the facet `consumerFacingHierarchy.lvl0`: this week's leaflet products per top-level category at store 1653, in stock (22 values, "Not Categorized" included). Tests script it to check `list_categories` against real counts. | Captured live on 2026-11-02 with the public search-only key (no login, no personal data), filters `isInAssortmentIn:1653 AND nonsearchable:false AND inStockStore:1653 AND isInCurrentLeaflet:true`, `maxValuesPerFacet: 1000`. Timing fields (`processingTimeMS`, `processingTimingsMS`, `serverTimeMS`), `renderingContent` and `extensions` dropped. |
| `algolia-mix-products.json` | Four mix-offer products, as an Algolia query response. The fake index doesn't hold them by default; the mix tests add them (`test/mix-offers.test.ts`). Store 1653: Pærer (50998) in the bananas' "Mix 10 for 25,00" (mix 2680, so with 18381 in `algolia-products.json` that mix has several products), Æbler (18379) with mix id 2680 but no offer text at 1653, and Pizzadej (81452) and Pølsehornsdej (81451) in "3 for 2" (mix 11220188), which has no `multiPromoPrice`; both are in the leaflet. | Captured live on 2026-11-02 with the public search-only key (no login, no personal data) from the queries `multipromos:2680` and `multipromos:11220188` at store 1653, trimmed like the sixth hit in `algolia-products.json` (same fields; `storeData` for 1653 and 1661 only). **Hand-edited:** live, Æbler has the mix at every store; here its store 1653 data has an empty `offerDescription` and `multipromo`, `offerCount` 0 and an empty `multiPromoPrice`, and 1653 is removed from `isInOffer`, to model a mix that another store has. Store 1661 is as captured. |
| `salling-alternative-products.json` | A Salling Group `v2/recommendations/alternative-products/bilkatogo/<sku>` answer for the bananas (18381, sku 89300500105). The fake answers by the sku in the path. | **Synthetic**, in the shape captured live on 2026-11-03 with the shared key and no account id (`personalized: "false"`, `customerId` empty): the three suggestions are products from `algolia-products.json` (19753, 128298) and one id the index lacks (999999), with captured-style lowercase names, made-up EANs where the index has none, and scores from the capture. |
| `salling-most-bought.json` | A Salling Group `v2/recommendations/most-bought/bilkatogo` answer for the test account (`customerId` `test-tid`, the cart fixture's `tid`). | **Synthetic**, in the shape captured live on 2026-11-03: a real answer is the account's purchase history, so none of it is kept. The suggestions are products from `algolia-products.json` (18381, 19753) and one id the index lacks (999999). |
| `available-delivery-addresses.json` | A `shop/v6/AvailableDeliveryAddresses` response, fetched without login. Covers a store alone (1654, 1653), a pickup point listed before its store (1662) and a store with two pickup points (1652). | Trimmed from `tests/fixtures/available_delivery_addresses.json` in nickknissen/bilkatogo: 7 of 22 addresses kept. Public store addresses only. |
| `gigya-login.json` | Gigya `accounts.login` answer for a password login. `sessionInfo.cookieValue` is the login token. | Captured live on 2026-11-02 with the developer's account (`scripts/capture.ts`), then scrubbed (see below). |
| `gigya-jwt.json` | Gigya `accounts.getJWT` answer; `id_token` is the JWT. | Captured and scrubbed, as above. |
| `shop-login-jwt.json` | `api/auth/LoginJWT` answer (`msg: "authenticated"`). Not needed for the shop calls, see `docs/research.md` §3. | Captured and scrubbed, as above. |
| `shop-cart.json` | `shop/v6/Cart?extra=deliveryAddress,deliveryDate`, logged in, home delivery. Holds only the two service lines (`Pakkeservice`, product 81474); no groceries were in the cart. For carts with groceries, build lines in the `lines[].lines[].orderlines[]` shape from `shop-order-details.json`. | Captured and scrubbed, as above. **Hand-edited:** the chosen slot (the `deliveryDate` block and `deliveryAddress.currentDeliveryDate`) is a synthetic one, Monday 2030-01-07 17:00–21:00, instead of the account's real past slot; it's still closed and offered by no place in the fixtures. |
| `shop-change-line-count.json` / `shop-change-line-count-zero.json` | `shop/v6/ChangeLineCount` setting product 156353 to 1, then to 0. | Captured and scrubbed, as above. |
| `shop-order-history.json` | `shop/v7/OrderHistory`, trimmed to two orders: one home delivery and one pickup. | Captured and scrubbed, as above, then made **synthetic** (see below): the item previews, dates, times, item counts and totals are invented. |
| `shop-order-details.json` | `shop/v7/OrderDetails` for the first order in the history, trimmed to the first three line groups with at most two lines each. | Captured and scrubbed, as above, then made **synthetic** (see below): the three grocery lines are invented products, and the dates, times, item counts and totals are invented. The two service lines (`Leveringsgebyr`, `Pakkeservice`) are as captured. |
| `shop-not-logged-in.json` | The shop's answer without a JWT (`shop/v3/AvailableDeliveryDates`). The fake answers every unauthenticated shop call with it. | Captured live on 2026-11-02 without logging in. No personal data. |
| `shop-delivery-places.json` | `shop/v6/AvailableDeliveryAddresses?orderByZipcode=`, logged in: the account's home address (the fake one from `shop-cart.json`, id 999001) and three public places (Bilka Waves 3192, Bilka Odense 21046, PickUp Skejby 142728) of 23. | Captured in the delivery round trip on 2026-11-02 (see `docs/research.md` §3), then scrubbed: the home entry replaced, and `recipient_name`, `dawa_uid` and `temporary_zipcode` (the customer's zip, present on every entry) faked on the public ones. |
| `shop-delivery-dates.json` | `shop/v3/AvailableDeliveryDates` at home delivery in Odense: 14 days, one night slot a day, including a sold-out day and today's slot past its deadline. | Captured and scrubbed (account ids only). |
| `shop-delivery-dates-pickup.json` | The same at the Bilka Odense pickup: two-hour slots, with the warning that the cart's chosen slot isn't offered there. Trimmed to 4 of 14 days. | Captured and scrubbed, as above. |
| `shop-set-delivery-address.json` / `shop-set-delivery-address-home.json` | `shop/v6/SetDeliveryAddress` switching to the Bilka Odense pickup, and back home. | Captured and scrubbed: the home place replaced as above, the delivery notes faked. |
| `shop-set-delivery-date.json` | `shop/v3/SetDeliveryDate`, setting the slot the cart already had. | Captured and scrubbed: the delivery notes faked. |

Covered cases in `algolia-products.json`, store 1653: a plain product (19753), a "Skarp pris" discount with no `beforePrice` (128298), a "Mix 10 for 25,00" multibuy (18381), out of stock (140787) a "Spar 4,95" discount with `beforePrice` that is out of stock (169794), and a product in this week's leaflet (`isInCurrentLeaflet: true`) with a "Spar 7,95" discount and offer dates, in stock (91454). Only 91454 is in the leaflet.

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

The `gigya-*` and `shop-*` files come from live captures of the developer's account. Every personal value was replaced with an obvious fake before committing, so tests can check the privacy scrub against them:

- names `Test Testesen`, address `Testvej 1, 1. tv`, `0000 Testby`, coordinates `55.0000000, 10.0000000`
- door code `FAKE-DOORCODE-1234`, pickup code `FAKE-PICKUP-9876`, delivery notes starting `FAKE-NOTE:`, access text `FAKE-ACCESS:`
- account and session ids (`uid` 1000001, `eid` 2000001, `tid`, Gigya `UID`, signatures) and order ids (`900000000001` …), kept consistent across files. The delivery fixtures keep Bilka's real `eid` values (-1, -2), which turned out to be error ids, and use `tid` `00000000-0000-4000-8000-000000000001`
- the login token, JWT and payment provider id as `test-…` strings; Gigya account dates as 2026-01-01

A script checked that none of the real personal values from the capture appear anywhere in these files. The developer then reviewed them by hand.

## Synthetic orders

The two order fixtures keep the captured structure, every key and the scrubbed values above, but not what was bought, when, or what it cost:

- the grocery lines are invented products with ids `900101` (Rundstykker), `900102` (Makrel i tomat) and `900103` (Kikærter øko), matching ERP and article numbers, made-up prices and sizes, and image GUIDs of zeros and the id
- the history previews name invented items
- the orders are dated 2026-01-10 (delivered Monday 2026-01-12) and 2025-12-05 (picked up Saturday 2025-12-06)
- the totals are invented but consistent: the first order is 523,45 kr. of products (20 items, 42,10 kr. saved) plus 78,00 kr. in fees, 601,45 kr. in all, with VAT at a fifth of that

`test/support/carts.ts` builds grocery carts from these lines, so cart tests use the same invented products.
