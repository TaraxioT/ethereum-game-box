// Checks messages.ts and roles.ts byte for byte against what the contracts computed (vectors.json, written by
// `contracts/test/names/Vectors.t.sol`), and that each vector signature verifies the way the contracts verify it.

import { p256 } from '@noble/curves/nist.js';
import { hexToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { claimNameDigest, claimNameTypedData, executeDigest, resultDigest } from './messages.ts';
import { primaryNameDigest, primaryNameMessage } from './primaryName.ts';
import { REGISTRY_ROLES, RESOLVER_ROLES } from './roles.ts';
import {
  CLAIM_NAME_VECTOR,
  EXECUTE_VECTOR,
  P256_VECTOR_KEY,
  PRIMARY_NAME_VECTOR,
  RESULT_VECTOR,
  ROLE_VECTORS,
} from './vectors.ts';

const HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n;
const publicKey = hexToBytes(`0x04${P256_VECTOR_KEY.qx.slice(2)}${P256_VECTOR_KEY.qy.slice(2)}`);

function verifiesLowS(digest: `0x${string}`, r: `0x${string}`, s: `0x${string}`): boolean {
  if (BigInt(s) > HALF_N) return false;
  const signature = hexToBytes(`0x${r.slice(2)}${s.slice(2)}`);
  return p256.verify(signature, hexToBytes(digest), publicKey, { prehash: false, lowS: true });
}

describe('ClaimName', () => {
  it('matches GameBoxNames.claimDigest', () => {
    const { message, gameBoxNames, chainId, digest } = CLAIM_NAME_VECTOR;
    expect(claimNameDigest(message, gameBoxNames, chainId)).toBe(digest);
  });

  it('is signed as viem signTypedData signs it', async () => {
    const { privateKey, message, gameBoxNames, chainId, signature } = CLAIM_NAME_VECTOR;
    const badge = privateKeyToAccount(privateKey);
    expect(badge.address).toBe(message.badge);
    expect(await badge.signTypedData(claimNameTypedData(message, gameBoxNames, chainId))).toBe(signature);
  });
});

describe('Execute', () => {
  it('matches BoxAccount.executeDigest', () => {
    const { call, account, chainId, digest } = EXECUTE_VECTOR;
    expect(executeDigest(call, account, chainId)).toBe(digest);
  });

  it('is a P-256 signature over the raw digest, low s', () => {
    const { digest, r, s } = EXECUTE_VECTOR;
    expect(verifiesLowS(digest, r, s)).toBe(true);
  });
});

describe('Result', () => {
  it('matches BoxResults.resultDigest', () => {
    const { result, boxResults, chainId, digest } = RESULT_VECTOR;
    expect(resultDigest(result, boxResults, chainId)).toBe(digest);
  });

  it('is a P-256 signature over the raw digest, low s', () => {
    const { digest, r, s } = RESULT_VECTOR;
    expect(verifiesLowS(digest, r, s)).toBe(true);
  });

  it('signs again to the same verifiable signature from the vector key', () => {
    const signature = p256.sign(hexToBytes(RESULT_VECTOR.digest), hexToBytes(P256_VECTOR_KEY.privateKey), {
      prehash: false,
      lowS: true,
    });
    expect(p256.verify(signature, hexToBytes(RESULT_VECTOR.digest), publicKey, { prehash: false })).toBe(true);
  });
});

describe('primary name', () => {
  it('matches the DefaultReverseRegistrar message and digest', () => {
    const { message, registrar, raw, digest } = PRIMARY_NAME_VECTOR;
    expect(primaryNameMessage(message, registrar)).toBe(raw);
    expect(primaryNameDigest(message, registrar)).toBe(digest);
  });

  it('is signed as viem signMessage signs it', async () => {
    const { privateKey, raw, signature } = PRIMARY_NAME_VECTOR;
    expect(await privateKeyToAccount(privateKey).signMessage({ message: { raw } })).toBe(signature);
  });
});

describe('roles', () => {
  it('match IENSv2.sol', () => {
    const asBigInts = (table: Record<string, `0x${string}`>) =>
      Object.fromEntries(Object.entries(table).map(([name, hex]) => [name, BigInt(hex)]));
    expect(asBigInts(ROLE_VECTORS.registry)).toEqual(REGISTRY_ROLES);
    expect(asBigInts(ROLE_VECTORS.resolver)).toEqual(RESOLVER_ROLES);
  });
});
