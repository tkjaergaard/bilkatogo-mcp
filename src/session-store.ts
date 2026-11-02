// The session store: remembers the login token that last worked, so a restart
// doesn't need a fresh password login. By default a JSON file in the user
// config directory, readable only by its owner.

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { configDir, type Env } from "./credentials.ts";
import { readPrivateJson, writePrivateJson } from "./private-file.ts";
import { errorCode } from "./values.ts";

export type SessionStore = {
  /** The remembered login token, or undefined when there is none. */
  load(): Promise<string | undefined>;
  /** Remembers a login token that worked. */
  save(loginToken: string): Promise<void>;
  /** Forgets the remembered login token, e.g. once Gigya has rejected it. */
  clear(): Promise<void>;
};

/** `$XDG_CONFIG_HOME/bilkatogo-mcp/session.json`, by default `~/.config/bilkatogo-mcp/session.json`. */
export function defaultSessionFile(env: Env): string {
  return join(configDir(env), "session.json");
}

/**
 * A session store in one JSON file (`{"loginToken": "…"}`). Writes are atomic
 * (a temp file renamed into place) and the file is created with mode 600.
 * Errors name the file and the error code, never the token.
 */
export function fileSessionStore(file: string): SessionStore {
  return {
    async load() {
      const parsed = await readPrivateJson(file);
      const token = (parsed as { loginToken?: unknown } | null | undefined)?.loginToken;
      return typeof token === "string" && token.trim() ? token.trim() : undefined;
    },

    async save(loginToken) {
      await writePrivateJson(file, { loginToken });
    },

    async clear() {
      try {
        await rm(file, { force: true });
      } catch (error) {
        throw new Error(`could not remove ${file} (${errorCode(error) ?? "unknown error"})`);
      }
    },
  };
}
