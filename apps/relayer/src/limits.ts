// Rate limits, as sliding windows of timestamps kept in the Durable Object.

import type { TxKind } from '@egb/shared/names';

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

/** The limits a request of `kind` from `ip` counts against. Results and executes are bounded by the Box keys. */
export function limitsFor(kind: TxKind, ip: string): Limit[] {
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
    case 'execute':
    case 'result':
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
