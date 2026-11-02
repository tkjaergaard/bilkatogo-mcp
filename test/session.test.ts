// The login chain: password login, the remembered login token, refresh before
// expiry and "refresh once, retry once" after the shop rejects the session.

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { fileSessionStore } from "../src/session-store.ts";
import {
  EMAIL,
  GIGYA_API_KEY,
  JWT,
  jsonResponse,
  LOGIN_TOKEN,
  PASSWORD,
} from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";

const withPassword = {
  credentials: { env: { BILKATOGO_EMAIL: EMAIL, BILKATOGO_PASSWORD: PASSWORD } },
};

/** A session store kept in memory: `saved` lists every login token written to it. */
function memoryStore(remembered?: string) {
  const saved: string[] = [];
  return {
    saved,
    async load() {
      return remembered;
    },
    async save(loginToken: string) {
      saved.push(loginToken);
      remembered = loginToken;
    },
    async clear() {
      remembered = undefined;
    },
  };
}

test("with an email and password, get_cart logs in with Gigya and uses the login token it gets", async () => {
  const { callTool, bilka } = await connect(withPassword);

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(bilka.requests.map((request) => request.route)).toEqual([
    "gigya.login",
    "gigya.getJWT",
    "shop.Cart",
  ]);
  const [login, exchange, cart] = bilka.requests;
  expect(login?.method).toBe("POST");
  expect(Object.fromEntries(login?.form() ?? [])).toEqual({
    loginID: EMAIL,
    password: PASSWORD,
    apiKey: GIGYA_API_KEY,
    httpStatusCodes: "true",
  });
  expect(exchange?.form().get("login_token")).toBe(LOGIN_TOKEN);
  expect(cart?.headers.get("jwt_token")).toBe(JWT);
});

test("a rejected password login gives an error that names the source and holds no secret", async () => {
  const { callTool, bilka } = await connect(withPassword);
  bilka.rejectPasswordLogin();

  const result = await callTool("get_cart");

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/login failed/i);
  expect(result.text).toContain("BILKATOGO_EMAIL");
  expect(result.text).toContain("403042");
  expect(result.text).not.toContain(EMAIL);
  expect(result.text).not.toContain(PASSWORD);
  expect(bilka.calls("gigya.getJWT")).toEqual([]);
  expect(bilka.calls("shop.*")).toEqual([]);
});

test("login sources are tried in order: remembered token, pasted token, then password", async () => {
  const { callTool, bilka } = await connect({
    sessionStore: memoryStore("stale-remembered-token"),
    credentials: {
      env: {
        BILKATOGO_LOGIN_TOKEN: "stale-pasted-token",
        BILKATOGO_EMAIL: EMAIL,
        BILKATOGO_PASSWORD: PASSWORD,
      },
    },
  });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(bilka.requests.map((request) => request.route)).toEqual([
    "gigya.getJWT",
    "gigya.getJWT",
    "gigya.login",
    "gigya.getJWT",
    "shop.Cart",
  ]);
  expect(bilka.calls("gigya.getJWT").map((r) => r.form().get("login_token"))).toEqual([
    "stale-remembered-token",
    "stale-pasted-token",
    LOGIN_TOKEN,
  ]);
});

test("a working remembered token is used first, and no other source is tried", async () => {
  const { callTool, bilka } = await connect({
    sessionStore: memoryStore(LOGIN_TOKEN),
    credentials: { env: { BILKATOGO_LOGIN_TOKEN: "other-token", BILKATOGO_EMAIL: EMAIL } },
  });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(bilka.requests.map((request) => request.route)).toEqual(["gigya.getJWT", "shop.Cart"]);
  expect(bilka.calls("gigya.getJWT")[0]?.form().get("login_token")).toBe(LOGIN_TOKEN);
});

test("a source is tried at most once: a pasted token equal to the rejected remembered one is skipped", async () => {
  const { callTool, bilka } = await connect({
    sessionStore: memoryStore("stale-token"),
    credentials: { env: { BILKATOGO_LOGIN_TOKEN: "stale-token" } },
  });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(true);
  expect(bilka.calls("gigya.getJWT")).toHaveLength(1);
});

test("an outage at Gigya keeps the remembered token, which works once Gigya is back", async () => {
  const store = memoryStore(LOGIN_TOKEN);
  const { callTool, bilka } = await connect({ sessionStore: store });
  bilka.failTimes("gigya.getJWT", 1, 503);

  const failed = await callTool("get_cart");
  const retried = await callTool("get_cart");

  expect(failed.isError).toBe(true);
  expect(failed.text).toContain("HTTP 503");
  expect(retried.isError).toBe(false);
  expect(bilka.calls("gigya.getJWT").map((r) => r.form().get("login_token"))).toEqual([
    LOGIN_TOKEN,
    LOGIN_TOKEN,
  ]);
});

test("when every source fails, the error names each one and holds no secret", async () => {
  const { callTool, bilka } = await connect({
    sessionStore: memoryStore("stale-remembered-token"),
    credentials: {
      env: {
        BILKATOGO_LOGIN_TOKEN: "stale-pasted-token",
        BILKATOGO_EMAIL: EMAIL,
        BILKATOGO_PASSWORD: PASSWORD,
      },
    },
  });
  bilka.rejectPasswordLogin();

  const result = await callTool("get_cart");

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/remembered login token/i);
  expect(result.text).toContain("BILKATOGO_LOGIN_TOKEN");
  expect(result.text).toContain("BILKATOGO_EMAIL");
  for (const secret of ["stale-remembered-token", "stale-pasted-token", EMAIL, PASSWORD]) {
    expect(result.text).not.toContain(secret);
  }
  expect(bilka.calls("shop.*")).toEqual([]);
});

test("a login token that works is saved to the session store, once", async () => {
  const store = memoryStore();
  const { callTool } = await connect({ ...withPassword, sessionStore: store });

  expect((await callTool("get_cart")).isError).toBe(false);
  expect((await callTool("get_cart")).isError).toBe(false);

  expect(store.saved).toEqual([LOGIN_TOKEN]);
});

test("after a restart, the remembered token logs in without the password", async () => {
  const store = memoryStore();
  const first = await connect({ ...withPassword, sessionStore: store });
  expect((await first.callTool("get_cart")).isError).toBe(false);

  const second = await connect({ ...withPassword, sessionStore: store });
  expect((await second.callTool("get_cart")).isError).toBe(false);

  expect(second.bilka.requests.map((request) => request.route)).toEqual([
    "gigya.getJWT",
    "shop.Cart",
  ]);
});

/** A fresh temp directory, removed after the test. */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bilka-mcp-session-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("the session file holds the working token, readable only by its owner, written atomically", async () => {
  const dir = await tempDir();
  const file = join(dir, "bilka-mcp", "session.json");
  const { callTool } = await connect({ ...withPassword, sessionStore: fileSessionStore(file) });

  expect((await callTool("get_cart")).isError).toBe(false);

  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ loginToken: LOGIN_TOKEN });
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  // Nothing left over from the temp-file-and-rename write.
  expect(await readdir(join(dir, "bilka-mcp"))).toEqual(["session.json"]);

  // A restart reads it back: no password login needed.
  const restarted = await connect({
    credentials: { env: {} },
    sessionStore: fileSessionStore(file),
  });
  expect((await restarted.callTool("get_cart")).isError).toBe(false);
  expect(restarted.bilka.calls("gigya.getJWT")[0]?.form().get("login_token")).toBe(LOGIN_TOKEN);
});

test("a remembered token Gigya rejects is cleared from the session file, so a restart doesn't try it first", async () => {
  const dir = await tempDir();
  const file = join(dir, "session.json");
  await writeFile(file, JSON.stringify({ loginToken: "stale-token" }), { mode: 0o600 });
  const first = await connect({ credentials: { env: {} }, sessionStore: fileSessionStore(file) });
  expect((await first.callTool("get_cart")).isError).toBe(true);

  const restarted = await connect({
    credentials: { env: { BILKATOGO_LOGIN_TOKEN: LOGIN_TOKEN } },
    sessionStore: fileSessionStore(file),
  });
  expect((await restarted.callTool("get_cart")).isError).toBe(false);

  expect(restarted.bilka.calls("gigya.getJWT").map((r) => r.form().get("login_token"))).toEqual([
    LOGIN_TOKEN,
  ]);
});

test("when the session file can't be written, the server warns and carries on", async () => {
  const dir = await tempDir();
  // A regular file where the directory should be: the write fails with ENOTDIR.
  await writeFile(join(dir, "blocked"), "");
  const file = join(dir, "blocked", "session.json");
  const { callTool, warnings } = await connect({
    ...withPassword,
    sessionStore: fileSessionStore(file),
  });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain(file);
  expect(warnings[0]).not.toContain(LOGIN_TOKEN);
});

test("an unreadable session file is warned about and the other sources still log in", async () => {
  const dir = await tempDir();
  const file = join(dir, "session.json");
  await writeFile(file, "not json");
  const { callTool, warnings, bilka } = await connect({
    ...withPassword,
    sessionStore: fileSessionStore(file),
  });

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(warnings.join("\n")).toContain(file);
  expect(bilka.calls("gigya.login")).toHaveLength(1);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ loginToken: LOGIN_TOKEN });
});

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

test("the JWT is reused until a few minutes before its 24 hours run out, then refreshed", async () => {
  let now = Date.UTC(2026, 10, 2, 12);
  const { callTool, bilka } = await connect({ ...withPassword, now: () => now });

  expect((await callTool("get_cart")).isError).toBe(false);
  now += 23 * HOUR + 50 * MINUTE;
  expect((await callTool("get_cart")).isError).toBe(false);
  expect(bilka.calls("gigya.getJWT")).toHaveLength(1);

  now += 8 * MINUTE; // 2 minutes before expiry
  expect((await callTool("get_cart")).isError).toBe(false);

  expect(bilka.calls("gigya.getJWT")).toHaveLength(2);
  // The refresh swaps the remembered login token again; no new password login.
  expect(bilka.calls("gigya.login")).toHaveLength(1);
  expect(bilka.calls("gigya.getJWT")[1]?.form().get("login_token")).toBe(LOGIN_TOKEN);
  expect(bilka.calls("shop.Cart").map((r) => r.headers.get("jwt_token"))).toEqual([JWT, JWT, JWT]);
});

test("when the shop says 'not logged in', the session refreshes and the call is retried once", async () => {
  const { callTool, bilka } = await connect(withPassword);
  expect((await callTool("get_cart")).isError).toBe(false);
  bilka.rejectJwt(1);

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(bilka.calls("shop.Cart")).toHaveLength(3);
  // A fresh JWT from the remembered login token; the password isn't needed again.
  expect(bilka.calls("gigya.getJWT")).toHaveLength(2);
  expect(bilka.calls("gigya.login")).toHaveLength(1);
});

test("a shop call still rejected after the refresh fails without a second retry", async () => {
  const { callTool, bilka } = await connect(withPassword);
  bilka.rejectJwt();

  const result = await callTool("get_cart");

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/isn't logged in/i);
  expect(bilka.calls("shop.Cart")).toHaveLength(2);
  expect(bilka.calls("gigya.getJWT")).toHaveLength(2);
  for (const secret of [LOGIN_TOKEN, JWT, EMAIL, PASSWORD]) {
    expect(result.text).not.toContain(secret);
  }
});

test.each([401, 403])(
  "an HTTP %i from the shop counts as 'not logged in': refresh once, retry once",
  async (status) => {
    const { callTool, bilka } = await connect(withPassword);
    bilka.failTimes("shop.Cart", 1, status);

    const result = await callTool("get_cart");

    expect(result.isError).toBe(false);
    expect(bilka.calls("shop.Cart")).toHaveLength(2);
    expect(bilka.calls("gigya.getJWT")).toHaveLength(2);
  },
);

test("the logged-out shape with uid -1 also triggers the refresh", async () => {
  const { callTool, bilka } = await connect(withPassword);
  bilka.script("shop.Cart", () => jsonResponse({ code: 7, msg: "Session udløbet", uid: -1 }));

  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(bilka.calls("gigya.getJWT")).toHaveLength(2);
});

test("another shop error with the account's own uid is an error, not a reason to log in again", async () => {
  const { callTool, bilka } = await connect(withPassword);
  bilka.script("shop.Cart", () => jsonResponse({ code: 2, msg: "Noget gik galt", uid: 1000001 }));

  const result = await callTool("get_cart");

  expect(result.isError).toBe(true);
  expect(result.text).not.toMatch(/logged in/i);
  expect(result.text).toContain("code 2");
  expect(bilka.calls("shop.Cart")).toHaveLength(1);
  expect(bilka.calls("gigya.getJWT")).toHaveLength(1);
});
