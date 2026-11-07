// `GameBoxLobby`'s buy: a badge's tap buys GBX with test USDC the lobby mints, at the hook's tap fee. The Box signs the
// `TapSwap` the lobby will send (the lobby as `sender`, USDC in, exact in); `lobbyTapSwap` builds it here, as
// `GameBoxLobby.tapSwapOf` does on chain, so the Box and the relayer agree on the digest without a read.

import type { Address } from 'viem';

import { contractAddress, ourContract } from '../names/deployments.ts';
import type { TapSwap } from './tapSwap.ts';

/** What the Box asks the lobby for. The relayer adds `minGbxOut` from its simulation. */
export interface LobbyBuy {
  /** The Box's label. */
  box: string;
  /** The badge that tapped: it gets the GBX, or the stake once the Box is bonded. */
  badge: Address;
  /** USDC to spend, 6 decimals (at most `GameBoxLobby.MAX_BUY`, 100 USDC). */
  usdcIn: bigint;
  nonce: bigint;
  /** Unix seconds. */
  deadline: bigint;
}

/** The lobby and the pool it trades on. */
export interface LobbyPool {
  lobby: Address;
  /** `GameBoxHook`: the `TapSwap` digest's verifying contract. */
  hook: Address;
  /** Whether USDC is the pool's `currency0` (the lower address), so a buy is `zeroForOne`. */
  usdcIsToken0: boolean;
}

/** `GameBoxLobby`'s pool from `deployments/sepolia.json`, or `undefined` before the lobby is deployed. */
export function lobbyPool(): LobbyPool | undefined {
  const lobby = ourContract('GameBoxLobby')?.address;
  if (!lobby) return undefined;
  return {
    lobby,
    hook: contractAddress('GameBoxHook'),
    usdcIsToken0: BigInt(contractAddress('FakeUSDC')) < BigInt(contractAddress('GBX')),
  };
}

/** The `TapSwap` the Box signs for `buy`: what `GameBoxLobby.tapSwapOf` returns. */
export function lobbyTapSwap(buy: LobbyBuy, pool: LobbyPool): TapSwap {
  return {
    box: buy.box,
    badge: buy.badge,
    sender: pool.lobby,
    zeroForOne: pool.usdcIsToken0,
    amountSpecified: -buy.usdcIn,
    nonce: buy.nonce,
    deadline: buy.deadline,
  };
}
