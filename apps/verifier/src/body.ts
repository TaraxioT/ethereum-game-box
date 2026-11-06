// Reading a body nobody has vouched for. A chunked body declares no length and a declared one can lie, so the bytes are
// counted as they arrive, and the read stops at the limit with the rest unread.

/** `request`'s body as text, or null if it is over `maxBytes`. */
export async function boundedText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > maxBytes) return null;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}
