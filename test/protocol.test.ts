import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/client";
import { expect, test } from "vitest";
import { connect } from "./support/harness.ts";

test("the server speaks MCP 2026-07-28", async () => {
  const { client } = await connect({ protocol: { pin: "2026-07-28" } });

  expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
});

test("clients on the older initialize handshake are still served", async () => {
  const { client, callTool } = await connect({ protocol: "legacy" });

  const { tools } = await client.listTools();
  const result = await callTool("search_products", { query: "skyr" });

  expect(client.getNegotiatedProtocolVersion()).not.toBe("2026-07-28");
  expect(tools.map((tool) => tool.name)).toContain("search_products");
  expect(result.isError).toBe(false);
});

test(
  "over stdio, the server writes nothing but protocol messages to stdout",
  { timeout: 20_000 },
  async () => {
    const meta = {
      [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
      [CLIENT_INFO_META_KEY]: { name: "stdout-test", version: "0.0.0" },
      [CLIENT_CAPABILITIES_META_KEY]: {},
    };
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } },
      // No store is configured, so this answers with the guided error and sends nothing to Bilka.
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { _meta: meta, name: "search_products", arguments: { query: "havremælk" } },
      },
    ];
    // A clean environment: no store id or credentials, and an empty home directory.
    const home = mkdtempSync(join(tmpdir(), "bilkatogo-mcp-stdout-"));
    const child = spawn(process.execPath, ["src/main.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    // Close stdin once both responses are in; the server then exits.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no responses; stderr: ${stderr}`)), 10_000);
      child.stdout.on("data", () => {
        if (stdout.split("\n").filter(Boolean).length >= requests.length) {
          clearTimeout(timer);
          child.stdin.end();
          resolve();
        }
      });
    });
    const exitCode = await new Promise((resolve) => child.on("close", resolve));

    const lines = stdout.split("\n").filter((line) => line !== "");
    const messages = lines.map((line) => JSON.parse(line));
    for (const message of messages) expect(message.jsonrpc).toBe("2.0");
    const byId = new Map(messages.map((message) => [message.id, message]));
    expect(byId.get(1)?.result.tools.map((tool: { name: string }) => tool.name)).toContain(
      "search_products",
    );
    expect(byId.get(2)?.result.isError).toBe(true);
    expect(byId.get(2)?.result.content[0].text).toContain("BILKATOGO_STORE_ID");
    expect(stderr).toContain("bilkatogo-mcp:");
    expect(exitCode).toBe(0);
  },
);
