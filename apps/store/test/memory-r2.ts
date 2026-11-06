// An in-memory R2 that keeps R2's promise: a conditional put is one atomic step. It is strict where the store must be:
// a put that doesn't say "only if absent" throws, so a test can't pass with a write that could replace something.

import type { Bucket } from '../src/shelf.ts';

interface Barrier {
  prefix: string;
  arrive(): Promise<void>;
}

export class MemoryR2 {
  readonly objects = new Map<string, Uint8Array>();
  /** Every key a put stored, in order. */
  readonly writes: string[] = [];
  /** How many R2 calls have been made. */
  calls = 0;
  /** How many keys `list` returns before it asks for a cursor. */
  pageSize = 1000;
  private barrier: Barrier | null = null;
  private failing: string | null = null;

  get bucket(): Bucket {
    return this as unknown as Bucket;
  }

  /** Holds the next `count` puts under `prefix` until all have arrived: racing uploads, each past every check. */
  holdPuts(prefix: string, count: number): void {
    let release = () => {};
    const everyone = new Promise<void>((resolve) => (release = resolve));
    let arrived = 0;
    this.barrier = {
      prefix,
      arrive() {
        if (++arrived === count) release();
        return everyone;
      },
    };
  }

  /** Makes the next put under `prefix` fail, as R2 or a dying request would. */
  failNextPut(prefix: string): void {
    this.failing = prefix;
  }

  /** Stores an object directly, as if an earlier upload had. */
  plant(key: string, value: string): void {
    this.objects.set(key, new TextEncoder().encode(value));
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  async get(key: string) {
    this.calls++;
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    const text = () => new TextDecoder().decode(bytes);
    return {
      body: new Blob([new Uint8Array(bytes)]).stream(),
      text: async () => text(),
      json: async () => JSON.parse(text()) as unknown,
    };
  }

  async put(key: string, value: string | Uint8Array, options?: { onlyIf?: Headers }) {
    this.calls++;
    if (options?.onlyIf?.get('if-none-match') !== '*') throw new Error(`an unconditional put of ${key}`);
    if (this.barrier && key.startsWith(this.barrier.prefix)) await this.barrier.arrive();
    if (this.failing !== null && key.startsWith(this.failing)) {
      this.failing = null;
      throw new Error('R2 failed');
    }
    if (this.objects.has(key)) return null;
    this.objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value.slice());
    this.writes.push(key);
    return { key };
  }

  async list({ prefix = '', cursor }: { prefix?: string; cursor?: string }) {
    this.calls++;
    const keys = this.keys().filter((key) => key.startsWith(prefix));
    const start = Number(cursor ?? 0);
    const end = start + this.pageSize;
    const objects = keys.slice(start, end).map((key) => ({ key }));
    return end < keys.length ? { objects, truncated: true, cursor: String(end) } : { objects, truncated: false };
  }
}
