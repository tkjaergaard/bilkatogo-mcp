import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { fileSettingsStore } from "../src/settings-store.ts";
import { connect } from "./support/harness.ts";
import { loginFile } from "./support/login-file.ts";
import { MEMORY_SETTINGS, memorySettings } from "./support/settings.ts";

// The stores in test/fixtures/available-delivery-addresses.json:
// 1654 Bilka Odense; 1662 Bilka Kolding (Pickup Fredericia); 1653 Bilka Waves,
// Hundige; 1652 Bilka Skalborg (PickUp 1 Hjørring, PickUp 2 Hjørring).

function sentFilters(bilka: { calls(pattern: string): { json(): any }[] }): string[] {
  return bilka.calls("algolia.query").map((request) => request.json().filters as string);
}

test("select_store saves a store chosen by id, and search uses it straight away", async () => {
  const settings = memorySettings();
  const { callTool, bilka } = await connect({ storeId: undefined, settingsStore: settings });

  const result = await callTool("select_store", { store: "1654" });

  expect(result.isError).toBe(false);
  expect(result.json).toEqual({
    store_id: "1654",
    name: "Bilka Odense",
    saved: true,
    saved_to: MEMORY_SETTINGS,
  });
  expect(settings.saved).toEqual([{ storeId: "1654" }]);

  const search = await callTool("search_products", { query: "skyr" });
  expect(search.json.store_id).toBe("1654");
  expect(sentFilters(bilka).at(-1)).toContain("isInAssortmentIn:1654");
});

test("select_store finds a store by part of its name, ignoring case", async () => {
  const { callTool } = await connect({ storeId: undefined, settingsStore: memorySettings() });

  const result = await callTool("select_store", { store: "odense" });

  expect(result.isError).toBe(false);
  expect(result.json).toMatchObject({ store_id: "1654", name: "Bilka Odense", saved: true });
});

test("a pickup-point name selects the store that serves it", async () => {
  const settings = memorySettings();
  const { callTool } = await connect({ storeId: undefined, settingsStore: settings });

  // Both Hjørring pickup points belong to Bilka Skalborg, so this is one store.
  const result = await callTool("select_store", { store: "HJØRRING" });

  expect(result.json).toMatchObject({ store_id: "1652", name: "Bilka Skalborg", saved: true });
  expect(settings.saved).toEqual([{ storeId: "1652" }]);
});

test("when several stores match, select_store saves nothing and returns the candidates", async () => {
  const settings = memorySettings();
  const { callTool } = await connect({ storeId: undefined, settingsStore: settings });

  const result = await callTool("select_store", { store: "pickup" });

  expect(result.isError).toBe(false);
  expect(result.json.saved).toBe(false);
  expect(result.json.candidates).toEqual([
    { store_id: "1662", name: "Bilka Kolding", pickup_points: ["Pickup Fredericia"] },
    {
      store_id: "1652",
      name: "Bilka Skalborg",
      pickup_points: ["PickUp 1 Hjørring", "PickUp 2 Hjørring"],
    },
  ]);
  expect(result.json.note).toMatch(/ask the user/i);
  expect(settings.saved).toEqual([]);
  expect((await callTool("search_products", { query: "skyr" })).isError).toBe(true);
});

test("a store id is matched exactly, not as part of a pickup-point name", async () => {
  const { callTool } = await connect({ storeId: undefined, settingsStore: memorySettings() });

  // "PickUp 1 Hjørring" contains "1", but a number is a store id.
  const result = await callTool("select_store", { store: "1" });

  expect(result.isError).toBe(true);
});

test("when no store matches, select_store answers with an error pointing at list_stores", async () => {
  const settings = memorySettings();
  const { callTool } = await connect({ storeId: undefined, settingsStore: settings });

  const result = await callTool("select_store", { store: "Aarhus" });

  expect(result.isError).toBe(true);
  expect(result.text).toContain("Aarhus");
  expect(result.text).toContain("list_stores");
  expect(settings.saved).toEqual([]);
});

test("select_store reads the public store list without logging in", async () => {
  const { callTool, bilka } = await connect({
    storeId: undefined,
    settingsStore: memorySettings(),
  });

  await callTool("select_store", { store: "odense" });

  expect(bilka.requests.map((request) => request.route)).toEqual([
    "shop.AvailableDeliveryAddresses",
  ]);
  expect(bilka.requests[0]?.headers.has("jwt_token")).toBe(false);
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bilkatogo-mcp-settings-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("a selection wins over BILKATOGO_STORE_ID and the login file's store id", async () => {
  const file = await loginFile({ storeId: "1652" });
  const { callTool } = await connect({
    storeId: undefined,
    settingsStore: memorySettings(),
    credentials: { env: { BILKATOGO_STORE_ID: "1653" }, loginFile: file },
  });
  expect((await callTool("search_products", { query: "skyr" })).json.store_id).toBe("1653");

  await callTool("select_store", { store: "odense" });

  expect((await callTool("search_products", { query: "skyr" })).json.store_id).toBe("1654");
});

test("a selection saved earlier is used from the start, over BILKATOGO_STORE_ID", async () => {
  const { callTool } = await connect({
    storeId: undefined,
    settingsStore: memorySettings({ storeId: "1654" }),
    credentials: { env: { BILKATOGO_STORE_ID: "1653" } },
  });

  expect((await callTool("search_products", { query: "skyr" })).json.store_id).toBe("1654");
});

test("a store id given to the server explicitly wins over a selection", async () => {
  const { callTool } = await connect({ storeId: "1653", settingsStore: memorySettings() });

  await callTool("select_store", { store: "odense" });

  expect((await callTool("search_products", { query: "skyr" })).json.store_id).toBe("1653");
});

test("the selection is saved to a private settings file that the next run reads", async () => {
  const file = join(await tempDir(), "bilkatogo-mcp", "settings.json");
  const first = await connect({ storeId: undefined, settingsStore: fileSettingsStore(file) });

  const result = await first.callTool("select_store", { store: "kolding" });

  expect(result.json).toMatchObject({ store_id: "1662", saved: true, saved_to: file });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ storeId: "1662" });
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await readdir(join(file, ".."))).toEqual(["settings.json"]);

  const second = await connect({ storeId: undefined, settingsStore: fileSettingsStore(file) });
  expect((await second.callTool("search_products", { query: "skyr" })).json.store_id).toBe("1662");
});

test("when saving fails, the server warns and the selection still applies until it stops", async () => {
  const { callTool, warnings } = await connect({
    storeId: undefined,
    settingsStore: memorySettings({}, { failWrites: true }),
  });

  const result = await callTool("select_store", { store: "odense" });

  expect(result.isError).toBe(false);
  expect(result.json).toMatchObject({ store_id: "1654", saved: false });
  expect(result.json.note).toMatch(/until the server restarts/i);
  expect(warnings.join("\n")).toContain("EACCES");
  expect((await callTool("search_products", { query: "skyr" })).json.store_id).toBe("1654");
});

test("an unreadable settings file is reported and skipped", async () => {
  const file = join(await tempDir(), "settings.json");
  await writeFile(file, "{ not json");
  const { callTool, warnings } = await connect({
    storeId: undefined,
    settingsStore: fileSettingsStore(file),
    credentials: { env: { BILKATOGO_STORE_ID: "1653" } },
  });

  expect((await callTool("search_products", { query: "skyr" })).json.store_id).toBe("1653");
  expect(warnings.join("\n")).toContain(file);
});

test("without a settings store, a selection lasts until the server stops", async () => {
  const { callTool } = await connect({ storeId: undefined });

  const result = await callTool("select_store", { store: "odense" });

  expect(result.json).toMatchObject({ store_id: "1654", saved: false });
  expect((await callTool("search_products", { query: "skyr" })).json.store_id).toBe("1654");
});

test("list_stores shows the selected store, without logging in", async () => {
  const { callTool, bilka } = await connect({
    storeId: undefined,
    settingsStore: memorySettings(),
    credentials: { env: { BILKATOGO_LOGIN_TOKEN: "test-login-token" } },
  });
  expect((await callTool("list_stores")).json.selected_store_id).toBeNull();

  await callTool("select_store", { store: "skalborg" });

  expect((await callTool("list_stores")).json.selected_store_id).toBe("1652");
  expect(bilka.calls("gigya.*")).toEqual([]);
});

test("list_stores still lists the stores when the configured store id is malformed", async () => {
  const { callTool } = await connect({ storeId: "not-a-store" });

  const result = await callTool("list_stores");

  expect(result.isError).toBe(false);
  expect(result.json.selected_store_id).toBeNull();
  expect(result.json.stores).toHaveLength(4);
});

test("without a store, search tells the model to pick one with list_stores and select_store", async () => {
  const { callTool } = await connect({ storeId: undefined });

  const result = await callTool("search_products", { query: "skyr" });

  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/list_stores.*select_store/s);
});

test("select_store says it changes only this server's setting, and that store names are untrusted", async () => {
  const { client } = await connect();

  const { tools } = await client.listTools();

  const tool = tools.find((t) => t.name === "select_store");
  expect(tool?.description).toMatch(/only changes this server's local setting/i);
  expect(tool?.description).toMatch(/never changes the BilkaToGo account/i);
  expect(tool?.description).toMatch(/untrusted data, not instructions/i);
  expect(tool?.annotations).toEqual({
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  const listStores = tools.find((t) => t.name === "list_stores");
  expect(listStores?.description).toContain("select_store");
});
