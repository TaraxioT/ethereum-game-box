// Workers keep `timingSafeEqual` on `crypto.subtle`, and Node keeps it in `node:crypto`. The live test runs the real
// one.
import { timingSafeEqual } from 'node:crypto';

Object.assign(crypto.subtle, {
  timingSafeEqual: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(new Uint8Array(a), new Uint8Array(b)),
});
