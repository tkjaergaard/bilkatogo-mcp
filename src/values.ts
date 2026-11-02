// Small helpers for reading untyped values: decoded JSON and thrown errors.

/** A plain object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string with its surrounding space trimmed, or null when it's empty or not a string. */
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Bilka's short notices without their little HTML (`<strong>`), whitespace
 * collapsed to single spaces, or null when nothing is left.
 */
export function plain(html: string | undefined): string | null {
  return text((html ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " "));
}

/** A Node.js system error's code, e.g. "ENOENT". */
export function errorCode(error: unknown): string | undefined {
  const code = isRecord(error) ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}
