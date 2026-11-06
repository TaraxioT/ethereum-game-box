// Audit records on 0G Storage, through its SDK, in the Worker itself: no second container is needed.
//
// The SDK's RPC goes through an old axios that reaches for `XMLHttpRequest` in a Worker, so its indexer and node clients
// are given a `fetch` transport here, and the steps of `Indexer.upload` run by hand to use them. That also carries an
// abort signal: the SDK waits for a node to sync in a loop with no end, and only a failed call breaks it.
//
// `skipTx` alone doesn't stop a retry paying twice. The SDK reads a failed `zgs_getFileInfo` as "no such file", and a node
// says the same until it has synced a payment, and either way the SDK pays. So a try decides for itself whether it may
// pay, from a read where a failure throws and the payment `Paying` remembers, and the wallet refuses a try that may not.

import { Indexer, MemData, StorageNode, Uploader, getFlowContract, selectNodes } from '@0gfoundation/0g-storage-ts-sdk';
import { JsonRpcProvider, type TransactionRequest, type TransactionResponse, Wallet } from 'ethers';
import type { Hex } from 'viem';

import { abortable } from './abortable.ts';
import type { AuditStore, Landed, Paying } from './audit-store.ts';

export interface ZgStorageOptions {
  readonly indexerUrl: string;
  /** 0G's chain, where the upload is paid for. */
  readonly rpcUrl: string;
  /** The wallet that pays. */
  readonly key: string;
  readonly timeoutMs: number;
}

const REPLICAS = 1;

/** The SDK's types see ethers' CommonJS build, and this file its ES one. They are the same class in a bundle. */
type FlowSigner = Parameters<typeof getFlowContract>[1];
type Payload = Parameters<StorageNode['_transport']>[0];
type Answer = ReturnType<StorageNode['_transport']>;

async function postJson(url: string, data: Payload, signal: AbortSignal): Answer {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  });
  if (!response.ok) throw new Error(`0G Storage answered ${response.status}`);
  return (await response.json()) as Awaited<Answer>;
}

class FetchIndexer extends Indexer {
  private readonly signal: AbortSignal;

  constructor(url: string, signal: AbortSignal) {
    super(url);
    this.signal = signal;
  }

  override _transport(data: Payload): Answer {
    return postJson(this.url, data, this.signal);
  }
}

class FetchNode extends StorageNode {
  private readonly signal: AbortSignal;

  constructor(url: string, signal: AbortSignal) {
    super(url);
    this.signal = signal;
  }

  override _transport(data: Payload): Answer {
    return postJson(this.url, data, this.signal);
  }
}

/** The wallet only ever sends payments, so this is the one place a payment leaves. It reports each, or with no `onPaid`
 *  refuses it. */
class PayingWallet extends Wallet {
  private readonly onPaid: Paying['onPaid'] | null;

  constructor(key: string, provider: JsonRpcProvider, onPaid: Paying['onPaid'] | null) {
    super(key, provider);
    this.onPaid = onPaid;
  }

  override async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    if (!this.onPaid) throw new Error('the file is there, so this try may not pay');
    const sent = await super.sendTransaction(tx);
    await this.onPaid(sent.hash as Hex);
    return sent;
  }
}

/** Whether a payment can still bring the file: it is mined and good, or on its way. One that reverted or vanished can't. */
async function stands(provider: JsonRpcProvider, tx: Hex): Promise<boolean> {
  const receipt = (await provider.send('eth_getTransactionReceipt', [tx])) as { status: string } | null;
  if (receipt) return receipt.status === '0x1';
  return (await provider.send('eth_getTransactionByHash', [tx])) !== null;
}

/** Whether this try may pay. Throws if it can't tell, or if an earlier payment only needs the node to catch up. */
async function mayPay(node: StorageNode, file: MemData, provider: JsonRpcProvider, paid: Hex | null): Promise<boolean> {
  const [tree, error] = await file.merkleTree();
  if (!tree) throw error ?? new Error('the record has no merkle tree');
  if (await node.getFileInfo(tree.rootHash() as string, false)) return false;
  if (paid && (await stands(provider, paid))) throw new Error('the upload is paid for, and the node has not seen it yet');
  return true;
}

export class ZgAuditStore implements AuditStore {
  private readonly options: ZgStorageOptions;

  constructor(options: ZgStorageOptions) {
    this.options = options;
  }

  async put(text: string, { paid, onPaid }: Paying): Promise<Landed> {
    const { indexerUrl, rpcUrl, key, timeoutMs } = this.options;
    const signal = AbortSignal.timeout(timeoutMs);
    const provider = new JsonRpcProvider(rpcUrl);
    let uploader: Uploader | undefined;
    try {
      const { trusted } = await new FetchIndexer(indexerUrl, signal).getShardedNodes();
      const [picked, enough] = selectNodes(trusted, REPLICAS, 'min');
      const nodes = picked.map(({ url }) => new FetchNode(url, signal));
      const first = nodes[0];
      if (!enough || !first) throw new Error('0G Storage has no nodes to take the record');
      const status = await first.getStatus();
      if (!status) throw new Error('0G Storage has no status');
      const file = new MemData(new TextEncoder().encode(text));
      const wallet = new PayingWallet(key, provider, (await mayPay(first, file, provider, paid)) ? onPaid : null);
      const flow = getFlowContract(status.networkIdentity.flowAddress, wallet as unknown as FlowSigner);
      uploader = new Uploader(nodes, rpcUrl, flow);
      const upload = uploader.uploadFile(file, { skipTx: true, expectedReplica: REPLICAS });
      const [result, error] = await abortable(upload, signal, 'the upload timed out');
      if (error) throw error;
      return { root: result.rootHash as Hex, tx: result.txHash ? (result.txHash as Hex) : null };
    } finally {
      // ethers retries a chain it can't reach for as long as its provider lives.
      provider.destroy();
      uploader?.provider.destroy();
    }
  }
}
