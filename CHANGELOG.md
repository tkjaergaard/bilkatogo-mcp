# Changelog

## [0.2.0](https://github.com/tkjaergaard/bilkatogo-mcp/compare/v0.1.0...v0.2.0) (2026-11-02)


### ⚠ BREAKING CHANGES

* keep config and cache in bilkatogo-mcp folders

### Features

* browse Bilka Avisen with only_leaflet, paging and offer dates ([b39bbad](https://github.com/tkjaergaard/bilkatogo-mcp/commit/b39bbad81425edbeaad36ee98f423733f2ccf0d7))
* cap search paging at page 20 and pace cart batches ([0e7be19](https://github.com/tkjaergaard/bilkatogo-mcp/commit/0e7be198898a418eda7a2511ecb453c41665037b))
* delivery place and slot tools ([6ea3d9a](https://github.com/tkjaergaard/bilkatogo-mcp/commit/6ea3d9ad9c549700fb693a423c4b04b1ec693d10))
* dev-only capture script for live Bilka responses ([#4](https://github.com/tkjaergaard/bilkatogo-mcp/issues/4)) ([ebc4251](https://github.com/tkjaergaard/bilkatogo-mcp/commit/ebc4251a1bdcf51002343227fcc61f28ebdaca55))
* full login chain with password login, session file and retry ([#6](https://github.com/tkjaergaard/bilkatogo-mcp/issues/6)) ([2df20b4](https://github.com/tkjaergaard/bilkatogo-mcp/commit/2df20b4c5e7e990fb23e3a4578001f779a63d4a3))
* get_cart via pasted login token, with privacy scrub ([#5](https://github.com/tkjaergaard/bilkatogo-mcp/issues/5)) ([2758e0e](https://github.com/tkjaergaard/bilkatogo-mcp/commit/2758e0e969408b016f439477abf0462aab2c1d49))
* get_order_history and get_order_details ([#9](https://github.com/tkjaergaard/bilkatogo-mcp/issues/9)) ([220a17c](https://github.com/tkjaergaard/bilkatogo-mcp/commit/220a17c15abe47ea074df972122e90759e2417a4))
* keep config and cache in bilkatogo-mcp folders ([7799737](https://github.com/tkjaergaard/bilkatogo-mcp/commit/77997372b08512d1fba88896df3b03197f49a217))
* list_categories and the category filter in search_products ([1face8b](https://github.com/tkjaergaard/bilkatogo-mcp/commit/1face8b0babbeffb714bfe23fa41ed491c66a2cf))
* list_stores and get_product_details ([9f026f2](https://github.com/tkjaergaard/bilkatogo-mcp/commit/9f026f2cfe7b142715e0d64e6c68bb00238a046f))
* mix offers, the mix block and mix_offer_id in search_products ([5515ba8](https://github.com/tkjaergaard/bilkatogo-mcp/commit/5515ba872143ac93d2e465362043ff500e7cd6a8))
* project setup and search_products end to end ([5ecadb9](https://github.com/tkjaergaard/bilkatogo-mcp/commit/5ecadb994414e203a2bfc9df25e212cdb8759a16))
* run with npx, login commands and npm releases ([79c0e59](https://github.com/tkjaergaard/bilkatogo-mcp/commit/79c0e59a8261ee7bd0d1be5ceb4351e29a865155))
* run with npx, with login/status/logout commands ([9481fb5](https://github.com/tkjaergaard/bilkatogo-mcp/commit/9481fb5c9e800e231f3bc659afe3158a15b89df7))
* select_store chooses the Bilka store by id or name ([39f106d](https://github.com/tkjaergaard/bilkatogo-mcp/commit/39f106d3c3635bd382c964104905f3502ab129e2))
* send an honest User-Agent on every Bilka request ([4865672](https://github.com/tkjaergaard/bilkatogo-mcp/commit/4865672fdd77fbcd2c614aa5e86f1d7661341445))
* set_cart_quantities sets several cart lines with retries ([#8](https://github.com/tkjaergaard/bilkatogo-mcp/issues/8)) ([f0ad45a](https://github.com/tkjaergaard/bilkatogo-mcp/commit/f0ad45a4654f5f922b7c1b8a515e7aab8bfb0e6e))
* set_cart_quantity sets one cart line to an absolute quantity ([#7](https://github.com/tkjaergaard/bilkatogo-mcp/issues/7)) ([f9ac027](https://github.com/tkjaergaard/bilkatogo-mcp/commit/f9ac027ecc5b972428aeef49a47acacaebc481f8))
* sort search_products by price and unit price ([64bf4f5](https://github.com/tkjaergaard/bilkatogo-mcp/commit/64bf4f5e930b6229b8e13965f2257077c9af08e2))


### Bug Fixes

* address review findings on the initial server ([#1](https://github.com/tkjaergaard/bilkatogo-mcp/issues/1)) ([205d649](https://github.com/tkjaergaard/bilkatogo-mcp/commit/205d649833d9aa819325829210c87a3d0194a3b7))
* **bilka:** treat Gigya outages and body timeouts as temporary ([02bfce6](https://github.com/tkjaergaard/bilkatogo-mcp/commit/02bfce62dccbd4cb4c50004c2c4e0679f8ee8e33))
* **capture:** send the server's User-Agent ([21e77a8](https://github.com/tkjaergaard/bilkatogo-mcp/commit/21e77a805d871d804c96fa47ae9496211b9581fe))
* flag set_delivery_slot destructive ([d20ebb9](https://github.com/tkjaergaard/bilkatogo-mcp/commit/d20ebb99339bfa3899b35e3012f4b28347d36f6d))
* list a mix's products only when the store gives them the mix text ([1b8d24a](https://github.com/tkjaergaard/bilkatogo-mcp/commit/1b8d24ab50d9ea6fc1c8a21fff11ff816877d048))
* list_categories answers an empty list when filters leave a parent empty ([d9dbb78](https://github.com/tkjaergaard/bilkatogo-mcp/commit/d9dbb788d931c3e0a51d452b21b260e50e19b075))
