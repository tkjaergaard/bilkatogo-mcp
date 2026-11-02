// The setup commands. With no arguments the binary serves MCP on stdio
// (main.ts); with arguments it runs one of these and exits. They only manage
// the saved login: shopping stays in the MCP tools.
//
// `login` checks the login with Gigya and saves only the login token, to the
// same session file the server reads first, so the password is never stored.

import packageJson from "../package.json" with { type: "json" };
import { describeRejection } from "./auth.ts";
import { exchangeLoginToken, passwordLogin } from "./bilka.ts";
import { defaultLoginFile, type Env, readCredentials } from "./credentials.ts";
import { defaultSessionFile, fileSessionStore } from "./session-store.ts";

/** Asks the person at the terminal. `secret` doesn't echo what they type. */
export type Prompt = {
  text(question: string): Promise<string>;
  secret(question: string): Promise<string>;
};

export type CliIo = {
  fetch: typeof fetch;
  env: Env;
  prompt: Prompt;
  /** A line of normal output (stdout). */
  out(line: string): void;
  /** A line of error output (stderr). */
  err(line: string): void;
};

const NAME = "bilkatogo-mcp";

const USAGE = `Usage:
  ${NAME}                  Serve MCP on stdio. This is what your MCP client runs.
  ${NAME} login            Log in with your email and password. Only the login token is saved.
  ${NAME} login --token    Log in with a login token pasted from the browser.
  ${NAME} status           Check whether the saved login still works.
  ${NAME} logout           Forget the saved login.
  ${NAME} --version        Print the version.`;

/** Runs one command and returns the process exit code: 0 done, 1 failed, 2 bad usage. */
export async function runCli(args: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === "login" && rest.length === 0) return await login(io);
    if (command === "login" && rest.length === 1 && rest[0] === "--token") {
      return await loginWithToken(io);
    }
    if (command === "status" && rest.length === 0) return await status(io);
    if (command === "logout" && rest.length === 0) return await logout(io);
    if ((command === "--version" || command === "-v") && rest.length === 0) {
      io.out(packageJson.version);
      return 0;
    }
    if ((command === "--help" || command === "-h" || command === "help") && rest.length === 0) {
      io.out(USAGE);
      return 0;
    }
  } catch (error) {
    // BilkaErrors (Gigya unreachable, a timeout) and file errors never hold a secret.
    io.err(`${NAME}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  io.err(`${NAME}: unknown command: ${args.join(" ")}\n\n${USAGE}`);
  return 2;
}

async function login(io: CliIo): Promise<number> {
  const email = (await io.prompt.text("Email: ")).trim();
  const password = await io.prompt.secret("Password: ");
  if (!email || !password) {
    io.err(`${NAME}: an email and a password are needed`);
    return 1;
  }
  const answer = await passwordLogin(io.fetch, email, password);
  if ("rejected" in answer) {
    io.err(
      `${NAME}: Gigya rejected the login (${describeRejection(answer.rejected)}). ` +
        "Check the email and password.",
    );
    return 1;
  }
  return saveIfWorks(io, answer.loginToken);
}

async function loginWithToken(io: CliIo): Promise<number> {
  io.out(
    'On bilkatogo.dk, log in, open the developer console and run localStorage.getItem("auth").',
  );
  // The console shows the token in quotes; people copy them along.
  const token = (await io.prompt.secret("Login token: ")).trim().replace(/^"(.*)"$/, "$1");
  if (!token) {
    io.err(`${NAME}: a login token is needed`);
    return 1;
  }
  return saveIfWorks(io, token);
}

/** Saves the login token once Gigya has swapped it for a session, so only a working login is kept. */
async function saveIfWorks(io: CliIo, loginToken: string): Promise<number> {
  const exchange = await exchangeLoginToken(io.fetch, loginToken);
  if ("rejected" in exchange) {
    io.err(
      `${NAME}: Gigya rejected the login token (${describeRejection(exchange.rejected)}). ` +
        "Nothing was saved.",
    );
    return 1;
  }
  const file = defaultSessionFile(io.env);
  await fileSessionStore(file).save(loginToken);
  io.out(`Logged in. The login token is saved in ${file}, readable only by you.`);
  io.out("Your password isn't stored. Restart your MCP client if the server is already running.");
  return 0;
}

async function status(io: CliIo): Promise<number> {
  const file = defaultSessionFile(io.env);
  const loginToken = await fileSessionStore(file).load();
  if (loginToken === undefined) {
    io.out(`Not logged in: there's no saved login in ${file}.`);
    await noteOtherSources(io);
    io.out(`Run \`${NAME} login\` to log in.`);
    return 1;
  }
  const exchange = await exchangeLoginToken(io.fetch, loginToken);
  if ("rejected" in exchange) {
    io.out(
      `The saved login no longer works: Gigya rejected it (${describeRejection(exchange.rejected)}).`,
    );
    io.out(`Run \`${NAME} login\` to log in again.`);
    return 1;
  }
  io.out(`Logged in: the saved login in ${file} works.`);
  return 0;
}

async function logout(io: CliIo): Promise<number> {
  const file = defaultSessionFile(io.env);
  await fileSessionStore(file).clear();
  io.out(`Logged out: removed the saved login (${file}).`);
  await noteOtherSources(io);
  return 0;
}

/** Points out credentials the server would still log in with, from the environment or login.json. */
async function noteOtherSources(io: CliIo): Promise<void> {
  const loginFile = defaultLoginFile(io.env);
  const { email, password, loginToken } = await readCredentials(io.env, loginFile, (line) =>
    io.err(`${NAME}: ${line}`),
  );
  if (loginToken || (email && password)) {
    io.out(
      `The server can still log in with the credentials in BILKATOGO_* environment variables or ${loginFile}.`,
    );
  }
}
