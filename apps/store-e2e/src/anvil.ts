// The chain: anvil as Sepolia, with its chain id, Osaka's P-256 precompile and a block a second.
//
// It runs well behind the wall clock. A Worker's `Date.now` can't be moved, so time travel goes the only way that leaves
// them in step: the chain jumps forward without ever passing them. Every deadline a Box or the verifier signs from the
// wall clock is then good on chain, before and after a jump. It also means the relayer's own early check of a refund
// passes at once, and `StorePot` is what refuses it until the delay has run.

import { type Address, type Hex, type PublicClient, createPublicClient, http, numberToHex, parseEther } from 'viem';
import { sepolia } from 'viem/chains';

import { foundryEnv } from './foundry.ts';
import { local, PORTS } from './ports.ts';
import { type Child, start } from './processes.ts';

/** How far behind the wall clock the chain starts: room for every jump a run makes. */
const BEHIND_SECONDS = 6 * 60 * 60;

export interface Chain {
  readonly url: string;
  readonly client: PublicClient;
  /** Gives `address` ETH for gas. */
  fund(address: Address): Promise<void>;
  /** Moves the chain's clock on, and mines a block there. */
  jump(seconds: number): Promise<void>;
  stop(): Promise<void>;
}

export async function startChain(): Promise<Chain> {
  const url = local(PORTS.anvil);
  const timestamp = Math.floor(Date.now() / 1000) - BEHIND_SECONDS;
  const args = ['--host', '127.0.0.1', '--port', String(PORTS.anvil), '--chain-id', String(sepolia.id)];
  args.push('--hardfork', 'osaka', '--block-time', '1', '--timestamp', String(timestamp));
  const anvil: Child = start('anvil', 'anvil', args, { env: foundryEnv() });
  await anvil.says(/Listening on/, 30_000);

  const client = createPublicClient({ chain: sepolia, transport: http(url), cacheTime: 0, pollingInterval: 200 });
  const send = (method: string, params: unknown[]) => client.request({ method, params } as never);

  return {
    url,
    client,
    fund: async (address) => {
      await send('anvil_setBalance', [address, numberToHex(parseEther('100')) as Hex]);
    },
    jump: async (seconds) => {
      await send('evm_increaseTime', [numberToHex(seconds)]);
      await send('evm_mine', []);
    },
    stop: () => anvil.stop(),
  };
}
