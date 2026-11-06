// Refuses a digest it has already sent. A signed digest is kept until its deadline, after which the contracts refuse
// it on their own; a drip is kept for good.

import type { Store } from './store.ts';

const PREFIX = 'replay:';

export class Replay {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  /** Whether `key` was sent and is still within its deadline. */
  async seen(key: string, now: number): Promise<boolean> {
    const until = await this.store.get<number>(PREFIX + key);
    return until !== undefined && (until === 0 || until >= now);
  }

  /** Records `key` as sent, refused until `until` (unix seconds; 0: for good). */
  async record(key: string, until: number): Promise<void> {
    await this.store.put(PREFIX + key, until);
  }

  /** Forgets `key`, for a request that never reached the chain. */
  async forget(key: string): Promise<void> {
    await this.store.delete(PREFIX + key);
  }

  /** Drops the entries whose deadline has passed. */
  async prune(now: number): Promise<void> {
    for (const [key, until] of await this.store.list<number>({ prefix: PREFIX })) {
      if (until !== 0 && until < now) await this.store.delete(key);
    }
  }
}
