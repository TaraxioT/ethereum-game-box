// The public side: the index and the zips, open to anyone and cached as each should be.

import { describe, expect, it, vi } from 'vitest';

import { INDEX_SECONDS } from '../src/catalog.ts';
import { hashOf, store, zipOf } from './harness.ts';

describe('/index.json', () => {
  it('is empty before anything is published', async () => {
    expect(await store().index()).toEqual({ listings: [] });
  });

  it('holds every listing, by id, whatever order they came in', async () => {
    const { upload, index } = store();
    for (const id of ['tap-rush', 'a-game', 'mid-game']) await upload(zipOf(id));
    expect((await index()).listings.map((listing) => listing.id)).toEqual(['a-game', 'mid-game', 'tap-rush']);
  });

  it('follows the bucket past one page', async () => {
    const { r2, upload, index } = store();
    r2.pageSize = 2;
    for (const id of ['one', 'two', 'three', 'four', 'five']) await upload(zipOf(id));
    expect((await index()).listings).toHaveLength(5);
  });

  it('is open to any origin and says how long to keep it', async () => {
    const response = await store().call('/index.json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe(`public, max-age=${INDEX_SECONDS}`);
  });

  it('touches the bucket once per window, then builds again', async () => {
    let now = 1_000_000;
    const { r2, call } = store({ now: () => now });
    await call('/index.json');
    const calls = r2.calls;
    await call('/index.json');
    now += INDEX_SECONDS * 1000 - 1;
    await call('/index.json');
    expect(r2.calls).toBe(calls);

    r2.plant(`listings/0x${'ab'.repeat(32)}.json`, JSON.stringify({ id: 'seen-later' }));
    now += 1;
    const after = await (await call('/index.json')).json<{ listings: { id: string }[] }>();
    expect(after.listings.map((listing) => listing.id)).toEqual(['seen-later']);
  });

  it('shows an upload at once in the isolate that took it', async () => {
    const { upload, index } = store({ now: () => 0 });
    await index();
    await upload(zipOf());
    expect((await index()).listings).toHaveLength(1);
  });

  it('skips a listing removed by hand between the list and the read', async () => {
    const { r2, upload, index } = store();
    await upload(zipOf('stays'));
    const get = r2.get.bind(r2);
    r2.get = (key: string) => (key.endsWith('.json') ? Promise.resolve(null) : get(key));
    expect((await index()).listings).toEqual([]);
  });
});

describe('/bundles/<hash>.zip', () => {
  it('gives back the same bytes, to anyone, for good', async () => {
    const { upload, call } = store();
    const zip = zipOf();
    const hash = await hashOf(zip);
    await upload(zip);

    const response = await call(`/bundles/${hash}.zip`);
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual(zip);
    expect(await hashOf(bytes)).toBe(hash);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('is a 404 for a hash nobody published, open to any origin', async () => {
    const response = await store().call(`/bundles/0x${'ab'.repeat(32)}.zip`);
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('is a 404 for anything that is not exactly a hash', async () => {
    const { r2, upload, call } = store();
    const zip = zipOf();
    const hash = await hashOf(zip);
    await upload(zip);
    const calls = r2.calls;
    const paths = [
      `/bundles/${hash.toUpperCase()}.zip`,
      `/bundles/${hash.slice(2)}.zip`,
      `/bundles/${hash.slice(0, -1)}.zip`,
      `/bundles/${hash}`,
      `/bundles/${hash}.zip/`,
      `/bundles/${hash}.zip.json`,
      `/bundles/x${hash}.zip`,
      `/listings/${hash}.json`,
      '/ids/test-game',
      '/',
    ];
    for (const path of paths) expect((await call(path)).status, path).toBe(404);
    expect(r2.calls).toBe(calls);
  });
});

describe('CORS', () => {
  it('answers a read preflight from any origin, for GET alone', async () => {
    const response = await store().call('/index.json', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET');
  });

  it('gives an upload no CORS at all', async () => {
    const response = await store().upload(zipOf());
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('a failing bucket', () => {
  it('is a bare 500 with nothing of the failure in it', async () => {
    const { r2, call } = store();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    r2.list = () => Promise.reject(new Error('r2 secret detail'));
    const response = await call('/index.json');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'store error' });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
