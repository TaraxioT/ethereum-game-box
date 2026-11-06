// Test USDC balances (`FakeUSDC`, 6 decimals), the stakes and prizes players play for. Read straight from the token.
import type { Address, PublicClient } from "viem";
import { contractAddress, fakeUsdcAbi } from "@egb/shared/names";

/** Each address's balance in USDC base units, in the same order (one multicall). */
export function readBalances(client: PublicClient, addresses: readonly Address[]): Promise<bigint[]> {
  const address = contractAddress("FakeUSDC");
  return Promise.all(addresses.map((account) => client.readContract({ address, abi: fakeUsdcAbi, functionName: "balanceOf", args: [account] })));
}

export async function readBalance(client: PublicClient, address: Address): Promise<bigint> {
  const [balance] = await readBalances(client, [address]);
  return balance ?? 0n;
}
