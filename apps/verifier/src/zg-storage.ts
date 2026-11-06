// Audit records on 0G Storage, through its SDK, in the Worker itself: no second container is needed.
//
// The SDK's RPC goes through an old axios that reaches for `XMLHttpRequest` in a Worker, so its indexer and node clients
// are given a `fetch` transport here, and the steps of `Indexer.upload` run by hand to use them. That also carries an
// abort signal: the SDK waits for a node to sync in a loop with no end, and only a failed call breaks it.

import { Indexer, MemData, StorageNode, Uploader, getFlowContract, selectNodes } from '@0gfoundation/0g-storage-ts-sdk';
import { JsonRpcProvider, Wallet } from 'ethers';
import type { Hex } from 'viem';

import { abortable } from './abortable.ts';
import type { AuditStore, Landed } from './audit-store.ts';

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

export class ZgAuditStore implements AuditStore {
  private readonly options: ZgStorageOptions;

  constructor(options: ZgStorageOptions) {
    this.options = options;
  }

  async put(text: string): Promise<Landed> {
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
      const flow = getFlowContract(status.networkIdentity.flowAddress, new Wallet(key, provider) as unknown as FlowSigner);
      uploader = new Uploader(nodes, rpcUrl, flow);
      // `skipTx`: a retry finds its file on the chain and carries on, rather than paying for it again.
      const upload = uploader.uploadFile(new MemData(new TextEncoder().encode(text)), { skipTx: true, expectedReplica: REPLICAS });
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
