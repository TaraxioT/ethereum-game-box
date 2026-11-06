// Rate limits, as sliding windows of timestamps kept in the Durable Object.

import type { Prepared } from './request.ts';
import type { Store } from './store.ts';

export interface Limit {
  key: string;
  max: number;
  windowSeconds: number;
  /** Said back to the caller when the limit is hit. */
  what: string;
}

const HOUR = 3600;
const DAY = 86_400;
/** A pop-up's licence: a pop-up opened within this window is still live. */
const POPUP_TERM = 600;

/** The limits a request from `ip` counts against. Executes count per account and top-ups per player, each token apart;
 *  results and stakes are bounded by the Box keys, verdicts and voids by the verifier's key, and a refund or a close can
 *  succeed only once. */
export function limitsFor({ kind, account }: Pick<Prepared, 'kind' | 'account'>, ip: string): Limit[] {
  switch (kind) {
    case 'claim':
      return [
        { key: `claim:ip:${ip}`, max: 5, windowSeconds: HOUR, what: '5 claims per hour from one address' },
        { key: 'claim:all', max: 200, windowSeconds: DAY, what: '200 claims per day' },
      ];
    case 'popup':
      return [
        { key: `popup:ip:${ip}`, max: 3, windowSeconds: HOUR, what: '3 pop-ups per hour from one address' },
        { key: 'popup:live', max: 5, windowSeconds: POPUP_TERM, what: '5 live pop-ups at once' },
      ];
    case 'drip':
      return [{ key: 'drip:all', max: 50, windowSeconds: DAY, what: '50 drips per day' }];
    case 'deploy':
      return [
        { key: `deploy:ip:${ip}`, max: 3, windowSeconds: HOUR, what: '3 account deploys per hour from one address' },
        { key: 'deploy:all', max: 30, windowSeconds: DAY, what: '30 account deploys per day' },
      ];
    case 'execute':
      return [
        { key: `execute:account:${account?.toLowerCase()}`, max: 30, windowSeconds: HOUR, what: '30 calls per hour from one account' },
        { key: 'execute:all', max: 1500, windowSeconds: DAY, what: '1500 account calls per day' },
      ];
    case 'topup':
    case 'store-topup':
      return [
        { key: `${kind}:player:${account?.toLowerCase()}`, max: 1, windowSeconds: 600, what: 'one top-up per player per 10 minutes' },
        { key: `${kind}:all`, max: 300, windowSeconds: DAY, what: '300 top-ups per day' },
      ];
    case 'seat':
      return [{ key: 'seat:all', max: 200, windowSeconds: DAY, what: '200 Box-vouched names per day' }];
    case 'result':
    case 'pot-open':
    case 'pot-refund':
    case 'cup-close':
    case 'store-open':
    case 'store-settle':
    case 'store-void':
    case 'store-refund':
      return [];
  }
}

export class Limits {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  /** The first limit that one more request would break, or `null`. */
  async exceeded(limits: Limit[], now: number): Promise<Limit | null> {
    for (const limit of limits) {
      if ((await this.recent(limit, now)).length >= limit.max) return limit;
    }
    return null;
  }

  /** Counts one request against each limit. */
  async take(limits: Limit[], now: number): Promise<void> {
    for (const limit of limits) {
      await this.store.put(`rate:${limit.key}`, [...(await this.recent(limit, now)), now]);
    }
  }

  private async recent(limit: Limit, now: number): Promise<number[]> {
    const times = (await this.store.get<number[]>(`rate:${limit.key}`)) ?? [];
    return times.filter((t) => t > now - limit.windowSeconds);
  }
}
