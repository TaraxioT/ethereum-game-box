// Two small checks on parsed, untrusted JSON, shared by the manifests and the match log.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first of `value`'s keys that isn't in `keys`, if any. */
export function strayKey(value: object, keys: readonly string[]): string | undefined {
  return Object.keys(value).find((key) => !keys.includes(key));
}
