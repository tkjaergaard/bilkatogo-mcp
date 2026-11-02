// The stdio launcher: reads configuration, builds the server with the real
// `fetch` and serves it on stdin/stdout. stdout carries protocol messages only;
// every diagnostic goes to stderr.

import { setTimeout as sleep } from "node:timers/promises";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { defaultLoginFile } from "./credentials.ts";
import { createServer, type ServerConfig } from "./server.ts";
import { defaultSessionFile, fileSessionStore } from "./session-store.ts";
import { defaultSettingsFile, fileSettingsStore } from "./settings-store.ts";

// Anything that logs by accident must not corrupt the protocol stream.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

// One config object for the whole process: the server keeps its login session
// per config, so every server the SDK builds from it shares one JWT.
const config: ServerConfig = {
  fetch: globalThis.fetch,
  sleep: (ms) => sleep(ms),
  // Read only when a tool first needs the account or the store: the login,
  // and the default store id (BILKATOGO_STORE_ID, else "storeId" in login.json).
  credentials: { env: process.env, loginFile: defaultLoginFile(process.env) },
  // The store chosen with select_store; it wins over the defaults above.
  settingsStore: fileSettingsStore(defaultSettingsFile(process.env)),
  // Remembers the login token that worked, so a restart skips the password login.
  sessionStore: fileSessionStore(defaultSessionFile(process.env)),
  warn: (line) => console.error(`bilka-mcp: ${line}`),
};

serveStdio(() => createServer(config), {
  onerror: (error) => console.error(`bilka-mcp: ${error.message}`),
});

console.error("bilka-mcp: serving MCP on stdio");
