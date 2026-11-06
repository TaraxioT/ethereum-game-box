// A fake of everything the verifier touches at 0G, so no test spends a cent of the real account: the Router's chat
// endpoint, a provider's signature endpoint, the serving contract on 0G's chain, and 0G Storage's indexer, node and
// chain. It runs as a `fetch` in a test, or as an HTTP server for an end-to-end run (`pnpm --filter @egb/verifier
// fake-zg`, see `main.ts`). Its keys are made up at start and guard nothing.
//
// Paths, under its base URL:
// - `POST /v1/chat/completions`, `GET /v1/proxy/signature/<chat id>`: the Router and the provider. `ZG_BASE_URL` is
//   `<base>/v1`.
// - `POST /rpc`: 0G's chain. `ZG_RPC` and `ZG_STORAGE_RPC` are `<base>/rpc`.
// - `POST /indexer`, `POST /node`: 0G Storage. `ZG_STORAGE_INDEXER` is `<base>/indexer`.
// - `POST /__fake`: sets `FakeZgSettings` fields from a JSON body. `GET /__fake`: what it has seen.

import { type Address, type Hex, decodeFunctionData, encodeFunctionResult, keccak256, pad } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { servingAbi } from '../../src/zg-chain.ts';

/** How the next replies go wrong, if they do. */
export type ChatFault = 'none' | 'down' | 'error' | 'unsealed' | 'no-chat-id' | 'no-provider' | 'bad-signature' | 'no-signature';

export interface FakeZgSettings {
  chat: ChatFault;
  /** What `submit_verdict` says: a split, or `cannot_judge` while null. */
  payouts: string[] | null;
  /** Shell calls the agent makes before its verdict. */
  shellTurns: number;
  /** What it runs in them. Their output comes back in `GET /__fake`, so a harness can probe the container from inside. */
  shellCommand: string;
  /** The provider's record. */
  verifiability: string;
  acknowledged: boolean;
  additionalInfo: string;
  /** Whether 0G Storage answers. */
  storageUp: boolean;
  /** Whether the node ever sees the paid-for file. If not, the SDK waits on it for ever. */
  nodeSyncs: boolean;
}

/** One chat call, as it reached the fake. */
export interface SeenChat {
  readonly authorization: string | null;
  readonly trustMode: string | null;
  readonly body: Record<string, unknown>;
}

export const SERVING_CONTRACT: Address = '0x00000000000000000000000000000000000000d1';
export const SERVICE_MODEL = '0GM-1.0-35B-A3B';

const FLOW: Address = '0x00000000000000000000000000000000000000d2';
const MARKET: Address = '0x00000000000000000000000000000000000000d3';
const MARKET_SELECTOR = '0x80f55605';
const CHAIN_ID = '0x4115';
/** The size every file claims: the uploader asks for segments up to it, and stops at the file's real end. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);

type RpcCall = { id: unknown; method: string; params?: unknown[] };

export class FakeZg {
  /** The fake's own base URL: set it to the server's, and a provider's record points back here. */
  url = 'http://zg.fake';
  readonly provider = privateKeyToAccount(generatePrivateKey()).address;
  readonly chats: SeenChat[] = [];
  /** Audit records uploaded, as base64 segments. */
  readonly segments: unknown[] = [];
  readonly settings: FakeZgSettings = {
    chat: 'none',
    payouts: null,
    shellTurns: 1,
    shellCommand: 'jq .header log.json',
    verifiability: 'TeeML',
    acknowledged: true,
    additionalInfo: '{}',
    storageUp: true,
    nodeSyncs: true,
  };

  private readonly enclave = privateKeyToAccount(generatePrivateKey());
  private readonly stranger = privateKeyToAccount(generatePrivateKey());
  private readonly signed = new Map<string, string>();
  /** Storage transactions so far. */
  private submissions = 0;
  /** Files with a transaction, by root. The chain's calldata stays unread: the next unknown root asked about takes it. */
  private readonly files = new Set<string>();

  /** The enclave's address, as the provider's record gives it. */
  get teeSigner(): Address {
    return this.enclave.address;
  }

  /** A `fetch` that only knows this fake. `down` fails the way an unreachable host does. */
  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (this.settings.chat === 'down' && new URL(request.url).pathname.startsWith('/v1/')) throw new TypeError('fetch failed');
    return this.handle(request);
  };

  async handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname === '/v1/chat/completions') return this.chat(request);
    if (request.method === 'GET' && pathname.startsWith('/v1/proxy/signature/')) return this.signature(pathname);
    if (request.method === 'POST' && (pathname === '/rpc' || pathname === '/indexer' || pathname === '/node')) {
      return this.rpc(pathname, (await request.json()) as RpcCall | RpcCall[]);
    }
    if (pathname === '/__fake') {
      if (request.method === 'POST') Object.assign(this.settings, await request.json());
      return json({ settings: this.settings, chats: this.chats.length, segments: this.segments.length, shellOutput: this.shellOutput() });
    }
    return json({ error: 'not found' }, { status: 404 });
  }

  /** What the last shell call printed, as the agent sent it back. */
  private shellOutput(): unknown {
    const messages = (this.chats.at(-1)?.body.messages ?? []) as { role?: string; content?: unknown }[];
    return messages.findLast(({ role }) => role === 'tool')?.content ?? null;
  }

  private async chat(request: Request): Promise<Response> {
    const { chat, payouts, shellTurns } = this.settings;
    const body = (await request.json()) as Record<string, unknown>;
    const seen = {
      authorization: request.headers.get('authorization'),
      trustMode: request.headers.get('x-0g-provider-trust-mode'),
      body,
    };
    this.chats.push(seen);
    if (chat === 'down') return json({ error: 'down' }, { status: 503 });
    if (chat === 'error') return json({ error: 'the provider failed' }, { status: 500 });

    const id = `chatcmpl-${crypto.randomUUID()}`;
    this.signed.set(id, `zg-sig-v1/e2ee-ct:${keccak256(`0x${id.length.toString(16).padStart(2, '0')}`)}:${keccak256('0x00')}`);
    const headers = new Headers();
    if (chat !== 'unsealed') headers.set('x-0g-e2ee', 'sealed');
    if (chat !== 'no-chat-id') headers.set('zg-res-key', id);
    const turnsSoFar = (body.messages as unknown[]).filter((message) => (message as { role?: string }).role === 'tool').length;
    const call =
      turnsSoFar < shellTurns
        ? { name: 'shell', arguments: JSON.stringify({ command: this.settings.shellCommand }) }
        : {
            name: 'submit_verdict',
            arguments: JSON.stringify(
              payouts ? { kind: 'split', payouts, why: 'Most taps takes the pot.' } : { kind: 'cannot_judge', why: 'The log has no taps.' },
            ),
          };
    return json(
      {
        id,
        choices: [
          {
            finish_reason: 'tool_calls',
            message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${id}`, type: 'function', function: call }] },
          },
        ],
        usage: { total_tokens: 100 },
        x_0g_trace: { billing: { total: '10' }, request_id: id, ...(chat !== 'no-provider' && { provider: this.provider }) },
      },
      { headers },
    );
  }

  private async signature(pathname: string): Promise<Response> {
    const { chat } = this.settings;
    const text = this.signed.get(decodeURIComponent(pathname.slice('/v1/proxy/signature/'.length)));
    if (!text || chat === 'no-signature') return json({ error: 'no signature' }, { status: 404 });
    const account = chat === 'bad-signature' ? this.stranger : this.enclave;
    return json({ text, signature: await account.signMessage({ message: text }), signing_address: this.enclave.address, signing_algo: 'ecdsa' });
  }

  private rpc(pathname: string, body: RpcCall | RpcCall[]): Response {
    if (pathname !== '/rpc' && !this.settings.storageUp) return json({ error: 'storage is down' }, { status: 503 });
    const one = ({ id, method, params = [] }: RpcCall) => {
      try {
        return { jsonrpc: '2.0', id, result: this.answer(pathname, method, params) };
      } catch (error) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: String(error) } };
      }
    };
    return json(Array.isArray(body) ? body.map(one) : one(body));
  }

  private answer(pathname: string, method: string, params: unknown[]): unknown {
    if (pathname === '/indexer') return this.indexer(method);
    if (pathname === '/node') return this.node(method, params);
    return this.chain(method, params);
  }

  private indexer(method: string): unknown {
    if (method !== 'indexer_getShardedNodes') throw new Error(`no fake for ${method}`);
    return { trusted: [{ url: `${this.url}/node`, config: { numShard: 1, shardId: 0 }, latency: 1, since: 0 }], discovered: [] };
  }

  private node(method: string, params: unknown[]): unknown {
    switch (method) {
      case 'zgs_getStatus':
        return {
          connectedPeers: 1,
          logSyncHeight: 1,
          logSyncBlock: `0x${'00'.repeat(32)}`,
          nextTxSeq: 8,
          networkIdentity: { chainId: 16661, flowAddress: FLOW, p2pProtocolVersion: { major: 0, minor: 4, build: 0 } },
        };
      case 'zgs_getShardConfig':
        return { numShard: 1, shardId: 0 };
      case 'zgs_getFileInfo':
        return this.fileInfo(params[0] as Hex);
      case 'zgs_uploadSegmentsByTxSeq':
        this.segments.push(...(params[0] as unknown[]));
        return null;
      default:
        throw new Error(`no fake for ${method}`);
    }
  }

  private fileInfo(root: Hex) {
    if (!this.settings.nodeSyncs) return null;
    if (!this.files.has(root) && this.files.size < this.submissions) this.files.add(root);
    if (!this.files.has(root)) return null;
    const uploadedSegNum = (this.segments as { root?: string }[]).filter((segment) => segment.root === root).length;
    return {
      tx: { streamIds: [], data: '', dataMerkleRoot: root, merkleNodes: [], startEntryIndex: 0, size: MAX_FILE_BYTES, seq: 7 },
      finalized: uploadedSegNum > 0,
      isCached: false,
      uploadedSegNum,
      pruned: false,
    };
  }

  private chain(method: string, params: unknown[]): unknown {
    switch (method) {
      case 'eth_chainId':
        return CHAIN_ID;
      case 'eth_blockNumber':
        return '0x10';
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_getTransactionCount':
        return `0x${this.submissions.toString(16)}`;
      case 'eth_estimateGas':
        return '0x30000';
      case 'eth_getBlockByNumber':
        return {
          number: '0x10',
          hash: `0x${'33'.repeat(32)}`,
          parentHash: `0x${'44'.repeat(32)}`,
          timestamp: '0x1',
          gasLimit: '0xffffff',
          gasUsed: '0x0',
          miner: `0x${'00'.repeat(20)}`,
          difficulty: '0x0',
          nonce: '0x0000000000000000',
          extraData: '0x',
          baseFeePerGas: '0x1',
          transactions: [],
        };
      case 'eth_call':
        return this.call(params[0] as { to: Address; data: Hex });
      case 'eth_sendRawTransaction':
        this.submissions += 1;
        return keccak256(params[0] as Hex);
      default:
        throw new Error(`no fake for ${method}`);
    }
  }

  private call({ to, data }: { to: Address; data: Hex }): Hex {
    if (to.toLowerCase() !== SERVING_CONTRACT) return data.startsWith(MARKET_SELECTOR) ? pad(MARKET) : pad('0x01');
    const { args } = decodeFunctionData({ abi: servingAbi, data });
    const { verifiability, acknowledged, additionalInfo } = this.settings;
    return encodeFunctionResult({
      abi: servingAbi,
      functionName: 'getService',
      result: {
        provider: args[0],
        serviceType: 'chatbot',
        url: this.url,
        inputPrice: 1n,
        outputPrice: 1n,
        updatedAt: 1n,
        model: SERVICE_MODEL,
        verifiability,
        additionalInfo,
        teeSignerAddress: this.enclave.address,
        teeSignerAcknowledged: acknowledged,
      },
    });
  }

  /** How many times a storage upload was paid for. */
  get paidUploads(): number {
    return this.submissions;
  }
}
