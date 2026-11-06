// The rate limit on new judgements, one Durable Object per Box. It counts only requests the Box really signed, so
// nobody else can use up a Box's allowance, and each judgement can run the model, which the team pays for.

import { type Limit, Limits } from '@egb/relayer/limits';
import type { Store } from '@egb/relayer/store';
import { DurableObject } from 'cloudflare:workers';

import type { Env } from './env.ts';

const HOUR = 3600;

const limitOf = (box: string): Limit => ({
  key: `judge:box:${box}`,
  max: 60,
  windowSeconds: HOUR,
  what: '60 judgements per hour from one Box',
});

/** Counts one judgement against `box`. Returns what was broken, or null. */
export async function takeJudgement(store: Store, box: string, now: number): Promise<string | null> {
  const limits = new Limits(store);
  const limit = limitOf(box);
  const hit = await limits.exceeded([limit], now);
  if (hit) return hit.what;
  await limits.take([limit], now);
  return null;
}

export class BoxGate extends DurableObject<Env> {
  take(box: string, now: number): Promise<string | null> {
    return takeJudgement(this.ctx.storage, box, now);
  }
}
