// What the store's tests share: a store on an in-memory R2, a good bundle, and an upload.

import { packBundle } from '@egb/sdk/bundle';

import { Catalog } from '../src/catalog.ts';
import { handle } from '../src/routes.ts';
import { MemoryR2 } from './memory-r2.ts';

export const TOKEN = 'a-test-publish-token';

const text = (value: string) => new TextEncoder().encode(value);

/** A good bundle's zip. A different `page` under the same `id` is a different hash. */
export function zipOf(id = 'test-game', page = 'one'): Uint8Array {
  const manifest = {
    format: 1,
    id,
    title: 'Test Game',
    blurb: 'A game for tests.',
    players: { min: 2, max: 4 },
    minutes: 1,
    stakes: [5, 10, 25],
    taps: 'identify',
    verifier: { instructions: 'The seat with the most taps wins the whole pot.' },
  };
  return packBundle(
    new Map([
      ['index.html', text(`<!doctype html>\n<title>${page}</title>\n`)],
      ['manifest.json', text(JSON.stringify(manifest))],
    ]),
  );
}

export async function hashOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `0x${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

interface StoreOptions {
  /** The secret, or null for none set. */
  token?: string | null;
  now?: () => number;
}

export function store({ token = TOKEN, now }: StoreOptions = {}) {
  const r2 = new MemoryR2();
  const catalog = new Catalog(now);
  const call = (path: string, init: RequestInit = {}) => {
    const request = new Request(`https://store.test${path}`, { duplex: 'half', ...init } as RequestInit);
    return handle(request, { bucket: r2.bucket, token: token ?? undefined, catalog });
  };
  return {
    r2,
    call,
    /** `POST /bundles` with the good token. */
    upload: (body: BodyInit, headers: Record<string, string> = {}) =>
      call('/bundles', { method: 'POST', body, headers: { authorization: `Bearer ${TOKEN}`, ...headers } }),
    /** The listings in `/index.json`, read past the catalog's memory. */
    index: async () => (await call('/index.json')).json<{ listings: { id: string; hash: string }[] }>(),
  };
}

/** A body that counts how many chunks anyone pulled from it, and whether it was cancelled. */
export function countedBody(chunks: Uint8Array[]) {
  const seen = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[seen.pulled++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { body, seen };
}
