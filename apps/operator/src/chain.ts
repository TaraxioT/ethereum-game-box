// The one viem client every read goes through (Sepolia over public RPCs, with a fallback), and the contracts the site
// talks to, from `deployments/sepolia.json` through the shared loader. A contract that isn't deployed yet reads as null.
import { type Address, type PublicClient, createPublicClient, fallback, http } from "viem";
import { sepolia } from "viem/chains";
import { type OurContract, ourContract } from "@egb/shared/names";

import { RPC_URLS } from "./config.ts";

export const client: PublicClient = createPublicClient({
  chain: sepolia,
  transport: fallback(RPC_URLS.map((url) => http(url, { timeout: 15_000, retryCount: 1 }))),
});

/** `P256AccountFactory`: a passkey's account address, before and after it exists. */
export function factory(): Address | null {
  return ourContract("P256AccountFactory")?.address ?? null;
}

/** `GameBoxNames`: the Box licences, and who may issue them. */
export function gameBoxNames(): OurContract | null {
  return ourContract("GameBoxNames") ?? null;
}

let head = 0n;
const listeners = new Set<(block: bigint) => void>();

/** Calls `fn` with each new head block; returns an unsubscribe. */
export function onHead(fn: (block: bigint) => void): () => void {
  listeners.add(fn);
  if (head > 0n) fn(head);
  return () => listeners.delete(fn);
}

/** Polls the head block every 6 s (Sepolia makes one every 12 s). */
export function watchHead(): void {
  const tick = async () => {
    try {
      const block = await client.getBlockNumber({ cacheTime: 0 });
      if (block !== head) {
        head = block;
        for (const fn of listeners) fn(block);
      }
    } catch {
      // The next tick tries again; the tag shows the last block it saw.
    }
  };
  void tick();
  setInterval(tick, 6_000);
}
