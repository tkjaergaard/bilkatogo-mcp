// Where the BilkaToGo login comes from: environment variables first, then the
// private login file in the user config directory. Read lazily, only when a
// tool needs the account.

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Credentials = {
  email?: string;
  password?: string;
  /** A Gigya login token pasted from the browser (`localStorage.getItem("auth")`). */
  loginToken?: string;
};

/** Where to look for credentials. Nothing is read until a tool needs the account. */
export type CredentialSources = {
  /** Usually `process.env`: `BILKATOGO_EMAIL`, `BILKATOGO_PASSWORD`, `BILKATOGO_LOGIN_TOKEN`. */
  env: Record<string, string | undefined>;
  /** A JSON file with `email`, `password` and/or `loginToken`. Should be mode 600. */
  loginFile?: string | undefined;
};

/** This server's config directory: `$XDG_CONFIG_HOME/bilka-mcp`, by default `~/.config/bilka-mcp`. */
export function configDir(env: Record<string, string | undefined>): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "bilka-mcp");
}

/** `$XDG_CONFIG_HOME/bilka-mcp/login.json`, by default `~/.config/bilka-mcp/login.json`. */
export function defaultLoginFile(env: Record<string, string | undefined>): string {
  return join(configDir(env), "login.json");
}

/**
 * Reads credentials from the environment, then from the login file for anything
 * still missing. A missing file is fine; an unreadable or world-readable one
 * gets a warning that names the file but never its contents.
 */
export async function readCredentials(
  env: Record<string, string | undefined>,
  loginFile: string | undefined,
  warn: (line: string) => void,
): Promise<Credentials> {
  const fromEnv: Credentials = {
    email: env.BILKATOGO_EMAIL?.trim() || undefined,
    password: env.BILKATOGO_PASSWORD || undefined,
    loginToken: env.BILKATOGO_LOGIN_TOKEN?.trim() || undefined,
  };
  let file: Record<string, unknown> = {};
  if (loginFile !== undefined) {
    try {
      const info = await stat(loginFile);
      if ((info.mode & 0o077) !== 0) {
        warn(`warning: ${loginFile} is readable by others; run chmod 600 on it`);
      }
      const parsed: unknown = JSON.parse(await readFile(loginFile, "utf8"));
      if (isRecord(parsed)) file = parsed;
    } catch (error) {
      if (!(isRecord(error) && error.code === "ENOENT")) {
        warn(
          `warning: could not read ${loginFile} (${errorName(error)}); using the environment only`,
        );
      }
    }
  }
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  return {
    email: fromEnv.email ?? text(file.email),
    password: fromEnv.password ?? (typeof file.password === "string" ? file.password : undefined),
    loginToken: fromEnv.loginToken ?? text(file.loginToken) ?? text(file.login_token),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The error's kind only: a JSON parse error's message can quote the file.
function errorName(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : "unknown error";
}
