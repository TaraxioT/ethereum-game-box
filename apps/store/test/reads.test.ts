// The public side: the index and the zips, open to anyone and cached as each should be.

import { describe, expect, it, vi } from 'vitest';

import { INDEX_SECONDS, REBUILD_SECONDS } from '../src/catalog.ts';
import { store } from './harness.ts';
import { hashOf, zipOf } from './zips.ts';

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

  it('shows an upload at once even if a build was part way through it', async () => {
    const { r2, upload, call, index } = store({ now: () => 0 });
    const release = r2.holdNextList();
    const building = call('/index.json');
    expect((await upload(zipOf())).status).toBe(201);
    release();
    await building;
    expect((await index()).listings).toHaveLength(1);
  });

  it('rebuilds once for everyone when the window ends, and they get the old text meanwhile', async () => {
    let now = 1_000_000;
    const { r2, upload, index } = store({ now: () => now });
    for (const id of ['one', 'two', 'three']) await upload(zipOf(id));
    await index();
    const calls = r2.calls;

    now += INDEX_SECONDS * 1000;
    r2.plant(`listings/0x${'ab'.repeat(32)}.json`, JSON.stringify({ id: 'seen-later' }));
    const release = r2.holdNextList();
    const rebuild = index();
    const others = await Promise.all(Array.from({ length: 100 }, () => index()));
    expect(others.every(({ listings }) => listings.length === 3)).toBe(true);

    release();
    expect((await rebuild).listings).toHaveLength(4);
    expect(r2.calls - calls).toBe(5); // One list, and one read for each of the four listings.
    expect((await index()).listings).toHaveLength(4);
    expect(r2.calls - calls).toBe(5);
  });

  it('lets another rebuild when one never comes back', async () => {
    let now = 1_000_000;
    const { r2, index } = store({ now: () => now });
    await index();
    now += INDEX_SECONDS * 1000;
    r2.plant(`listings/0x${'ab'.repeat(32)}.json`, JSON.stringify({ id: 'seen-later' }));
    r2.holdNextList();
    void index();
    expect((await index()).listings).toEqual([]);

    now += REBUILD_SECONDS * 1000 - 1;
    expect((await index()).listings).toEqual([]);
    now += 1;
    expect((await index()).listings).toHaveLength(1);
  });

  it('keeps the old text for the others when a rebuild fails, and tries again', async () => {
    let now = 1_000_000;
    const { r2, upload, call, index } = store({ now: () => now });
    await upload(zipOf());
    await index();
    now += INDEX_SECONDS * 1000;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const list = r2.list.bind(r2);
    r2.list = () => Promise.reject(new Error('R2 failed'));
    expect((await call('/index.json')).status).toBe(500);
    logged.mockRestore();
    r2.list = list;

    const calls = r2.calls;
    expect((await index()).listings).toHaveLength(1);
    expect(r2.calls).toBe(calls);
    now += REBUILD_SECONDS * 1000;
    await index();
    expect(r2.calls).toBeGreaterThan(calls);
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
    expect(response.headers.get('content-length')).toBe(String(zip.length));
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

describe('HEAD', () => {
  it('says a zip is there and how big, with the headers a GET has and no body', async () => {
    const { upload, call } = store();
    const zip = zipOf();
    const hash = await hashOf(zip);
    await upload(zip);

    const [head, get] = [await call(`/bundles/${hash}.zip`, { method: 'HEAD' }), await call(`/bundles/${hash}.zip`)];
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(zip.length));
    expect(Object.fromEntries(head.headers)).toEqual(Object.fromEntries(get.headers));
    expect(await head.text()).toBe('');
  });

  it('says the index is there and how big, with the headers a GET has and no body', async () => {
    const { upload, call } = store();
    await upload(zipOf());

    const [head, get] = [await call('/index.json', { method: 'HEAD' }), await call('/index.json')];
    expect(head.status).toBe(200);
    expect(Object.fromEntries(head.headers)).toEqual(Object.fromEntries(get.headers));
    expect(await head.text()).toBe('');
    expect(head.headers.get('content-length')).toBe(String((await get.arrayBuffer()).byteLength));
  });

  it('leaves no zip open behind it', async () => {
    const { r2, upload, call } = store();
    const zip = zipOf();
    await upload(zip);
    await call(`/bundles/${await hashOf(zip)}.zip`, { method: 'HEAD' });
    expect(r2.bodiesCancelled).toBe(1);
  });

  it('is a 404 for what GET finds nothing at, with no body', async () => {
    const { call } = store();
    for (const path of [`/bundles/0x${'ab'.repeat(32)}.zip`, '/bundles', '/']) {
      const response = await call(path, { method: 'HEAD' });
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).toBe('');
    }
  });
});

describe('CORS', () => {
  it('answers a read preflight from any origin, for reads alone', async () => {
    const response = await store().call('/index.json', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD');
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
