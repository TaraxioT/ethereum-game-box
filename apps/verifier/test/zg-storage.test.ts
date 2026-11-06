// The real 0G Storage SDK, through `ZgAuditStore`, against the fake's indexer, node and chain over real HTTP.

import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Paying } from '../src/audit-store.ts';
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

const unpaid: Paying = { paid: null, onPaid: async () => undefined };
/** Long enough to pay, even on a busy machine, before giving up on a node that won't sync. */
const STUCK_MS = 2500;

describe('a retry', () => {
  let fake: RunningFakeZg;

  beforeEach(async () => {
    fake = await startFakeZg();
  });

  afterEach(() => fake.close());

  const upload = (timeoutMs = 10_000) =>
    new ZgAuditStore({ indexerUrl: `${fake.url}/indexer`, rpcUrl: `${fake.url}/rpc`, key: generatePrivateKey(), timeoutMs });

  /** Pays, then gives up on a node that won't sync. Returns the payment. */
  async function paidAndStuck(): Promise<Hex> {
    const onPaid = vi.fn(async () => undefined);
    fake.fake.settings.nodeSyncs = false;
    await expect(upload(STUCK_MS).put(RECORD, { paid: null, onPaid })).rejects.toThrow();
    expect(onPaid).toHaveBeenCalledOnce();
    return (onPaid.mock.calls as unknown as [Hex][])[0]?.[0] as Hex;
  }

  it('hears of a payment the moment it leaves', { timeout: 20_000 }, async () => {
    const onPaid = vi.fn(async () => undefined);
    const landed = await upload().put(RECORD, { paid: null, onPaid });
    expect(onPaid).toHaveBeenCalledExactlyOnceWith(landed.tx);
  });

  it.each([
    ['knows of a payment', (tx: Hex): Hex | null => tx],
    ['lost track of a payment', (): Hex | null => null],
  ])("doesn't pay again when a node's file read fails, and it %s", { timeout: 20_000 }, async (_name, known) => {
    const first = await upload().put(RECORD, unpaid);
    fake.fake.settings.fileInfoFailsOn = 1;
    await expect(upload().put(RECORD, { ...unpaid, paid: known(first.tx as Hex) })).rejects.toThrow();
    expect(fake.fake.paidUploads).toBe(1);
  });

  it("doesn't pay when the SDK's own read fails after a good one here", { timeout: 20_000 }, async () => {
    const first = await upload().put(RECORD, unpaid);
    fake.fake.settings.fileInfoFailsOn = 2;
    await expect(upload().put(RECORD, { ...unpaid, paid: first.tx })).rejects.toThrow();
    expect(fake.fake.paidUploads).toBe(1);
  });

  it.each([['mined'], ['pending']] as const)("doesn't pay again while a node hasn't seen a payment that is %s", { timeout: 20_000 }, async (payment) => {
    const paid = await paidAndStuck();
    fake.fake.settings.payment = payment;
    await expect(upload().put(RECORD, { ...unpaid, paid })).rejects.toThrow('the upload is paid for, and the node has not seen it');
    expect(fake.fake.paidUploads).toBe(1);
  });

  it.each([['reverted'], ['gone']] as const)('pays again for a payment that %s', { timeout: 20_000 }, async (payment) => {
    const paid = await paidAndStuck();
    fake.fake.settings.payment = payment;
    const onPaid = vi.fn(async () => undefined);
    await expect(upload(STUCK_MS).put(RECORD, { paid, onPaid })).rejects.toThrow();
    expect(fake.fake.paidUploads).toBe(2);
    expect(onPaid).toHaveBeenCalledOnce();
  });

  it('finishes the upload for a payment that lands late, paying nothing', { timeout: 20_000 }, async () => {
    const paid = await paidAndStuck();
    fake.fake.settings.nodeSyncs = true;
    const landed = await upload().put(RECORD, { ...unpaid, paid });
    expect(fake.fake.paidUploads).toBe(1);
    expect(landed.tx).toBeNull();
  });
});

describe('an upload', () => {
  it('pays once, sends the exact text and returns its root', { timeout: 20_000 }, async () => {
    running.fake.settings.storageUp = true;
    const landed = await store().put(RECORD, unpaid);
    expect(landed.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(landed.tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(running.fake.paidUploads).toBe(1);
    expect(uploaded(landed.root) === RECORD).toBe(true);
  });

  it('does not pay again for a file already stored', { timeout: 20_000 }, async () => {
    await store().put(RECORD, unpaid);
    const paid = running.fake.paidUploads;
    const landed = await store().put(RECORD, unpaid);
    expect(running.fake.paidUploads).toBe(paid);
    expect(landed.tx).toBeNull();
  });

  it('rejects when storage is down', async () => {
    running.fake.settings.storageUp = false;
    await expect(store().put(RECORD, unpaid)).rejects.toThrow('0G Storage answered 503');
    running.fake.settings.storageUp = true;
  });

  it('rejects when the indexer can not be reached', async () => {
    await expect(store({ indexerUrl: 'http://127.0.0.1:9/indexer' }).put(RECORD, unpaid)).rejects.toThrow();
  });

  it('rejects when its time is up, though the SDK would wait for ever', { timeout: 20_000 }, async () => {
    const stuck = await startFakeZg();
    stuck.fake.settings.nodeSyncs = false;
    const upload = new ZgAuditStore({ indexerUrl: `${stuck.url}/indexer`, rpcUrl: `${stuck.url}/rpc`, key: generatePrivateKey(), timeoutMs: 1500 });
    await expect(upload.put(RECORD, unpaid)).rejects.toThrow();
    await stuck.close();
  });
});
