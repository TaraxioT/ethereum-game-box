import { describe, expect, it, vi } from 'vitest';

import { boundedText } from '../src/body.ts';

const LIMIT = 8;

/** A request whose body arrives in these chunks, with no declared length. */
function chunked(...chunks: Uint8Array[]) {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
  return { cancel, request: new Request('http://verifier/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit) };
}

const bytes = (length: number) => new Uint8Array(length).fill(0x61);

describe('a counted read', () => {
  it('reads a body at the limit', async () => {
    expect(await boundedText(chunked(bytes(3), bytes(5)).request, LIMIT)).toBe('aaaaaaaa');
  });

  it('stops one byte past it, and cancels the rest', async () => {
    const { request, cancel } = chunked(bytes(3), bytes(6), bytes(1));
    expect(await boundedText(request, LIMIT)).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('counts bytes, not characters', async () => {
    const text = new TextEncoder().encode('ééééé');
    expect(await boundedText(chunked(text).request, LIMIT)).toBeNull();
  });

  it('keeps a character split across two chunks', async () => {
    const text = new TextEncoder().encode('aé');
    expect(await boundedText(chunked(text.subarray(0, 2), text.subarray(2)).request, LIMIT)).toBe('aé');
  });

  it('refuses a declared length unread', async () => {
    const request = new Request('http://verifier/', { method: 'POST', body: 'a', headers: { 'content-length': String(LIMIT + 1) } });
    expect(await boundedText(request, LIMIT)).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });

  it('does not believe a declared length that lies', async () => {
    const request = new Request('http://verifier/', { method: 'POST', body: 'a'.repeat(LIMIT + 1), headers: { 'content-length': '1' } });
    expect(await boundedText(request, LIMIT)).toBeNull();
  });

  it('reads a request with no body as empty', async () => {
    expect(await boundedText(new Request('http://verifier/', { method: 'POST' }), LIMIT)).toBe('');
  });
});
