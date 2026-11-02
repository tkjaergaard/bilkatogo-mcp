// The stdio launcher: reads configuration, builds the server with the real
// `fetch` and serves it on stdin/stdout. stdout carries protocol messages only;
// every diagnostic goes to stderr.

import { setTimeout as sleep } from "node:timers/promises";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.ts";

// Anything that logs by accident must not corrupt the protocol stream.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const storeId = process.env.BILKATOGO_STORE_ID?.trim() || undefined;

serveStdio(
  () =>
    createServer({
      fetch: globalThis.fetch,
      sleep: async (ms) => {
        await sleep(ms);
      },
      storeId,
    }),
  { onerror: (error) => console.error(`bilka-mcp: ${error.message}`) },
);

console.error(
  `bilka-mcp: serving MCP on stdio (store ${storeId ?? "not configured; set BILKATOGO_STORE_ID"})`,
);
