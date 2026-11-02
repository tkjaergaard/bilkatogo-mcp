# Test fixtures

Small JSON files shaped like real Bilka responses. The fake Bilka (`test/support/fake-bilka.ts`) answers from them. Keep them small, and scrub personal data by hand before committing one.

| File | What it is | Source |
|---|---|---|
| `algolia-products.json` | An Algolia query response from `prod_BILKATOGO_PRODUCTS` with five products (query "skyr", store 1653). The fake uses its `hits` as the product index. | Trimmed from `tests/fixtures/algolia_products.json` in [nickknissen/bilkatogo](https://github.com/nickknissen/bilkatogo): `storeData` kept for stores 1653 and 1661 only, `last_syncronized` dropped. |
| `algolia-object-19753.json` | The full Algolia record for product 19753, from the objects endpoint. The fake puts it in its index in place of the trimmed copy in `algolia-products.json`, so `get_product_details` sees `infos` (nutrition, ingredients, storage). | Captured live on 2026-11-02 with the public search-only key (no login, no personal data): `storeData` kept for stores 1653 and 1661 only, `last_syncronized` dropped, `popularity` set to the search fixture's value. Every other field matches the search fixture's copy. |
| `available-delivery-addresses.json` | A `shop/v6/AvailableDeliveryAddresses` response, fetched without login. Covers a store alone (1654, 1653), a pickup point listed before its store (1662) and a store with two pickup points (1652). | Trimmed from `tests/fixtures/available_delivery_addresses.json` in nickknissen/bilkatogo: 7 of 22 addresses kept. Public store addresses only. |

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
