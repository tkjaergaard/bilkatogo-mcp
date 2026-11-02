# Test fixtures

Small JSON files shaped like real Bilka responses. The fake Bilka (`test/support/fake-bilka.ts`) answers from them. Keep them small, and scrub personal data by hand before committing one.

| File | What it is | Source |
|---|---|---|
| `algolia-products.json` | An Algolia query response from `prod_BILKATOGO_PRODUCTS` with five products (query "skyr", store 1653). The fake uses its `hits` as the product index. | Trimmed from `tests/fixtures/algolia_products.json` in [nickknissen/bilkatogo](https://github.com/nickknissen/bilkatogo): `storeData` kept for stores 1653 and 1661 only, `last_syncronized` dropped. |

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
