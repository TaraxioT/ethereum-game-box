// The real thing: `wrangler dev --local` running the Worker on workerd, with Wrangler's local R2 and a token made up
// here, and the real `store:publish` script publishing to it. It proves on the real runtime what the in-memory tests
// can only assume: that an R2 put with `If-None-Match: *` refuses to replace, and that `timingSafeEqual` is there. It
// reaches no network, and never touches a real bucket.

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BUNDLE_LIMITS, type StoreIndex } from '@egb/sdk/bundle';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashOf, zipOf } from '../zips.ts';

const APP = path.join(import.meta.dirname, '../..');
const TAP_RUSH = path.join(APP, 'sample/tap-rush');
const TOKEN = 'a-token-made-up-for-the-live-test';

let wrangler: ChildProcess;
let url: string;
let state: string;

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

/** Waits for Wrangler to say it is ready, and fails with what it said if it stops first. */
const ready = (child: ChildProcess) =>
  new Promise<void>((resolve, reject) => {
    let said = '';
    const listen = (chunk: Buffer) => {
      said += String(chunk);
      if (said.includes('Ready on')) resolve();
    };
    child.stdout?.on('data', listen);
    child.stderr?.on('data', listen);
    child.once('exit', () => reject(new Error(`wrangler stopped:\n${said}`)));
  });

beforeAll(async () => {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  state = mkdtempSync(path.join(tmpdir(), 'egb-store-live-'));
  const args = ['dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state];
  args.push('--var', `STORE_PUBLISH_TOKEN:${TOKEN}`, '--show-interactive-dev-session=false');
  wrangler = spawn('wrangler', args, {
    cwd: APP,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    detached: true,
  });
  await ready(wrangler);
}, 60_000);

afterAll(() => {
  if (wrangler.pid) process.kill(-wrangler.pid);
  rmSync(state, { recursive: true, force: true });
});

const post = (body: RequestInit['body'], token = TOKEN) => {
  const headers = { authorization: `Bearer ${token}` };
  return fetch(`${url}/bundles`, { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
};

const download = async (hash: string) => {
  const response = await fetch(`${url}/bundles/${hash}.zip`);
  return new Uint8Array(await response.arrayBuffer());
};

const index = async () => (await (await fetch(`${url}/index.json`)).json()) as StoreIndex;

const statuses = (responses: Response[]) => responses.map((response) => response.status).sort();

describe('store:publish', () => {
  let hash: string;

  const publish = () =>
    spawnSync(process.execPath, ['scripts/publish.ts', TAP_RUSH], {
      cwd: APP,
      encoding: 'utf8',
      env: { ...process.env, EGB_STORE_URL: url, STORE_PUBLISH_TOKEN: TOKEN, STORE_LISTER_KEY: '' },
    });

  it('publishes Tap Rush and prints its hash', () => {
    const { status, stdout, stderr } = publish();
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('published: Tap Rush (tap-rush)');
    hash = /^0x[0-9a-f]{64}$/m.exec(stdout)?.[0] as string;
    expect(hash).toBeDefined();
    expect(stdout).toContain(`'list(bytes32)' ${hash}`);
  });

  it('downloads it back by that hash, byte for byte', async () => {
    const response = await fetch(`${url}/bundles/${hash}.zip`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await hashOf(new Uint8Array(await response.arrayBuffer()))).toBe(hash);
  });

  it('shows it in the index', async () => {
    expect((await index()).listings).toContainEqual(expect.objectContaining({ id: 'tap-rush', hash, icon: null }));
  });

  it('can be repeated, and says so', () => {
    const { status, stdout } = publish();
    expect(status).toBe(0);
    expect(stdout).toContain('already published: Tap Rush');
  });

  it('fails with the store reason under a wrong token', () => {
    const { status, stderr } = spawnSync(process.execPath, ['scripts/publish.ts', TAP_RUSH], {
      cwd: APP,
      encoding: 'utf8',
      env: { ...process.env, EGB_STORE_URL: url, STORE_PUBLISH_TOKEN: 'wrong' },
    });
    expect(status).toBe(1);
    expect(stderr).toContain('the store refused it (401)');
  });
});

describe('the token, on the real runtime', () => {
  it('lets the right one through and refuses the rest', async () => {
    const zip = zipOf('token-game');
    expect((await post(zip, `${TOKEN}x`)).status).toBe(401);
    expect((await post(zip, TOKEN.slice(0, -1))).status).toBe(401);
    const bare = await fetch(`${url}/bundles`, { method: 'POST', body: zip });
    expect(bare.status).toBe(401);
    expect((await post(zip)).status).toBe(201);
  });
});

describe('the size cap, on the real runtime', () => {
  it('refuses a stated length over the limit', async () => {
    expect((await post(new Uint8Array(BUNDLE_LIMITS.zipBytes + 1))).status).toBe(413);
  });

  it('cuts off a chunked body with no length', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 40) controller.enqueue(chunk);
        else controller.close();
      },
    });
    expect((await post(body)).status).toBe(413);
    expect(sent).toBeLessThan(40);
  });

  it('takes a bundle right at the limit, and gives it back whole', async () => {
    const pixels = new Uint8Array(BUNDLE_LIMITS.zipBytes - 2048);
    pixels.fill(7);
    const zip = zipOf('big-game', 'one', [['big.png', pixels]]);
    expect(zip.length).toBeLessThanOrEqual(BUNDLE_LIMITS.zipBytes);
    const hash = await hashOf(zip);
    expect((await post(zip)).status).toBe(201);
    expect(await hashOf(await download(hash))).toBe(hash);
  });
});

describe('nothing can be overwritten, on the real R2', () => {
  it('refuses a changed zip and an id held by another hash', async () => {
    const first = zipOf('held-game', 'one');
    const hash = await hashOf(first);
    expect((await post(first)).status).toBe(201);

    const changed = first.slice();
    changed[40] = (changed[40] as number) ^ 0xff;
    expect((await post(changed)).status).toBe(400);
    const taken = await post(zipOf('held-game', 'two'));
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toContain(hash);
    expect(await download(hash)).toEqual(first);
  });

  it('has no route that replaces or removes a zip', async () => {
    const zip = zipOf('fixed-game');
    const hash = await hashOf(zip);
    await post(zip);
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const init = { method, headers: { authorization: `Bearer ${TOKEN}` } };
      expect((await fetch(`${url}/bundles/${hash}.zip`, init)).status).toBe(404);
    }
    expect(await download(hash)).toEqual(zip);
  });

  // Parallel, but not a true race: the isolate is single-threaded, and a claim that checked and then wrote still
  // passes here. This shows the real R2 refusing the losers. `overwrite.test.ts` forces the interleaving, and catches
  // that bug.
  it('lets one of many parallel uploads have an id, every time', async () => {
    const rounds = 10;
    const racers = 8;
    for (let round = 0; round < rounds; round++) {
      const id = `race-${round}`;
      const zips = Array.from({ length: racers }, (_, racer) => zipOf(id, `page-${racer}`));
      const responses = await Promise.all(zips.map((zip) => post(zip)));
      const answers = statuses(responses);
      expect(answers.filter((status) => status === 201)).toHaveLength(1);
      expect(answers.filter((status) => status === 409)).toHaveLength(racers - 1);

      const winner = responses.findIndex((response) => response.status === 201);
      for (const [racer, zip] of zips.entries()) {
        const response = await fetch(`${url}/bundles/${await hashOf(zip)}.zip`);
        expect(response.status).toBe(racer === winner ? 200 : 404);
      }
    }
    const races = (await index()).listings.filter((listing) => listing.id.startsWith('race-'));
    expect(races).toHaveLength(rounds);
  });

  it('stores one bundle once when many upload it in parallel', async () => {
    const zip = zipOf('same-game');
    const responses = await Promise.all(Array.from({ length: 6 }, () => post(zip)));
    const answers = statuses(responses);
    expect(answers.filter((status) => status === 201)).toHaveLength(1);
    expect(answers.filter((status) => status === 200)).toHaveLength(5);
    expect(await download(await hashOf(zip))).toEqual(zip);
  });
});
