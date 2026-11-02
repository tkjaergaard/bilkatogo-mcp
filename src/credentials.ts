// Where the BilkaToGo login and the store id come from: environment variables
// first, then the private login file in the user config directory. Read
// lazily, only when a tool needs the account or the store.

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { errorCode, isRecord, text } from "./values.ts";

export type Credentials = {
  email?: string;
  password?: string;
  /** A Gigya login token pasted from the browser (`localStorage.getItem("auth")`). */
  loginToken?: string;
};

/** Environment variables, e.g. `process.env`. */
export type Env = Record<string, string | undefined>;

/**
 * Where to look for credentials and the store id. Nothing is read until a
 * tool needs the account or the store.
 */
export type CredentialSources = {
  /**
   * Usually `process.env`: `BILKATOGO_EMAIL`, `BILKATOGO_PASSWORD`,
   * `BILKATOGO_LOGIN_TOKEN`, `BILKATOGO_STORE_ID`.
   */
  env: Env;
  /**
   * A JSON file with `email`, `password` and/or `loginToken`, and optionally
   * `storeId`. Should be mode 600.
   */
  loginFile?: string | undefined;
};

/** This server's config directory: `$XDG_CONFIG_HOME/bilkatogo-mcp`, by default `~/.config/bilkatogo-mcp`. */
export function configDir(env: Env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "bilkatogo-mcp");
}

/** `$XDG_CONFIG_HOME/bilkatogo-mcp/login.json`, by default `~/.config/bilkatogo-mcp/login.json`. */
export function defaultLoginFile(env: Env): string {
  return join(configDir(env), "login.json");
}

/**
 * Reads credentials from the environment, then from the login file for anything
 * still missing. A missing file is fine; an unreadable or world-readable one
 * gets a warning that names the file but never its contents.
 */
export async function readCredentials(
  env: Env,
  loginFile: string | undefined,
  warn: (line: string) => void,
): Promise<Credentials> {
  const fromEnv: Credentials = {
    email: env.BILKATOGO_EMAIL?.trim() || undefined,
    password: env.BILKATOGO_PASSWORD || undefined,
    loginToken: env.BILKATOGO_LOGIN_TOKEN?.trim() || undefined,
  };
  const file = await readLoginFile(loginFile, warn);
  return {
    email: fromEnv.email ?? text(file.email) ?? undefined,
    password: fromEnv.password ?? (typeof file.password === "string" ? file.password : undefined),
    loginToken: fromEnv.loginToken ?? text(file.loginToken) ?? text(file.login_token) ?? undefined,
  };
}

/**
 * The Bilka store to shop at: `BILKATOGO_STORE_ID`, else `storeId` in the
 * login file. Undefined when neither is set. Not validated here.
 */
export async function readStoreId(
  sources: CredentialSources,
  warn: (line: string) => void,
): Promise<string | undefined> {
  const fromEnv = sources.env.BILKATOGO_STORE_ID?.trim();
  if (fromEnv) return fromEnv;
  const { storeId } = await readLoginFile(sources.loginFile, warn);
  return typeof storeId === "number" ? String(storeId) : (text(storeId) ?? undefined);
}

/** The login file's fields, or none when there is no usable file. */
async function readLoginFile(
  loginFile: string | undefined,
  warn: (line: string) => void,
): Promise<Record<string, unknown>> {
  if (loginFile === undefined) return {};
  try {
    const info = await stat(loginFile);
    if ((info.mode & 0o077) !== 0) {
      warn(`warning: ${loginFile} is readable by others; run chmod 600 on it`);
    }
    const parsed: unknown = JSON.parse(await readFile(loginFile, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      warn(
        `warning: could not read ${loginFile} (${errorName(error)}); using the environment only`,
      );
    }
    return {};
  }
}

// The error's kind only: a JSON parse error's message can quote the file.
function errorName(error: unknown): string {
  return errorCode(error) ?? (error instanceof Error ? error.name : "unknown error");
}
