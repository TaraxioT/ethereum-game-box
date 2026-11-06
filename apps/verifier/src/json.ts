// Reading JSON the verifier can't trust.

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `text` parsed, or `undefined` if it isn't JSON. */
export function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
