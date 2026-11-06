// `StorePot.list`: what lets a Box stake on a bundle. An unlisted hash can't be staked, whatever the store holds.

import { sepoliaClient } from '@egb/relayer/chain';
import { type Address, type Hex, type Transport, createWalletClient, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const abi = parseAbi(['function list(bytes32 bundle)', 'function listed(bytes32 bundle) view returns (bool)']);

/** Lists `hash` with a key holding `LISTER_ROLE`. The transaction's hash, or null if it was already listed. */
export async function listOnChain(transport: Transport, key: Hex, pot: Address, hash: Hex): Promise<Hex | null> {
  const client = sepoliaClient(transport);
  if (await client.readContract({ address: pot, abi, functionName: 'listed', args: [hash] })) return null;
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: sepolia, transport });
  const tx = await wallet.writeContract({ address: pot, abi, functionName: 'list', args: [hash] });
  const { status } = await client.waitForTransactionReceipt({ hash: tx });
  if (status !== 'success') throw new Error(`the listing reverted: ${tx}`);
  return tx;
}

/** The command that lists `hash` by hand, from the deployer's keystore. It names the RPC URL, never prints it. */
export function listCommand(pot: Address | undefined, hash: Hex): string {
  const target = pot ?? '<StorePot>';
  return `cast send ${target} 'list(bytes32)' ${hash} --rpc-url "$SEPOLIA_RPC_URL" --account sepolia-deployer`;
}
