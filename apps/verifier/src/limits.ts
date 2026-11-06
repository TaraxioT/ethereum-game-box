// How far a judgement may go. The container has its own limits; these hold even if it ignores them.

const KIB = 1024;
const MIB = 1024 * KIB;
const MINUTE = 60_000;

export const LIMITS = {
  /** Runs for one pot: the first, and one retry on a fresh container. */
  attempts: 2,
  /** One run, from asking for a container to its answer: the container's own 5 minutes, and time to start it. */
  runMs: 7 * MINUTE,
  /** The alarm set while a run is out: if the object dies mid-run, this wakes it. Past `runMs`, under an alarm's 15. */
  leaseMs: 9 * MINUTE,
  /** Model turns in a run, as the container's limit: a shell can call `zg.internal` itself, so the proxy counts too. */
  turns: 16,
  /** Tokens in a run, as the container's limit and for the same reason, counting each turn's whole prompt. */
  tokens: 200_000,
  /** One model call from end to end, 0G's reply and the TEE check together. The container gives its whole call to
   *  `zg.internal` 60 s, so this stays under that: a turn that passes here always gets back to it. */
  turnMs: 55_000,
  /** The most a turn may ask of the model, as the container's limit. */
  replyTokens: 2048,
  /** A turn's request, and a turn's reply. */
  turnBytes: MIB,
  /** Every turn of a pot, across both its runs. Sealing a record holds it a few times over at once, which came to about
   *  70 MB at this size, and past a Durable Object's 128 MB it would die with no Void signed. A run's tokens hold an honest
   *  one to about 1 MiB. */
  turnsBytes: 4 * MIB,
  /** A verdict's reason. */
  whyChars: 2000,
  /** How long a signed `Verdict` or `Void` stays good, in seconds. */
  signedForSeconds: 15 * 60,
  /** A signature closer to its deadline than this (seconds) is signed again: it wouldn't reach a block in time. */
  signMarginSeconds: 60,
  /** How often a payment in flight is checked. A Sepolia block is 12 s. */
  pollMs: 3000,
  /** The first wait after a refused send, doubling each time up to `retryMaxMs`. */
  retryMs: 5000,
  retryMaxMs: 5 * MINUTE,
  /** How long to keep trying to pay. Past an hour anyone can refund the pot, and the Box's sweep does. */
  payForMs: 2 * 60 * MINUTE,
  /** One upload to 0G Storage, under an alarm's 15 minutes. */
  uploadMs: 10 * MINUTE,
  /** The first wait after a failed upload, doubling each time up to `uploadRetryMaxMs`. It never stops. */
  uploadRetryMs: MINUTE,
  uploadRetryMaxMs: 60 * MINUTE,
} as const;

/** What `bytes` of text will cost, at the container's pessimistic three bytes a token. */
export const estimateTokens = (bytes: number): number => Math.ceil(bytes / 3);

/** The wait before try `tries + 1`: `first`, doubling up to `max`. */
export function backoff(tries: number, first: number, max: number): number {
  return Math.min(first * 2 ** Math.min(tries, 20), max);
}
