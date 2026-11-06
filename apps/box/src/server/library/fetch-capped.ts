// A response's body, read no further than a cap: what the store sends is only as big as the store says.

export class TooBig extends Error {}

/** Every byte of the body, or a TooBig the moment there would be more than `max`. */
export async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > max) throw new TooBig(`it is over ${max} B`);
    chunks.push(chunk);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return body;
}
