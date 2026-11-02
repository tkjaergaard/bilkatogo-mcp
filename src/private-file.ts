// Small private JSON files in the config directory (session.json,
// settings.json): read as JSON, written atomically with mode 600. Errors name
// the file and the error code, never the contents.

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { errorCode } from "./values.ts";

/** The file's JSON, or undefined when there's no file yet (or no directory where it would be). */
export async function readPrivateJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return undefined;
    throw new Error(`could not read ${file} (${errorCode(error) ?? "unknown error"})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`could not read ${file} (not JSON)`);
  }
}

/**
 * Writes `value` as JSON: to a temp file created with mode 600 (directory
 * 700), then renamed into place, so a reader never sees half a file.
 */
export async function writePrivateJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw new Error(`could not write ${file} (${errorCode(error) ?? "unknown error"})`);
  }
}
