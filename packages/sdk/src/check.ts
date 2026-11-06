// Three small checks on untrusted JSON, shared by the manifests and the match log.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first of `value`'s keys that isn't in `keys`, if any. */
export function strayKey(value: object, keys: readonly string[]): string | undefined {
  return Object.keys(value).find((key) => !keys.includes(key));
}

/**
 * Whether `text`, which parsed to `value`, can be read only one way. Layout is free, but with the space between tokens
 * gone it must be what JSON.stringify makes. A repeated key isn't: a reader who sees the first and a parser that keeps
 * the last would be reading two different things.
 */
export function hasOneReading(text: string, value: unknown): boolean {
  return text.replace(/("(?:[^"\\]|\\.)*")|\s+/g, "$1") === JSON.stringify(value);
}
