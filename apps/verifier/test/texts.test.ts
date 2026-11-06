import { MemoryStore } from '@egb/relayer/test/memory-store';
import { describe, expect, it } from 'vitest';

import { deleteText, getText, putText } from '../src/texts.ts';

const CHUNK = 512 * 1024;

describe('stored text', () => {
  it.each([
    ['empty', ''],
    ['short', 'hello'],
    ['exactly a chunk', 'x'.repeat(CHUNK)],
    ['over a chunk, with a character cut in two', `${'x'.repeat(CHUNK - 1)}€€${'é'.repeat(CHUNK)}`],
  ])('comes back the same: %s', async (_name, text) => {
    const store = new MemoryStore();
    await putText(store, 'k', text);
    expect(await getText(store, 'k')).toBe(text);
  });

  it('stays under the 2 MB a value may hold', async () => {
    const store = new MemoryStore();
    await putText(store, 'k', '€'.repeat(3 * CHUNK));
    for (const value of store.map.values()) {
      if (value instanceof Uint8Array) expect(value.length).toBeLessThanOrEqual(CHUNK);
    }
  });

  it('is undefined when it was never put', async () => {
    expect(await getText(new MemoryStore(), 'k')).toBeUndefined();
  });

  it('is gone after a delete, chunks and all', async () => {
    const store = new MemoryStore();
    await putText(store, 'k', 'x'.repeat(CHUNK * 2));
    await deleteText(store, 'k');
    expect(store.map.size).toBe(0);
  });

  it('throws rather than hand back text with a hole', async () => {
    const store = new MemoryStore();
    await putText(store, 'k', 'x'.repeat(CHUNK + 1));
    await store.delete('k#1');
    await expect(getText(store, 'k')).rejects.toThrow('missing a chunk');
  });
});
