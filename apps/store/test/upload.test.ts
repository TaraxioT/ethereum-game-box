// Every refusal of `POST /bundles`, each leaving the bucket as it found it.

import { BUNDLE_LIMITS } from '@egb/sdk/bundle';
import { describe, expect, it } from 'vitest';

import { TOKEN, countedBody, hashOf, store, zipOf } from './harness.ts';

const LISTING_FIELDS = ['blurb', 'hash', 'icon', 'id', 'players', 'size', 'stakes', 'title'];

describe('a good upload', () => {
  it('stores the zip, its listing and its id, and answers with the listing', async () => {
    const { r2, upload } = store();
    const zip = zipOf();
    const hash = await hashOf(zip);
    const response = await upload(zip);
    expect(response.status).toBe(201);
    const listing = await response.json<Record<string, unknown>>();
    expect(Object.keys(listing).sort()).toEqual(LISTING_FIELDS);
    expect(listing).toMatchObject({ id: 'test-game', hash, size: zip.length, icon: null, stakes: [5, 10, 25] });
    expect(r2.keys()).toEqual([`bundles/${hash}.zip`, 'ids/test-game', `listings/${hash}.json`]);
    expect(r2.objects.get(`bundles/${hash}.zip`)).toEqual(zip);
  });

  it('writes the zip before the listing, so a listing never points at nothing', async () => {
    const { r2, upload } = store();
    await upload(zipOf());
    expect(r2.writes.map((key) => key.split('/')[0])).toEqual(['ids', 'bundles', 'listings']);
  });

  it('takes a chunked body with no length', async () => {
    const zip = zipOf();
    const { body } = countedBody([zip.subarray(0, 10), zip.subarray(10)]);
    expect((await store().upload(body)).status).toBe(201);
  });
});

describe('the token', () => {
  const refused = async (authorization: string | null) => {
    const { r2, call } = store();
    const { body, seen } = countedBody([zipOf()]);
    const headers = authorization === null ? undefined : { authorization };
    const response = await call('/bundles', { method: 'POST', body: body, headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'a bad publish token' });
    expect(r2.keys()).toEqual([]);
    expect(seen.pulled).toBeLessThanOrEqual(1); // A stream fills its first chunk by itself; nobody asked for more.
  };

  it('is refused when missing', () => refused(null));
  it('is refused when wrong', () => refused('Bearer not-the-token'));
  it('is refused when only a prefix of the real one', () => refused(`Bearer ${TOKEN.slice(0, -1)}`));
  it('is refused when longer than the real one', () => refused(`Bearer ${TOKEN}x`));
  it('is refused when empty', () => refused('Bearer '));
  it('is refused with no scheme', () => refused(TOKEN));
  it('is refused under another scheme', () => refused(`Basic ${TOKEN}`));
  it('is refused in the wrong case of scheme', () => refused(`bearer ${TOKEN}`));

  it('turns uploads off when the secret is not set, even for an empty bearer', async () => {
    for (const token of ['', null]) {
      const { r2, call } = store({ token });
      const headers = { authorization: 'Bearer ' };
      expect((await call('/bundles', { method: 'POST', body: zipOf(), headers })).status).toBe(503);
      expect(r2.keys()).toEqual([]);
    }
  });
});

describe('the size cap', () => {
  const big = () => new Uint8Array(BUNDLE_LIMITS.zipBytes + 1);

  it('refuses a stated length over the limit without reading a byte more', async () => {
    const { r2, upload } = store();
    const { body, seen } = countedBody([big()]);
    const response = await upload(body, {
      'content-length': String(BUNDLE_LIMITS.zipBytes + 1),
    });
    expect(response.status).toBe(413);
    expect(seen.pulled).toBeLessThanOrEqual(1);
    expect(r2.keys()).toEqual([]);
  });

  it('cuts off a chunked body the moment it passes the limit', async () => {
    const { r2, upload } = store();
    const chunk = new Uint8Array(1024 * 1024);
    const chunks = Array.from({ length: 64 }, () => chunk);
    const { body, seen } = countedBody(chunks);
    expect((await upload(body)).status).toBe(413);
    expect(seen.cancelled).toBe(true);
    expect(seen.pulled).toBeLessThan(20);
    expect(r2.keys()).toEqual([]);
  });

  it('counts the bytes when the stated length is a lie', async () => {
    const { r2, upload } = store();
    const { body, seen } = countedBody([big(), big()]);
    expect((await upload(body, { 'content-length': '10' })).status).toBe(413);
    expect(seen.cancelled).toBe(true);
    expect(r2.keys()).toEqual([]);
  });

  it('lets a body of exactly the limit through to the reader', async () => {
    const response = await store().upload(new Uint8Array(BUNDLE_LIMITS.zipBytes));
    expect(response.status).toBe(400);
  });
});

describe('the reader', () => {
  const refused = async (body: Uint8Array) => {
    const { r2, upload } = store();
    const response = await upload(body);
    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).not.toBe('');
    expect(r2.keys()).toEqual([]);
  };

  it('refuses an empty body', () => refused(new Uint8Array()));

  it('refuses no body at all', async () => {
    const { r2, call } = store();
    const headers = { authorization: `Bearer ${TOKEN}` };
    expect((await call('/bundles', { method: 'POST', headers })).status).toBe(400);
    expect(r2.keys()).toEqual([]);
  });

  it('refuses bytes that are no zip', () => refused(new TextEncoder().encode('this is not a zip')));

  it('refuses a zip with one byte changed', () => {
    const zip = zipOf();
    zip[40] = (zip[40] as number) ^ 0xff;
    return refused(zip);
  });

  it('refuses a zip with a byte added on the end', () => {
    const zip = zipOf();
    const longer = new Uint8Array(zip.length + 1);
    longer.set(zip);
    return refused(longer);
  });
});

describe('an id', () => {
  it('held by another hash is refused, and the second bundle leaves nothing', async () => {
    const { r2, upload } = store();
    const first = zipOf('tap-rush', 'one');
    const second = zipOf('tap-rush', 'two');
    const firstHash = await hashOf(first);
    await upload(first);
    const before = r2.keys();

    const response = await upload(second);
    expect(response.status).toBe(409);
    expect((await response.json<{ error: string }>()).error).toContain(firstHash);
    expect(r2.keys()).toEqual(before);
  });

  it('is free for a new version under a new id', async () => {
    const { upload, index } = store();
    await upload(zipOf('tap-rush', 'one'));
    expect((await upload(zipOf('tap-rush-2', 'two'))).status).toBe(201);
    expect((await index()).listings.map((listing) => listing.id)).toEqual(['tap-rush', 'tap-rush-2']);
  });
});
