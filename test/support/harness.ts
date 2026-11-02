// The one test seam: the server factory, given the fake Bilka's `fetch` and an
// instant sleep, served through the SDK's stdio entry over an in-memory
// transport to a real SDK v2 client. Tests talk to it only via tools/list and
// tools/call.

import { Client, type VersionNegotiationMode } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { onTestFinished } from "vitest";
import { createServer, type ServerConfig } from "../../src/server.ts";
import { FakeBilka } from "./fake-bilka.ts";

export const STORE_ID = "1653";

export type ConnectOptions = Partial<Omit<ServerConfig, "fetch" | "sleep" | "warn">> & {
  /** Defaults to a fresh fake. Pass one to script it before connecting. */
  bilka?: FakeBilka;
  /** Defaults to MCP 2026-07-28 exactly. */
  protocol?: VersionNegotiationMode;
};

export type ToolResult = {
  isError: boolean;
  /** The text content the model sees. */
  text: string;
  /** The text content parsed as JSON. */
  json: any;
};

export type Connection = {
  client: Client;
  bilka: FakeBilka;
  /** Durations passed to the injected sleep, in milliseconds. */
  sleeps: number[];
  /** Lines the server wrote as diagnostics (stderr in production). */
  warnings: string[];
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
};

export async function connect(options: ConnectOptions = {}): Promise<Connection> {
  const { bilka = new FakeBilka(), protocol = { pin: "2026-07-28" }, ...config } = options;
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const serverConfig: ServerConfig = {
    storeId: STORE_ID,
    ...config,
    fetch: bilka.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    warn: (line) => {
      warnings.push(line);
    },
  };

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => createServer(serverConfig), { transport: serverTransport });
  const client = new Client(
    { name: "bilka-mcp-tests", version: "0.0.0" },
    { versionNegotiation: { mode: protocol } },
  );
  await client.connect(clientTransport);
  onTestFinished(async () => {
    await client.close();
    await handle.close();
  });

  return {
    client,
    bilka,
    sleeps,
    warnings,
    async callTool(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { type: string; text?: string }[])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { isError: result.isError === true, text, json };
    },
  };
}
