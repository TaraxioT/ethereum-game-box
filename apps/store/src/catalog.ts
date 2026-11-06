// `/index.json`, built from the listings and kept briefly. Reads are public and a build reads every listing, so each
// isolate builds at most once per `INDEX_SECONDS`. The Cache API works only on custom domains and this store is on
// workers.dev, so the text is kept here. It holds finished text, the same for every caller, and never a promise: a
// Worker can't await one request's I/O from another.

import type { StoreIndex } from '@egb/sdk/bundle';

import { type Bucket, listings } from './shelf.ts';

export const INDEX_SECONDS = 30;

export class Catalog {
  private kept: { text: string; until: number } | null = null;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async text(bucket: Bucket): Promise<string> {
    const now = this.now();
    if (this.kept && now < this.kept.until) return this.kept.text;
    const index: StoreIndex = { listings: await listings(bucket) };
    const text = JSON.stringify(index);
    this.kept = { text, until: now + INDEX_SECONDS * 1000 };
    return text;
  }

  /** Forgets the index after an upload. Other isolates catch up within `INDEX_SECONDS`. */
  drop(): void {
    this.kept = null;
  }
}
