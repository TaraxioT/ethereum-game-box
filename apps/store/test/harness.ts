// What the store's tests share: a store on an in-memory R2, and an upload.

import { Catalog } from '../src/catalog.ts';
import { handle } from '../src/routes.ts';
import { MemoryR2 } from './memory-r2.ts';

export const TOKEN = 'a-test-publish-token';

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
    /** `/index.json`, parsed. */
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
