import type { Settings, SettingsStore } from "../../src/settings-store.ts";

export const MEMORY_SETTINGS = "test memory";

/** An in-memory settings store. `saved` records every write; `failWrites` makes them throw. */
export function memorySettings(initial: Settings = {}, options: { failWrites?: boolean } = {}) {
  let current: Settings = { ...initial };
  const saved: Settings[] = [];
  const store: SettingsStore & { saved: Settings[] } = {
    location: MEMORY_SETTINGS,
    saved,
    async load() {
      return { ...current };
    },
    async save(settings) {
      if (options.failWrites) throw new Error(`could not write ${MEMORY_SETTINGS} (EACCES)`);
      saved.push({ ...settings });
      current = { ...settings };
    },
  };
  return store;
}
