// Nothing the verifier logs or answers may hold a key, or an RPC URL (it carries the node's key).

import { describe } from '@egb/relayer/chain';

import type { Env } from './env.ts';

export type Scrub = (error: unknown) => string;

/** A one-line description of an error with no URL in it, and none of `secrets`, with or without their `0x`. */
export function scrubber(secrets: readonly string[]): Scrub {
  const values = secrets.filter(Boolean).flatMap((secret) => [secret, secret.replace(/^0x/, '')]);
  return (error) => values.reduce((line, value) => line.replaceAll(value, '<secret>'), describe(error));
}

export const envScrubber = (env: Env): Scrub =>
  scrubber([env.VERIFIER_PRIVATE_KEY, env.ZG_API_KEY, env.ZG_STORAGE_KEY, env.SEPOLIA_RPC_URL]);
