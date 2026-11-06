// Reading Sepolia from a browser: public RPCs with a fallback (so no key ships in a bundle), Etherscan links, and the
// head block, polled for every view that shows it.

import { type PublicClient, createPublicClient, fallback, http } from 'viem';
import { sepolia } from 'viem/chains';

/** Public Sepolia RPCs, in the order tried. Both allow browser CORS and `eth_getLogs` over 10,000 blocks. */
export const PUBLIC_SEPOLIA_RPCS: readonly string[] = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.gateway.tenderly.co',
];

export const ETHERSCAN = 'https://sepolia.etherscan.io';

/** The largest block range one `eth_getLogs` asks for. */
export const LOG_CHUNK = 9_999n;

/** A Sepolia client over `urls`, the first that answers winning. */
export function sepoliaClient(urls: readonly string[] = PUBLIC_SEPOLIA_RPCS): PublicClient {
  return createPublicClient({
    chain: sepolia,
    transport: fallback(urls.map((url) => http(url, { timeout: 15_000, retryCount: 1 }))),
  });
}

export interface HeadWatch {
  /** The last head block seen, or 0 before the first. */
  head(): bigint;
  /** Calls `fn` with each new head block (and the current one, if known); returns an unsubscribe. */
  onHead(fn: (block: bigint) => void): () => void;
  stop(): void;
}

/** Polls the head block every `everyMs` (Sepolia makes one every 12 s). A failed poll keeps the last block. */
export function watchHead(client: Pick<PublicClient, 'getBlockNumber'>, everyMs = 6_000): HeadWatch {
  let head = 0n;
  const listeners = new Set<(block: bigint) => void>();
  const tick = async () => {
    try {
      const block = await client.getBlockNumber({ cacheTime: 0 });
      if (block !== head) {
        head = block;
        for (const fn of listeners) fn(block);
      }
    } catch {
      // The next tick tries again.
    }
  };
  void tick();
  const timer = setInterval(tick, everyMs);
  return {
    head: () => head,
    onHead(fn) {
      listeners.add(fn);
      if (head > 0n) fn(head);
      return () => listeners.delete(fn);
    },
    stop: () => clearInterval(timer),
  };
}
