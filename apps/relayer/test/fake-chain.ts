// A fake Sepolia node behind a viem custom transport. Contract reads are answered by handlers keyed by address and
// function name; every `eth_sendRawTransaction` is recorded, so a test can assert that nothing was sent.

import {
  type Abi,
  type Address,
  type Hex,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  custom,
  keccak256,
  numberToHex,
  parseTransaction,
} from 'viem';

import { type Client, sepoliaClient } from '../src/chain.ts';

/** Thrown by a handler to make the call revert with a named contract error. */
export class Revert {
  readonly data: Hex;
  constructor(abi: Abi, errorName: string, args: readonly unknown[] = []) {
    this.data = encodeErrorResult({ abi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);
  }
}

type Handler = (args: readonly unknown[]) => unknown;

export interface FakeContract {
  abi: Abi;
  handlers: Record<string, Handler>;
}

export interface Sent {
  raw: Hex;
  hash: Hex;
  nonce: number;
  to: Address | undefined;
  data: Hex | undefined;
  gas: bigint | undefined;
}

export class FakeChain {
  readonly client: Client;
  readonly sent: Sent[] = [];
  readonly contracts = new Map<string, FakeContract>();
  readonly balances = new Map<string, bigint>();
  readonly receipts = new Map<string, { status: 'success' | 'reverted'; block: number }>();
  head = 100;
  /** The account nonce the node expects next. */
  chainNonce = 0;
  /** Makes the next sends fail with these messages, one per send. */
  sendErrors: string[] = [];
  /** How often each RPC method was called. */
  readonly calls = new Map<string, number>();

  constructor() {
    this.client = sepoliaClient(custom({ request: ({ method, params }) => this.request(method, params) }));
  }

  contract(address: Address, abi: Abi, handlers: Record<string, Handler>): this {
    this.contracts.set(address.toLowerCase(), { abi, handlers });
    return this;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    this.calls.set(method, (this.calls.get(method) ?? 0) + 1);
    const p = (params ?? []) as unknown[];
    switch (method) {
      case 'eth_chainId':
        return numberToHex(11155111);
      case 'eth_blockNumber':
        return numberToHex(this.head);
      case 'eth_getBlockByNumber':
        return { number: numberToHex(this.head), baseFeePerGas: '0x3b9aca00', hash: `0x${'11'.repeat(32)}`, transactions: [] };
      case 'eth_getBalance':
        return numberToHex(this.balances.get(String(p[0]).toLowerCase()) ?? 0n);
      case 'eth_getCode':
        return '0x';
      case 'eth_getTransactionCount':
        return numberToHex(this.chainNonce);
      case 'eth_call':
        return this.call(p[0] as { to?: Address; data: Hex });
      case 'eth_estimateGas':
        await this.call(p[0] as { to?: Address; data: Hex });
        return numberToHex(200_000);
      case 'eth_sendRawTransaction':
        return this.send(p[0] as Hex);
      case 'eth_getTransactionReceipt':
        return this.receipt(p[0] as Hex);
      default:
        throw new Error(`fake chain: ${method} is not faked`);
    }
  }

  private async call({ to, data }: { to?: Address; data?: Hex }): Promise<Hex> {
    // A deployless ERC-6492 validator call (an ERC-1271 check): no wallet contract here, so it says no.
    if (!to) return `0x${'00'.repeat(32)}`;
    const contract = this.contracts.get(to.toLowerCase());
    if (!contract || !data || data === '0x') return '0x';
    const { functionName, args } = decodeFunctionData({ abi: contract.abi, data });
    const handler = contract.handlers[functionName];
    if (!handler) throw new Error(`fake chain: ${functionName} at ${to} is not faked`);
    let result: unknown;
    try {
      result = handler(args ?? []);
    } catch (error) {
      if (error instanceof Revert) throw Object.assign(new Error('execution reverted'), { code: 3, data: error.data });
      throw error;
    }
    if (result === undefined) return '0x';
    return encodeFunctionResult({ abi: contract.abi, functionName, result } as Parameters<
      typeof encodeFunctionResult
    >[0]);
  }

  private send(raw: Hex): Hex {
    const failure = this.sendErrors.shift();
    if (failure) throw Object.assign(new Error(failure), { code: -32000 });
    const tx = parseTransaction(raw);
    if (tx.nonce !== this.chainNonce) {
      throw Object.assign(new Error(`nonce too ${tx.nonce! < this.chainNonce ? 'low' : 'high'}`), { code: -32000 });
    }
    this.chainNonce++;
    const hash = keccak256(raw);
    this.sent.push({ raw, hash, nonce: tx.nonce!, to: tx.to ?? undefined, data: tx.data, gas: tx.gas });
    return hash;
  }

  private receipt(hash: Hex): unknown {
    const receipt = this.receipts.get(hash);
    if (!receipt) return null;
    return {
      transactionHash: hash,
      blockNumber: numberToHex(receipt.block),
      blockHash: `0x${'22'.repeat(32)}`,
      status: receipt.status === 'success' ? '0x1' : '0x0',
      gasUsed: numberToHex(150_000),
      effectiveGasPrice: numberToHex(2_000_000_000),
      cumulativeGasUsed: numberToHex(150_000),
      logs: [],
      logsBloom: `0x${'00'.repeat(256)}`,
      transactionIndex: '0x0',
      type: '0x2',
      from: `0x${'00'.repeat(20)}`,
      to: `0x${'00'.repeat(20)}`,
      contractAddress: null,
    };
  }
}
