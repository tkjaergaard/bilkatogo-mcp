import { expect, test } from "vitest";
import { JWT, LOGIN_TOKEN } from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";
import { loginFile } from "./support/login-file.ts";

test("get_cart uses the login token from the private login file when the environment has none", async () => {
  const file = await loginFile({ loginToken: LOGIN_TOKEN });
  const { callTool, bilka, warnings } = await connect({
    credentials: { env: {}, loginFile: file },
  });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(bilka.calls("gigya.getJWT")[0]?.form().get("login_token")).toBe(LOGIN_TOKEN);
  expect(warnings).toEqual([]);
});

test("a login token in the environment wins over the login file", async () => {
  const file = await loginFile({ loginToken: "stale-token-from-file" });
  const { callTool, bilka } = await connect({
    credentials: { env: { BILKATOGO_LOGIN_TOKEN: LOGIN_TOKEN }, loginFile: file },
  });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(bilka.calls("gigya.getJWT").map((r) => r.form().get("login_token"))).toEqual([
    LOGIN_TOKEN,
  ]);
});

test("a login file others can read still works, with a warning that names no secret", async () => {
  const file = await loginFile({ loginToken: LOGIN_TOKEN }, 0o644);
  const { callTool, warnings } = await connect({ credentials: { env: {}, loginFile: file } });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(warnings.join("\n")).toContain("chmod 600");
  expect(warnings.join("\n")).not.toContain(LOGIN_TOKEN);
});

test("without any login, get_cart says how to configure one and sends nothing", async () => {
  const { callTool, bilka } = await connect({ credentials: { env: {} } });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/no bilkatogo login is configured/i);
  expect(result.text).toContain("BILKATOGO_LOGIN_TOKEN");
  expect(result.text).toContain("login.json");
  expect(bilka.requests).toEqual([]);
});

test("a rejected login token gives a clear error without the token in it", async () => {
  const { callTool, bilka } = await connect({
    credentials: { env: { BILKATOGO_LOGIN_TOKEN: LOGIN_TOKEN } },
  });
  // Gigya's error text echoes the token, to prove the server never passes it on.
  bilka.script("gigya.getJWT", () =>
    Response.json(
      {
        errorCode: 403005,
        errorMessage: `Unauthorized user ${LOGIN_TOKEN}`,
        statusCode: 403,
      },
      { status: 403 },
    ),
  );

  const result = await callTool("get_cart");

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/login failed/i);
  expect(result.text).toContain("403005");
  expect(result.text).toContain("BILKATOGO_LOGIN_TOKEN");
  expect(result.text).not.toContain(LOGIN_TOKEN);
  expect(bilka.calls("shop.*")).toEqual([]);
});

test("a failed login isn't cached: the next call tries again", async () => {
  const { callTool, bilka } = await connect({
    credentials: { env: { BILKATOGO_LOGIN_TOKEN: LOGIN_TOKEN } },
  });
  bilka.rejectLoginToken(1);

  expect((await callTool("get_cart")).isError).toBe(true);
  expect((await callTool("get_cart")).isError).toBe(false);
  expect(bilka.calls("gigya.getJWT")).toHaveLength(2);
});

test("a shop answer of 'not logged in' becomes a clear error without secrets", async () => {
  const { callTool, bilka } = await connect({
    credentials: { env: { BILKATOGO_LOGIN_TOKEN: LOGIN_TOKEN } },
  });
  bilka.rejectJwt();

  const result = await callTool("get_cart");

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/isn't logged in/i);
  expect(result.text).not.toContain(LOGIN_TOKEN);
  expect(result.text).not.toContain(JWT);
});
