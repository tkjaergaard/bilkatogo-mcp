// The session store: remembers the login token that last worked, so a restart
// doesn't need a fresh password login. By default a JSON file in the user
// config directory, readable only by its owner.

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { configDir } from "./credentials.ts";

export type SessionStore = {
  /** The remembered login token, or undefined when there is none. */
  load(): Promise<string | undefined>;
  /** Remembers a login token that worked. */
  save(loginToken: string): Promise<void>;
};

/** `$XDG_CONFIG_HOME/bilka-mcp/session.json`, by default `~/.config/bilka-mcp/session.json`. */
export function defaultSessionFile(env: Record<string, string | undefined>): string {
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
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        // No file yet (or no directory where it would be): nothing remembered.
        if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return undefined;
        throw new Error(`could not read ${file} (${errorCode(error) ?? "unknown error"})`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`could not read ${file} (not JSON)`);
      }
      const token = (parsed as { loginToken?: unknown } | null)?.loginToken;
      return typeof token === "string" && token.trim() ? token.trim() : undefined;
    },

    async save(loginToken) {
      const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const handle = await open(temp, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ loginToken })}\n`);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw new Error(`could not write ${file} (${errorCode(error) ?? "unknown error"})`);
      }
    },
  };
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
