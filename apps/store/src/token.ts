// The publish token's check. Both sides are hashed first, so `timingSafeEqual` always compares two 32-byte values and
// the time taken says nothing about the token's bytes or its length.

const sha256 = (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

/** Whether an `Authorization` header is `Bearer <token>`. */
export async function bearerMatches(header: string | null, token: string): Promise<boolean> {
  const given = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const [a, b] = await Promise.all([sha256(given), sha256(token)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
