// Nothing stored can change: not by a second upload, not by two racing ones, and not through any other route. The
// in-memory R2 throws on a put that isn't conditional, so every test here also proves each write says "only if absent".

import { describe, expect, it } from 'vitest';

import { store } from './harness.ts';
import { hashOf, zipOf } from './zips.ts';

describe('uploading what is already there', () => {
  it('answers 200 with the same listing and writes nothing', async () => {
    const { r2, upload } = store();
    const zip = zipOf();
    const first = await (await upload(zip)).json();
    const writes = r2.writes.length;
    const again = await upload(zip);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(r2.writes.length).toBe(writes);
  });

  it('leaves an object in place even if it differs from what the upload would write', async () => {
    const { r2, upload } = store();
    const zip = zipOf();
    const hash = await hashOf(zip);
    r2.plant(`bundles/${hash}.zip`, 'planted zip');
    r2.plant(`listings/${hash}.json`, '{"planted":true}');
    await upload(zip);
    expect(new TextDecoder().decode(r2.objects.get(`bundles/${hash}.zip`))).toBe('planted zip');
    expect(new TextDecoder().decode(r2.objects.get(`listings/${hash}.json`))).toBe('{"planted":true}');
  });
});

describe('two racing uploads', () => {
  it('of one id with different hashes: one wins, and the other leaves nothing', async () => {
    const { r2, upload, index } = store();
    const zips = [zipOf('tap-rush', 'one'), zipOf('tap-rush', 'two')];
    const hashes = await Promise.all(zips.map(hashOf));
    r2.holdPuts('ids/', 2); // Both have passed every check before either writes.

    const responses = await Promise.all(zips.map((zip) => upload(zip)));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);

    const winner = hashes[responses.findIndex((response) => response.status === 201)] as string;
    const loser = hashes.find((hash) => hash !== winner) as string;
    expect(r2.keys()).toEqual([`bundles/${winner}.zip`, 'ids/tap-rush', `listings/${winner}.json`]);
    expect(r2.keys().some((key) => key.includes(loser))).toBe(false);
    expect((await index()).listings.map((listing) => listing.hash)).toEqual([winner]);
  });

  it('of the same bundle: each key is written once, and both are told it stands', async () => {
    const { r2, upload } = store();
    const zip = zipOf();
    const hash = await hashOf(zip);
    r2.holdPuts('bundles/', 2);

    const responses = await Promise.all([upload(zip), upload(zip)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(r2.writes.sort()).toEqual([`bundles/${hash}.zip`, 'ids/test-game', `listings/${hash}.json`]);
  });

  it('of the same bundle, many at once, still write each key once', async () => {
    const { r2, upload } = store();
    const zip = zipOf();
    r2.holdPuts('ids/', 5);
    const responses = await Promise.all(Array.from({ length: 5 }, () => upload(zip)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(4);
    expect(r2.writes).toHaveLength(3);
  });
});

describe('an upload that dies part way', () => {
  it('after the id leaves no listing, and the same upload finishes it', async () => {
    const { r2, upload, index } = store();
    const zip = zipOf();
    r2.failNextPut('bundles/');
    expect((await upload(zip)).status).toBe(500);
    expect((await index()).listings).toEqual([]);

    expect((await upload(zip)).status).toBe(201);
    expect((await index()).listings).toHaveLength(1);
  });

  it('after the zip leaves no listing, and the same upload finishes it', async () => {
    const { r2, upload, index } = store();
    const zip = zipOf();
    r2.failNextPut('listings/');
    expect((await upload(zip)).status).toBe(500);
    expect((await index()).listings).toEqual([]);

    expect((await upload(zip)).status).toBe(201);
    expect((await index()).listings).toHaveLength(1);
  });

  it('still holds the id against another hash', async () => {
    const { r2, upload } = store();
    r2.failNextPut('bundles/');
    await upload(zipOf('tap-rush', 'one'));
    expect((await upload(zipOf('tap-rush', 'two'))).status).toBe(409);
  });
});

describe('every other way in', () => {
  it('is a 404 that changes nothing', async () => {
    const { r2, upload, call } = store();
    const zip = zipOf();
    const hash = await hashOf(zip);
    await upload(zip);
    const before = new Map(r2.objects);
    const writes = r2.writes.length;

    const paths = [`/bundles/${hash}.zip`, `/listings/${hash}.json`, '/index.json', '/ids/test-game', '/bundles'];
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      for (const path of paths) {
        const response = await call(path, { method, body: method === 'DELETE' ? null : zip });
        expect(response.status).toBe(404);
      }
    }
    for (const path of paths.filter((path) => path !== '/bundles')) {
      expect((await call(path, { method: 'POST', body: zip })).status).toBe(404);
    }
    expect(r2.objects).toEqual(before);
    expect(r2.writes.length).toBe(writes);
  });
});
