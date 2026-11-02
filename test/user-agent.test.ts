import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { EMAIL, PASSWORD } from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("every request to Algolia, Gigya and the shop names the project and its version", async () => {
  const { callTool, bilka } = await connect({
    credentials: { env: { BILKATOGO_EMAIL: EMAIL, BILKATOGO_PASSWORD: PASSWORD } },
  });

  await callTool("search_products", { query: "skyr" });
  await callTool("get_cart");

  expect(bilka.requests.map((request) => request.route)).toEqual([
    "algolia.query",
    "gigya.login",
    "gigya.getJWT",
    "shop.Cart",
  ]);
  for (const request of bilka.requests) {
    expect(request.headers.get("user-agent")).toBe(
      `bilka-mcp/${version} (+https://github.com/tkjaergaard/bilka-mcp)`,
    );
  }
});
