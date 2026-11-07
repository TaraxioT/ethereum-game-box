import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { contractAddress, ourContract } from '../names/deployments.ts';
import { type LobbyBuy, type LobbyPool, lobbyPool, lobbyTapSwap } from './lobby.ts';

const pool: LobbyPool = {
  lobby: '0x00000000000000000000000000000000000000ad',
  hook: '0x00000000000000000000000000000000000000ae',
  usdcIsToken0: false,
};
const buy: LobbyBuy = {
  box: 'mumbai-01',
  badge: '0x00000000000000000000000000000000000000b1' as Address,
  usdcIn: 10_000_000n,
  nonce: 7n,
  deadline: 1_800_000_600n,
};

describe('lobbyTapSwap', () => {
  it('is the lobby sending USDC in, exact in, as GameBoxLobby.tapSwapOf', () => {
    expect(lobbyTapSwap(buy, pool)).toEqual({
      box: 'mumbai-01',
      badge: buy.badge,
      sender: pool.lobby,
      zeroForOne: false,
      amountSpecified: -10_000_000n,
      nonce: 7n,
      deadline: 1_800_000_600n,
    });
  });

  it('is zeroForOne when USDC is the pool currency0', () => {
    expect(lobbyTapSwap(buy, { ...pool, usdcIsToken0: true }).zeroForOne).toBe(true);
  });
});

describe('lobbyPool', () => {
  it('reads the lobby and the hook from deployments, or is undefined before the lobby is deployed', () => {
    const lobby = ourContract('GameBoxLobby');
    if (!lobby) return expect(lobbyPool()).toBeUndefined();
    expect(lobbyPool()).toEqual({
      lobby: lobby.address,
      hook: contractAddress('GameBoxHook'),
      usdcIsToken0: BigInt(contractAddress('FakeUSDC')) < BigInt(contractAddress('GBX')),
    });
  });
});
