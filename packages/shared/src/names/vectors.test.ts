// Checks messages.ts and roles.ts byte for byte against what the contracts computed (vectors.json, written by
// `contracts/test/names/Vectors.t.sol`), and that each vector signature verifies the way the contracts verify it.

import { p256 } from '@noble/curves/nist.js';
import { concat, hexToBytes, keccak256, sha256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import {
  claimNameDigest,
  claimNameTypedData,
  encodeCalls,
  executeBatchDigest,
  executeDigest,
  resultDigest,
  seatDigest,
  stakeDigest,
} from './messages.ts';
import { primaryNameDigest, primaryNameMessage } from './primaryName.ts';
import { REGISTRY_ROLES, RESOLVER_ROLES } from './roles.ts';
import {
  CLAIM_NAME_VECTOR,
  EXECUTE_BATCH_VECTOR,
  EXECUTE_VECTOR,
  P256_VECTOR_KEY,
  PRIMARY_NAME_VECTOR,
  RESULT_VECTOR,
  ROLE_VECTORS,
  SEAT_VECTOR,
  STAKE_VECTOR,
  WEBAUTHN_VECTOR,
} from './vectors.ts';
import { encodeWebAuthnSignature, parseDerSignature, rawSignature } from './webauthn.ts';

const HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n;
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** `r ‖ (n - s)`: the same signature with a high `s`. */
function rawSignatureHigh(r: `0x${string}`, s: `0x${string}`): `0x${string}` {
  return `0x${r.slice(2)}${(P256_N - BigInt(s)).toString(16).padStart(64, '0')}`;
}
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
  it('matches P256Account.executeDigest', () => {
    const { call, account, chainId, digest } = EXECUTE_VECTOR;
    expect(executeDigest(call, account, chainId)).toBe(digest);
  });

  it('is a P-256 signature over the raw digest, low s', () => {
    const { digest, r, s } = EXECUTE_VECTOR;
    expect(verifiesLowS(digest, r, s)).toBe(true);
  });

  it('encodes the raw form as r ‖ s, and makes s low', () => {
    const { r, s, signature } = EXECUTE_VECTOR;
    expect(rawSignature(BigInt(r), BigInt(s))).toBe(signature);
    expect(rawSignature(BigInt(r), P256_N - BigInt(s))).toBe(signature);
  });
});

describe('executeBatch', () => {
  it('matches P256Account.batchDigest', () => {
    const { batch, account, chainId, dataHash, digest } = EXECUTE_BATCH_VECTOR;
    expect(keccak256(encodeCalls(batch.calls))).toBe(dataHash);
    expect(executeBatchDigest(batch, account, chainId)).toBe(digest);
  });

  it('is a raw P-256 signature of the batch digest', () => {
    const { digest, signature } = EXECUTE_BATCH_VECTOR;
    expect(verifiesLowS(digest, `0x${signature.slice(2, 66)}`, `0x${signature.slice(66)}`)).toBe(true);
  });
});

describe('WebAuthn', () => {
  const { digest, authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s, signature } = WEBAUTHN_VECTOR;
  const json = new TextDecoder().decode(hexToBytes(clientDataJSON));

  it('signs the Execute digest as the challenge', () => {
    expect(digest).toBe(EXECUTE_VECTOR.digest);
    const challenge = Buffer.from(hexToBytes(digest)).toString('base64url');
    expect(JSON.parse(json)).toMatchObject({ type: 'webauthn.get', challenge });
    expect(json.indexOf('"challenge":"')).toBe(challengeIndex);
    expect(json.indexOf('"type":"webauthn.get"')).toBe(typeIndex);
  });

  it('is a P-256 signature of sha256(authenticatorData ‖ sha256(clientDataJSON)), user verified', () => {
    expect(hexToBytes(authenticatorData)[32]! & 0x05).toBe(0x05);
    const message = sha256(concat([authenticatorData, sha256(clientDataJSON)]));
    expect(verifiesLowS(message, r, s)).toBe(true);
  });

  it('encodes the assertion byte for byte as the account takes it', () => {
    const fromBytes = { authenticatorData: hexToBytes(authenticatorData), clientDataJSON: hexToBytes(clientDataJSON) };
    expect(encodeWebAuthnSignature({ ...fromBytes, r: BigInt(r), s: BigInt(s) })).toBe(signature);
    // From text, and from a high s: the same bytes.
    expect(encodeWebAuthnSignature({ authenticatorData, clientDataJSON: json, r: BigInt(r), s: P256_N - BigInt(s) })).toBe(
      signature,
    );
  });

  it('reads r and s from the DER signature an authenticator returns', () => {
    const der = p256.Signature.fromBytes(hexToBytes(`0x${r.slice(2)}${s.slice(2)}`), 'compact').toBytes('der');
    expect(parseDerSignature(der)).toEqual({ r: BigInt(r), s: BigInt(s) });
    const high = p256.Signature.fromBytes(
      hexToBytes(rawSignatureHigh(r, s)),
      'compact',
    ).toBytes('der');
    expect(parseDerSignature(high)).toEqual({ r: BigInt(r), s: BigInt(s) });
    expect(() => parseDerSignature(new Uint8Array([0x30, 0x00]))).toThrow();
  });
});

describe('Stake', () => {
  it('matches DuelPot.stakeDigest', () => {
    const { stake, duelPot, chainId, digest } = STAKE_VECTOR;
    expect(stakeDigest(stake, duelPot, chainId)).toBe(digest);
  });

  it('is a P-256 signature over the raw digest, low s', () => {
    const { digest, r, s } = STAKE_VECTOR;
    expect(verifiesLowS(digest, r, s)).toBe(true);
  });
});

describe('Seat', () => {
  it('matches BoxSeats.seatDigest', () => {
    const { seat, boxSeats, chainId, digest } = SEAT_VECTOR;
    expect(seatDigest(seat, boxSeats, chainId)).toBe(digest);
  });

  it('is a P-256 signature over the raw digest, low s', () => {
    const { digest, r, s } = SEAT_VECTOR;
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
