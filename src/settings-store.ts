// The settings store: this server's own local settings, chosen through tools
// rather than configured by hand. Today that's only the store `select_store`
// picked. By default a JSON file in the user config directory, readable only
// by its owner. Nothing here is ever sent to Bilka.

import { join } from "node:path";
import { configDir, type Env } from "./credentials.ts";
import { readPrivateJson, writePrivateJson } from "./private-file.ts";
import { isRecord, text } from "./values.ts";

export type Settings = {
  /** The Bilka store chosen with `select_store`, e.g. "1654". Not validated here. */
  storeId?: string;
};

export type SettingsStore = {
  /** Where the settings live, as told to the model, e.g. the file's path. */
  location: string;
  /** The saved settings; empty when nothing is saved yet. */
  load(): Promise<Settings>;
  /** Replaces the saved settings. */
  save(settings: Settings): Promise<void>;
};

/** `$XDG_CONFIG_HOME/bilka-mcp/settings.json`, by default `~/.config/bilka-mcp/settings.json`. */
export function defaultSettingsFile(env: Env): string {
  return join(configDir(env), "settings.json");
}

/**
 * A settings store in one JSON file (`{"storeId": "1654"}`), written atomically
 * with mode 600 like the session file. Errors name the file and the error code.
 */
export function fileSettingsStore(file: string): SettingsStore {
  return {
    location: file,
    async load() {
      const parsed = await readPrivateJson(file);
      if (!isRecord(parsed)) return {};
      const storeId =
        typeof parsed.storeId === "number" ? String(parsed.storeId) : text(parsed.storeId);
      return storeId ? { storeId } : {};
    },
    async save(settings) {
      await writePrivateJson(file, settings);
    },
  };
}
