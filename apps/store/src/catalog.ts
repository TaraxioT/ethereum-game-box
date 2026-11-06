// `/index.json`, built from the listings and kept briefly. Reads are public and a build reads every listing, so when
// the kept text runs out one request rebuilds and the others go on getting that text. The Cache API works only on
// custom domains and this store is on workers.dev, so the text is kept here. It holds finished text, the same for every
// caller, and never a promise: a Worker can't await one request's I/O from another. So with no text to serve, in a new
// isolate or just after an upload, each request builds its own.

import type { StoreIndex } from '@egb/sdk/bundle';

import { type Bucket, listings } from './shelf.ts';

export const INDEX_SECONDS = 30;

/** How long one rebuild holds the others to the old text. A Worker can drop a request without a word, so a rebuild can't
 *  say it has stopped: its turn ends by itself, and the next request rebuilds. */
export const REBUILD_SECONDS = 5;

export class Catalog {
  private kept: { text: string; until: number } | null = null;
  /** Counts the `drop`s, so a build can tell one happened while it ran. */
  private drops = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async text(bucket: Bucket): Promise<string> {
    const now = this.now();
    if (this.kept && now < this.kept.until) return this.kept.text;
    if (this.kept) this.kept.until = now + REBUILD_SECONDS * 1000;
    const drops = this.drops;
    const index: StoreIndex = { listings: await listings(bucket) };
    const text = JSON.stringify(index);
    if (drops === this.drops) this.kept = { text, until: now + INDEX_SECONDS * 1000 };
    return text;
  }

  /** Forgets the index after an upload, along with any build under way, which may have missed it. Other isolates catch
   *  up as their text runs out. */
  drop(): void {
    this.kept = null;
    this.drops++;
  }
}
