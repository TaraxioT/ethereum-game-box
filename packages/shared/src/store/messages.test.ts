// Checks messages.ts byte for byte against what the contracts computed (vectors.json, written by
// `contracts/test/game/StoreVectors.t.sol`), and that each vector signature verifies the way it is checked for real.

import { p256 } from '@noble/curves/nist.js';
import { type Hex, hexToBytes, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { P256_VECTOR_KEY } from '../names/vectors.ts';
import {
  jsonTextHash,
  judgeDigest,
  storeStakeDigest,
  storeVerdictDigest,
  storeVerdictTypedData,
  storeVoidDigest,
  storeVoidTypedData,
} from './messages.ts';
import {
  JUDGE_VECTOR,
  STORE_STAKE_VECTOR,
  STORE_VECTOR,
  STORE_VERDICT_VECTOR,
  STORE_VOID_VECTOR,
} from './vectors.ts';

const HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n;
const publicKey = hexToBytes(`0x04${P256_VECTOR_KEY.qx.slice(2)}${P256_VECTOR_KEY.qy.slice(2)}`);
const { storePot, chainId, verifierKey, verifier } = STORE_VECTOR;

function verifiesLowS(digest: Hex, r: Hex, s: Hex): boolean {
  if (BigInt(s) > HALF_N) return false;
  const signature = hexToBytes(`0x${r.slice(2)}${s.slice(2)}`);
  return p256.verify(signature, hexToBytes(digest), publicKey, { prehash: false, lowS: true });
}

describe('Stake', () => {
  const { message, digest, r, s } = STORE_STAKE_VECTOR;

  it('matches StorePot.stakeDigest', () => {
    expect(storeStakeDigest(message, storePot, chainId)).toBe(digest);
  });

  it('is a P-256 signature over the raw digest, low s', () => {
    expect(verifiesLowS(digest, r, s)).toBe(true);
  });

  it('covers the seat order', () => {
    const swapped = { ...message, players: [...message.players].reverse() };
    expect(storeStakeDigest(swapped, storePot, chainId)).not.toBe(digest);
  });
});

describe('Verdict', () => {
  const { message, recordText, digest, signature } = STORE_VERDICT_VECTOR;
  const typedData = storeVerdictTypedData(message, storePot, chainId);

  it('matches StorePot.verdictDigest', () => {
    expect(storeVerdictDigest(message, storePot, chainId)).toBe(digest);
  });

  it('is signed as viem signTypedData signs it', async () => {
    expect(await privateKeyToAccount(verifierKey).signTypedData(typedData)).toBe(signature);
  });

  it('recovers to the verifier', async () => {
    expect(await recoverTypedDataAddress({ ...typedData, signature })).toBe(verifier);
  });

  it('carries the hash of the record text', () => {
    expect(jsonTextHash(recordText)).toBe(message.record);
  });

  it('adds up to the pot', () => {
    const { amount, players } = STORE_STAKE_VECTOR.message;
    expect(message.payouts.reduce((sum, payout) => sum + payout, 0n)).toBe(amount * BigInt(players.length));
  });
});

describe('Void', () => {
  const { message, digest, signature } = STORE_VOID_VECTOR;
  const typedData = storeVoidTypedData(message, storePot, chainId);

  it('matches StorePot.voidDigest', () => {
    expect(storeVoidDigest(message, storePot, chainId)).toBe(digest);
  });

  it('is signed as viem signTypedData signs it', async () => {
    expect(await privateKeyToAccount(verifierKey).signTypedData(typedData)).toBe(signature);
  });
});

describe('Judge', () => {
  const { message, logText, digest, r, s } = JUDGE_VECTOR;

  it('matches the digest forge built from the EIP-712 spec', () => {
    expect(judgeDigest(message, storePot, chainId)).toBe(digest);
  });

  it('is a P-256 signature over the raw digest, low s', () => {
    expect(verifiesLowS(digest, r, s)).toBe(true);
  });

  it('hashes the UTF-8 bytes of the exact JSON text', () => {
    expect(logText).toContain('señal');
    expect(jsonTextHash(logText)).toBe(message.log);
  });

  it('changes with one character of the text', () => {
    expect(jsonTextHash(`${logText} `)).not.toBe(message.log);
  });

  it('is bound to the pot', () => {
    expect(judgeDigest(message, verifier, chainId)).not.toBe(digest);
  });
});
