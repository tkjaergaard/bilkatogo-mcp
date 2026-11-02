import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/** A login file in a fresh temp dir, mode 600 unless told otherwise. Removed after the test. */
export async function loginFile(contents: unknown, mode = 0o600): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bilkatogo-mcp-login-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "login.json");
  await writeFile(file, JSON.stringify(contents));
  await chmod(file, mode);
  return file;
}
