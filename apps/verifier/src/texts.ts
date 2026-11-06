// Long text in Durable Object storage. A value tops out at 2 MB, and a log or an audit record can be larger, so text is
// kept as UTF-8 in chunks. Bytes in, the same bytes out: a record's hash is over its exact text.

import type { Store } from '@egb/relayer/store';

const CHUNK_BYTES = 512 * 1024;

const chunkKey = (key: string, index: number) => `${key}#${index}`;

export async function putText(store: Store, key: string, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  const chunks = Math.ceil(bytes.length / CHUNK_BYTES);
  for (let index = 0; index < chunks; index++) {
    await store.put(chunkKey(key, index), bytes.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES));
  }
  await store.put(key, chunks);
}

export async function getText(store: Store, key: string): Promise<string | undefined> {
  const chunks = await store.get<number>(key);
  if (chunks === undefined) return undefined;
  const parts: Uint8Array[] = [];
  for (let index = 0; index < chunks; index++) {
    const part = await store.get<Uint8Array>(chunkKey(key, index));
    if (!part) throw new Error(`stored text ${key} is missing a chunk`);
    parts.push(part);
  }
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return new TextDecoder().decode(bytes);
}

export async function deleteText(store: Store, key: string): Promise<void> {
  const chunks = (await store.get<number>(key)) ?? 0;
  for (let index = 0; index < chunks; index++) await store.delete(chunkKey(key, index));
  await store.delete(key);
}
