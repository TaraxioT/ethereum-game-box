// `pnpm store:publish`: what it sends, what it prints, and when it lists on chain. The store is a fake `fetch` and the
// chain a fake node, so no test touches a network; `test/live` runs the real thing against a real Worker.

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type StoreListing, listingOf, readBundle } from '@egb/sdk/bundle';
import { type Address, type Hex, custom, decodeFunctionData, encodeAbiParameters, parseAbi, parseTransaction } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFolder } from '../../scripts/folder.ts';
import { listCommand, listOnChain } from '../../scripts/list.ts';
import { type PublishOptions, publish } from '../../scripts/publisher.ts';

const TAP_RUSH = path.join(import.meta.dirname, '../../sample/tap-rush');
const POT: Address = '0x00000000000000000000000000000000000000a1';
// Anvil's first well-known key, public and worth nothing.
const LISTER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const HASH: Hex = `0x${'ab'.repeat(32)}`;

interface FakeNode {
  sent: Hex[];
  listed: boolean;
  status: Hex;
}

/** A Sepolia node that answers just what a `list` needs, and keeps what is sent to it. */
function fakeNode(node: FakeNode) {
  const answers: Record<string, () => unknown> = {
    eth_chainId: () => '0xaa36a7',
    eth_getTransactionCount: () => '0x7',
    eth_estimateGas: () => '0x5208',
    eth_maxPriorityFeePerGas: () => '0x1',
    eth_gasPrice: () => '0x1',
    eth_blockNumber: () => '0x10',
    eth_getBlockByNumber: () => ({ number: '0x10', baseFeePerGas: '0x1', hash: HASH, timestamp: '0x1', transactions: [] }),
    eth_call: () => encodeAbiParameters([{ type: 'bool' }], [node.listed]),
    eth_getTransactionByHash: () => null,
    eth_getTransactionReceipt: () => ({
      status: node.status,
      transactionHash: HASH,
      blockNumber: '0x1',
      blockHash: HASH,
      logs: [],
      cumulativeGasUsed: '0x1',
      gasUsed: '0x1',
      effectiveGasPrice: '0x1',
      type: '0x2',
      from: POT,
      to: POT,
      contractAddress: null,
      logsBloom: `0x${'00'.repeat(256)}`,
      transactionIndex: '0x0',
    }),
  };
  return custom(
    {
      async request({ method, params }: { method: string; params: unknown[] }) {
        if (method === 'eth_sendRawTransaction') {
          node.sent.push(params[0] as Hex);
          return HASH;
        }
        const answer = answers[method];
        if (!answer) throw new Error(`the fake node has no ${method}`);
        return answer();
      },
    },
    { retryCount: 0 },
  );
}

const newNode = (over: Partial<FakeNode> = {}): FakeNode => ({ sent: [], listed: false, status: '0x1', ...over });

/** A fake store that answers as the real one does, keeping what it was sent. */
function fakeStore(status = 201) {
  const seen: { url: string; authorization: string | null; zip: Uint8Array }[] = [];
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    const zip = init.body as Uint8Array;
    seen.push({ url: String(url), authorization: new Headers(init.headers).get('authorization'), zip });
    const listing: StoreListing = listingOf(await readBundle(zip), zip.length);
    return Response.json(status < 300 ? listing : { error: 'the reason' }, { status });
  });
  vi.stubGlobal('fetch', fetcher);
  return seen;
}

function options(over: Partial<PublishOptions> = {}) {
  const lines: string[] = [];
  const all: PublishOptions = {
    folder: TAP_RUSH,
    storeUrl: 'http://store.test',
    token: 'the-token',
    pot: undefined,
    listerKey: undefined,
    transport: undefined,
    print: (line) => lines.push(line),
    ...over,
  };
  return { all, lines };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readFolder', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'egb-store-'));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true });
  });

  it('reads nested files by their path inside the folder', async () => {
    await mkdir(path.join(folder, 'assets/img'), { recursive: true });
    await writeFile(path.join(folder, 'index.html'), 'page');
    await writeFile(path.join(folder, 'assets/img/dot.png'), 'dot');
    const files = await readFolder(folder);
    expect([...files.keys()].sort()).toEqual(['assets/img/dot.png', 'index.html']);
    expect(new TextDecoder().decode(files.get('assets/img/dot.png'))).toBe('dot');
  });

  it('refuses a link, which could reach outside the folder', async () => {
    await symlink('/etc/hosts', path.join(folder, 'hosts.html'));
    await expect(readFolder(folder)).rejects.toThrow("hosts.html isn't a plain file");
  });

  it('refuses a missing folder', async () => {
    await expect(readFolder(path.join(folder, 'nope'))).rejects.toThrow();
  });
});

describe('publish', () => {
  it('posts the packed folder with the token, and prints the hash', async () => {
    const seen = fakeStore();
    const { all, lines } = options();
    await publish(all);

    const [sent] = seen;
    expect(sent?.url).toBe('http://store.test/bundles');
    expect(sent?.authorization).toBe('Bearer the-token');
    const { hash, manifest } = await readBundle(sent?.zip as Uint8Array);
    expect(manifest.id).toBe('tap-rush');
    expect(lines).toContain(hash);
    expect(lines[0]).toContain('published: Tap Rush (tap-rush)');
  });

  it('says so when the bundle was already published', async () => {
    fakeStore(200);
    const { all, lines } = options();
    await publish(all);
    expect(lines[0]).toContain('already published');
  });

  it('fails with the store reason when refused, and lists nothing', async () => {
    fakeStore(409);
    const node = newNode();
    const { all } = options({ pot: POT, listerKey: LISTER_KEY, transport: fakeNode(node) });
    await expect(publish(all)).rejects.toThrow('the store refused it (409): the reason');
    expect(node.sent).toEqual([]);
  });

  it('fails when the store answers with another hash', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ hash: HASH }, { status: 201 }));
    const { all } = options();
    await expect(publish(all)).rejects.toThrow(`the store says ${HASH}`);
  });

  it('needs the store URL and the token', async () => {
    await expect(publish(options({ storeUrl: undefined }).all)).rejects.toThrow('EGB_STORE_URL is not set');
    await expect(publish(options({ token: undefined }).all)).rejects.toThrow('STORE_PUBLISH_TOKEN is not set');
  });

  it('refuses a folder the packer refuses, before any upload', async () => {
    const seen = fakeStore();
    const { all } = options({ folder: path.join(TAP_RUSH, '..') });
    await expect(publish(all)).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});

describe('listing on chain', () => {
  it('prints the command, with a placeholder, before StorePot is deployed', async () => {
    fakeStore();
    const { all, lines } = options({ listerKey: LISTER_KEY, transport: fakeNode(newNode()) });
    await publish(all);
    expect(lines.join('\n')).toContain("StorePot isn't deployed");
    expect(lines.at(-1)).toContain(`cast send <StorePot> 'list(bytes32)' 0x`);
  });

  it('prints the command when there is no key', async () => {
    fakeStore();
    const node = newNode();
    const { all, lines } = options({ pot: POT, transport: fakeNode(node) });
    await publish(all);
    expect(lines.at(-1)).toContain(`cast send ${POT} 'list(bytes32)' 0x`);
    expect(node.sent).toEqual([]);
  });

  it('prints the command when there is no node', async () => {
    fakeStore();
    const { all, lines } = options({ pot: POT, listerKey: LISTER_KEY });
    await publish(all);
    expect(lines.at(-1)).toContain(`cast send ${POT}`);
  });

  it('never prints the RPC URL in the command', () => {
    expect(listCommand(POT, HASH)).toContain('--rpc-url "$SEPOLIA_RPC_URL"');
  });

  it('sends list(hash) to StorePot on Sepolia, given a pot, a key and a node', async () => {
    const seen = fakeStore();
    const node = newNode();
    const { all, lines } = options({ pot: POT, listerKey: LISTER_KEY, transport: fakeNode(node) });
    await publish(all);

    const { hash } = await readBundle(seen[0]?.zip as Uint8Array);
    expect(node.sent).toHaveLength(1);
    const tx = parseTransaction(node.sent[0] as Hex);
    expect(tx.to).toBe(POT);
    expect(tx.chainId).toBe(11155111);
    const call = decodeFunctionData({ abi: parseAbi(['function list(bytes32 bundle)']), data: tx.data as Hex });
    expect(call).toEqual({ functionName: 'list', args: [hash] });
    expect(lines.at(-1)).toBe(`listed on StorePot: ${HASH}`);
  });

  it('sends nothing for a hash already listed', async () => {
    fakeStore();
    const node = newNode({ listed: true });
    const { all, lines } = options({ pot: POT, listerKey: LISTER_KEY, transport: fakeNode(node) });
    await publish(all);
    expect(node.sent).toEqual([]);
    expect(lines.at(-1)).toBe('already listed on StorePot');
  });

  it('fails when the listing reverts', async () => {
    await expect(listOnChain(fakeNode(newNode({ status: '0x0' })), LISTER_KEY, POT, HASH)).rejects.toThrow(
      'the listing reverted',
    );
  });

  it('refuses a malformed key without quoting it', async () => {
    fakeStore();
    for (const listerKey of ['not-a-key', `0x${'ab'.repeat(31)}`, `0x${'zz'.repeat(32)}`]) {
      const { all } = options({ pot: POT, listerKey, transport: fakeNode(newNode()) });
      const error = await publish(all).then(
        () => null,
        (reason: unknown) => reason as Error,
      );
      expect(error?.message).toBe('STORE_LISTER_KEY must be 0x and 64 hex digits');
    }
  });
});
