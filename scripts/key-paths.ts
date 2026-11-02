// Dev-only helper for issue #4: lists every distinct key path in the saved
// capture files with a short type hint and no values, so a person can spot
// personal-data fields before scrubbing a fixture by hand. See docs/capture.md.
//
//   node scripts/key-paths.ts <capture-dir-or-json-file>...
//
// Paths look like `order.lines[].orderlines[].product.name`. A path is marked
// "personal?" when its key name looks personal, and "email-like" when one of
// its string values looks like an email address. Neither mark is complete:
// read every path.

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export type KeyPath = {
  path: string;
  /** Sorted type hints seen at this path, e.g. ["null", "string"]. */
  types: string[];
  marks: string[];
};

const PERSONAL_KEY =
  /name|address|street|zip|city|phone|mobile|mail|code|comment|note|door|instruction|uid|tid|customer|recipient|location|lat$|lng$|lon$|birth|card|iban/i;
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every distinct key path in `value`, sorted, with type hints and marks. */
export function keyPaths(value: unknown): KeyPath[] {
  const found = new Map<string, { types: Set<string>; marks: Set<string> }>();
  walk(value, "", "", found);
  return [...found]
    .map(([path, entry]) => ({
      path,
      types: [...entry.types].sort(),
      marks: [...entry.marks].sort(),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function walk(
  value: unknown,
  path: string,
  key: string,
  found: Map<string, { types: Set<string>; marks: Set<string> }>,
) {
  let entry = found.get(path);
  if (!entry) {
    entry = { types: new Set(), marks: new Set() };
    found.set(path, entry);
  }
  if (key && PERSONAL_KEY.test(key)) entry.marks.add("personal?");
  if (Array.isArray(value)) {
    entry.types.add(value.length === 0 ? "array (empty)" : "array");
    for (const item of value) walk(item, `${path}[]`, key, found);
    return;
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    entry.types.add(keys.length === 0 ? "object (empty)" : "object");
    for (const [childKey, child] of Object.entries(value)) {
      walk(child, path ? `${path}.${childKey}` : childKey, childKey, found);
    }
    return;
  }
  if (value === null) entry.types.add("null");
  else if (typeof value === "string") {
    entry.types.add(value === "" ? "string (empty)" : "string");
    if (EMAIL_LIKE.test(value.trim())) entry.marks.add("email-like");
  } else entry.types.add(typeof value);
}

/** The text report for one parsed file. */
export function formatKeyPaths(paths: KeyPath[]): string {
  const width = Math.min(70, Math.max(0, ...paths.map((entry) => (entry.path || "(root)").length)));
  return paths
    .map((entry) => {
      const marks = entry.marks.length > 0 ? `  <- ${entry.marks.join(", ")}` : "";
      return `${(entry.path || "(root)").padEnd(width)}  ${entry.types.join(" | ")}${marks}`;
    })
    .join("\n");
}

async function filesOf(target: string): Promise<string[]> {
  if (!(await stat(target)).isDirectory()) return [target];
  const names = (await readdir(target))
    .filter((name) => name.endsWith(".json") || name.endsWith(".txt"))
    .sort();
  return names.map((name) => join(target, name));
}

async function main(targets: string[]): Promise<number> {
  if (targets.length === 0 || targets.includes("--help")) {
    console.error("Usage: node scripts/key-paths.ts <capture-dir-or-json-file>...");
    return 64;
  }
  for (const target of targets) {
    for (const file of await filesOf(target)) {
      if (basename(file) === "summary.json") continue;
      console.log(`== ${basename(file)}`);
      try {
        console.log(formatKeyPaths(keyPaths(JSON.parse(await readFile(file, "utf8")))));
      } catch {
        console.log("(not JSON; open it by hand)");
      }
      console.log("");
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
