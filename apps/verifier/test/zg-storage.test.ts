// The real 0G Storage SDK, through `ZgAuditStore`, against the fake's indexer, node and chain over real HTTP.

import { generatePrivateKey } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZgAuditStore } from '../src/zg-storage.ts';
import { type RunningFakeZg, startFakeZg } from './fake-zg/server.ts';

/** Over two of the SDK's 256 KiB segments. */
const RECORD = JSON.stringify({ v: 1, log: 'xé€'.repeat(100_000) });

interface Segment {
  root: string;
  index: number;
  data: string;
  fileSize: number;
}

/** A file put back together from its segments, the last of which is padded to a whole chunk. */
function uploaded(root: string): string {
  const segments = (running.fake.segments as Segment[]).filter((segment) => segment.root === root).sort((a, b) => a.index - b.index);
  const bytes = Buffer.concat(segments.map(({ data }) => Buffer.from(data, 'base64')));
  return bytes.subarray(0, segments[0]?.fileSize).toString();
}

let running: RunningFakeZg;

beforeAll(async () => {
  running = await startFakeZg();
});

afterAll(() => running.close());

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const store = (overrides: { indexerUrl?: string; timeoutMs?: number } = {}) =>
  new ZgAuditStore({ indexerUrl: `${running.url}/indexer`, rpcUrl: `${running.url}/rpc`, key: generatePrivateKey(), timeoutMs: 10_000, ...overrides });

describe('an upload', () => {
  it('pays once, sends the exact text and returns its root', { timeout: 20_000 }, async () => {
    running.fake.settings.storageUp = true;
    const landed = await store().put(RECORD);
    expect(landed.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(landed.tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(running.fake.paidUploads).toBe(1);
    expect(uploaded(landed.root) === RECORD).toBe(true);
  });

  it('does not pay again for a file already stored', { timeout: 20_000 }, async () => {
    await store().put(RECORD);
    const paid = running.fake.paidUploads;
    const landed = await store().put(RECORD);
    expect(running.fake.paidUploads).toBe(paid);
    expect(landed.tx).toBeNull();
  });

  it('rejects when storage is down', async () => {
    running.fake.settings.storageUp = false;
    await expect(store().put(RECORD)).rejects.toThrow('0G Storage answered 503');
    running.fake.settings.storageUp = true;
  });

  it('rejects when the indexer can not be reached', async () => {
    await expect(store({ indexerUrl: 'http://127.0.0.1:9/indexer' }).put(RECORD)).rejects.toThrow();
  });

  it('rejects when its time is up, though the SDK would wait for ever', { timeout: 20_000 }, async () => {
    const stuck = await startFakeZg();
    stuck.fake.settings.nodeSyncs = false;
    const upload = new ZgAuditStore({ indexerUrl: `${stuck.url}/indexer`, rpcUrl: `${stuck.url}/rpc`, key: generatePrivateKey(), timeoutMs: 1500 });
    await expect(upload.put(RECORD)).rejects.toThrow();
    await stuck.close();
  });
});
