// An upload's body, read to a limit. `Content-Length` is only a claim, and a chunked body has none, so the bytes are
// counted as they arrive. One buffer holds them: a Worker's memory is small, and the reader makes copies of its own.

/** The stream's bytes, or null the moment there are more than `limit`, with the rest left unread. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  const out = new Uint8Array(limit);
  if (!body) return out.subarray(0, 0);
  const reader = body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.subarray(0, got);
    if (got + value.length > limit) {
      await reader.cancel();
      return null;
    }
    out.set(value, got);
    got += value.length;
  }
}
