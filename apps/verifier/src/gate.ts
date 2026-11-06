// The rate limits on `POST /judge`. New judgements are limited per Box, one Durable Object each. That counts only requests
// the Box really signed, so nobody else can use up a Box's allowance, and each judgement can run the model, which the
// team pays for. A count is taken before the pot and the store are read, and given back if they fail: that is an outage,
// not the Box's doing. Reading a Box's key from the chain is limited per address, as a caller needs no signature to ask.

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

/** Far past a venue of Boxes behind one address, all repeating through an outage. */
const callerLimit = (ip: string): Limit => ({
  key: `judge:ip:${ip}`,
  max: 600,
  windowSeconds: HOUR,
  what: '600 requests per hour from one address',
});

async function take(store: Store, limit: Limit, now: number): Promise<string | null> {
  const limits = new Limits(store);
  const hit = await limits.exceeded([limit], now);
  if (hit) return hit.what;
  await limits.take([limit], now);
  return null;
}

/** Counts one judgement against `box`. Returns what was broken, or null. */
export const takeJudgement = (store: Store, box: string, now: number): Promise<string | null> => take(store, limitOf(box), now);

/** Counts one chain read against the address `ip`. Returns what was broken, or null. */
export const takeCaller = (store: Store, ip: string, now: number): Promise<string | null> => take(store, callerLimit(ip), now);

/** Gives back what `takeJudgement` counted at `at`. */
export function returnJudgement(store: Store, box: string, at: number): Promise<void> {
  return new Limits(store).giveBack([limitOf(box)], at);
}

export class BoxGate extends DurableObject<Env> {
  take(box: string, now: number): Promise<string | null> {
    return takeJudgement(this.ctx.storage, box, now);
  }

  giveBack(box: string, at: number): Promise<void> {
    return returnJudgement(this.ctx.storage, box, at);
  }

  takeCaller(ip: string, now: number): Promise<string | null> {
    return takeCaller(this.ctx.storage, ip, now);
  }
}
