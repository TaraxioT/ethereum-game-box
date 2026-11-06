// The Sepolia client. The RPC URL carries the node's key, so nothing the relayer returns or logs may contain it.

import { type PublicClient, type Transport, createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

export type Client = PublicClient<Transport, typeof sepolia>;

export function sepoliaClient(transport: Transport): Client {
  return createPublicClient({ chain: sepolia, transport, cacheTime: 0 });
}

export function rpc(url: string): Transport {
  return http(url, { retryCount: 1, timeout: 15_000 });
}

/** `message` with every URL replaced by `<rpc>`. */
export function redact(message: string): string {
  return message.replace(/\b(?:https?|wss?):\/\/[^\s"'`<>)]+/gi, '<rpc>');
}

/** A safe one-line description of an unexpected error. */
export function describe(error: unknown): string {
  // viem puts the node's own words in `details`, and a generic summary in `shortMessage`.
  const { details, shortMessage } = error as { details?: string; shortMessage?: string };
  const message = error instanceof Error ? details || shortMessage || error.message : String(error);
  return redact(message.split('\n')[0] ?? 'error');
}

export const etherscanTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
