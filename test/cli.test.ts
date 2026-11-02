// The setup commands (login, status, logout), run against the fake Bilka with
// a temp config directory. The server reads the login they save.

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { runCli } from "../src/cli.ts";
import { fileSessionStore } from "../src/session-store.ts";
import { EMAIL, FakeBilka, LOGIN_TOKEN, PASSWORD } from "./support/fake-bilka.ts";
import { connect } from "./support/harness.ts";

/** Runs a command with scripted answers to its prompts, in a fresh config directory. */
async function run(args: string[], answers: string[] = [], options: { configHome?: string } = {}) {
  const configHome = options.configHome ?? (await mkdtemp(join(tmpdir(), "bilka-mcp-cli-")));
  onTestFinished(() => rm(configHome, { recursive: true, force: true }));
  const bilka = new FakeBilka();
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const answer = async (question: string) => {
    asked.push(question);
    return answers.shift() ?? "";
  };
  const io = {
    fetch: bilka.fetch,
    env: { XDG_CONFIG_HOME: configHome },
    prompt: { text: answer, secret: answer },
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
  };
  return {
    bilka,
    io,
    asked,
    sessionFile: join(configHome, "bilkatogo-mcp", "session.json"),
    /** Runs the command; call after scripting `bilka`. */
    exec: async () => {
      const code = await runCli(args, io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    },
  };
}

test("login asks for email and password, checks them with Gigya and saves only the login token", async () => {
  const { bilka, asked, sessionFile, exec } = await run(["login"], [EMAIL, PASSWORD]);

  const { code, out, err } = await exec();

  expect(code).toBe(0);
  expect(asked).toEqual(["Email: ", "Password: "]);
  expect(bilka.requests.map((request) => request.route)).toEqual(["gigya.login", "gigya.getJWT"]);
  const saved = await readFile(sessionFile, "utf8");
  expect(JSON.parse(saved)).toEqual({ loginToken: LOGIN_TOKEN });
  expect(saved).not.toContain(PASSWORD);
  expect((await stat(sessionFile)).mode & 0o777).toBe(0o600);
  expect(out).toContain("Logged in");
  expect(`${out}\n${err}`).not.toContain(PASSWORD);
  expect(`${out}\n${err}`).not.toContain(LOGIN_TOKEN);
});

test("the server uses the login that login saved, with no credentials configured", async () => {
  const { sessionFile, exec } = await run(["login"], [EMAIL, PASSWORD]);
  expect((await exec()).code).toBe(0);

  const { callTool, bilka } = await connect({ sessionStore: fileSessionStore(sessionFile) });
  const result = await callTool("get_cart");

  expect(result.isError).toBe(false);
  expect(bilka.calls("gigya.login")).toEqual([]);
  expect(bilka.calls("gigya.getJWT")[0]?.form().get("login_token")).toBe(LOGIN_TOKEN);
});

test("a rejected password saves nothing and the error holds no secret", async () => {
  const { bilka, sessionFile, exec } = await run(["login"], [EMAIL, PASSWORD]);
  bilka.rejectPasswordLogin();

  const { code, out, err } = await exec();

  expect(code).toBe(1);
  expect(err).toContain("403042");
  expect(`${out}\n${err}`).not.toContain(PASSWORD);
  await expect(stat(sessionFile)).rejects.toThrow();
});

test("login without an email or password sends nothing to Bilka", async () => {
  const { bilka, exec } = await run(["login"], [EMAIL, ""]);

  const { code } = await exec();

  expect(code).toBe(1);
  expect(bilka.requests).toEqual([]);
});

test("login --token takes a pasted token, quotes and all, and saves it once Gigya accepts it", async () => {
  const { bilka, asked, sessionFile, exec } = await run(
    ["login", "--token"],
    [` "${LOGIN_TOKEN}" `],
  );

  const { code } = await exec();

  expect(code).toBe(0);
  expect(asked).toEqual(["Login token: "]);
  expect(bilka.calls("gigya.login")).toEqual([]);
  expect(bilka.calls("gigya.getJWT")[0]?.form().get("login_token")).toBe(LOGIN_TOKEN);
  expect(JSON.parse(await readFile(sessionFile, "utf8"))).toEqual({ loginToken: LOGIN_TOKEN });
});

test("login --token with a token Gigya rejects saves nothing", async () => {
  const { bilka, sessionFile, exec } = await run(["login", "--token"], ["stale-token"]);
  bilka.rejectLoginToken();

  const { code, err } = await exec();

  expect(code).toBe(1);
  expect(err).toContain("403005");
  expect(err).not.toContain("stale-token");
  await expect(stat(sessionFile)).rejects.toThrow();
});

test("status reports a saved login that works", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "bilka-mcp-cli-"));
  await fileSessionStore(join(configHome, "bilkatogo-mcp", "session.json")).save(LOGIN_TOKEN);
  const { bilka, exec } = await run(["status"], [], { configHome });

  const { code, out } = await exec();

  expect(code).toBe(0);
  expect(out).toMatch(/Logged in/);
  expect(bilka.calls("gigya.getJWT")).toHaveLength(1);
});

test("status reports a saved login that Gigya now rejects", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "bilka-mcp-cli-"));
  await fileSessionStore(join(configHome, "bilkatogo-mcp", "session.json")).save(LOGIN_TOKEN);
  const { bilka, exec } = await run(["status"], [], { configHome });
  bilka.rejectLoginToken();

  const { code, out } = await exec();

  expect(code).toBe(1);
  expect(out).toMatch(/no longer works/);
  expect(out).toContain("bilkatogo-mcp login");
});

test("status without a saved login sends nothing to Bilka and says how to log in", async () => {
  const { bilka, exec } = await run(["status"]);

  const { code, out } = await exec();

  expect(code).toBe(1);
  expect(out).toMatch(/Not logged in/);
  expect(bilka.requests).toEqual([]);
});

test("logout removes the saved login, and mentions a login.json the server would still use", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "bilka-mcp-cli-"));
  const sessionFile = join(configHome, "bilkatogo-mcp", "session.json");
  await fileSessionStore(sessionFile).save(LOGIN_TOKEN);
  await writeFile(
    join(configHome, "bilkatogo-mcp", "login.json"),
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { mode: 0o600 },
  );
  const { bilka, exec } = await run(["logout"], [], { configHome });

  const { code, out } = await exec();

  expect(code).toBe(0);
  await expect(stat(sessionFile)).rejects.toThrow();
  expect(out).toContain("login.json");
  expect(bilka.requests).toEqual([]);
});

test("--version prints the package version", async () => {
  const { exec } = await run(["--version"]);

  expect(await exec()).toEqual({ code: 0, out: packageJson.version, err: "" });
});

test("an unknown command fails with the usage", async () => {
  const { exec } = await run(["shop"]);

  const { code, err } = await exec();

  expect(code).toBe(2);
  expect(err).toContain("unknown command: shop");
  expect(err).toContain("Usage:");
});

test("the binary runs a command and exits instead of serving MCP", () => {
  const result = spawnSync(process.execPath, ["src/main.ts", "--version"], {
    cwd: new URL("..", import.meta.url),
    input: "",
    encoding: "utf8",
    timeout: 10_000,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`${packageJson.version}\n`);
});
