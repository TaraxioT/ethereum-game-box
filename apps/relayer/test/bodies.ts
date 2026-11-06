// Signed request bodies for the fake deployment in `world.ts`.

import {
  type Call,
  P256_N,
  claimNameDigest,
  claimNameTypedData,
  encodeWebAuthnSignature,
  executeBatchDigest,
  executeDigest,
  fullName,
  permissionedResolverAbi,
  primaryNameMessage,
  resultDigest,
  type Result,
  type Seat,
  type Stake,
  seatDigest,
  stakeDigest,
  usdc,
} from '@egb/shared/names';
import {
  type Address,
  type Hex,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters, hexToBytes, keccak256, numberToHex, sha256, toHex } from 'viem';
import { type PrivateKeyAccount, generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { packetToBytes } from 'viem/ens';

import { BOX, BOX_ACCOUNT, BOX_RESOLVER, type Key, NOW, type World, addresses } from './world.ts';

export const newBadge = () => privateKeyToAccount(generatePrivateKey());

export async function claimBody(label: string, badge: PrivateKeyAccount, options: { deadline?: bigint; signer?: PrivateKeyAccount } = {}) {
  const deadline = options.deadline ?? BigInt(NOW + 600);
  const signature = await (options.signer ?? badge).signTypedData(
    claimNameTypedData({ label, badge: badge.address, deadline }, addresses.names),
  );
  return { label, badge: badge.address, deadline, signature };
}

export async function primaryNameConsent(label: string, badge: PrivateKeyAccount, options: { expiry?: bigint; signer?: PrivateKeyAccount } = {}) {
  const expiry = options.expiry ?? BigInt(NOW + 1800);
  const raw = primaryNameMessage({ badge: badge.address, name: fullName(label), expiry }, addresses.reverseRegistrar);
  return { expiry, signature: await (options.signer ?? badge).signMessage({ message: { raw } }) };
}

export function setTextData(key: string, value: string, label = BOX): Hex {
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: 'setText',
    args: [toHex(packetToBytes(fullName(label))), key, value],
  });
}

/** How a test signs an `Execute`: raw, raw with a high `s`, or as a passkey (optionally with a flaw). */
export type SignAs =
  | { as: 'raw'; highS?: boolean }
  | { as: 'webauthn'; flaw?: 'challenge' | 'type' | 'no-uv' | 'high-s' };

export function executeBody(
  world: World,
  options: {
    data?: Hex;
    nonce?: bigint;
    target?: Address;
    account?: Address;
    value?: bigint;
    calls?: Call[];
    key?: Key;
    sign?: SignAs;
  } = {},
) {
  const nonce = options.nonce ?? 7n;
  const deadline = BigInt(NOW + 600);
  const account = options.account ?? BOX_ACCOUNT;
  const key = options.key ?? world.key;
  const one: Call = {
    target: options.target ?? BOX_RESOLVER,
    value: options.value ?? 0n,
    data: options.data ?? setTextData('lastSeen', String(NOW)),
  };
  const digest = options.calls
    ? executeBatchDigest({ calls: options.calls, nonce, deadline }, account)
    : executeDigest({ ...one, nonce, deadline }, account);
  const sign = options.sign ?? { as: 'raw' };
  const signature = sign.as === 'raw' ? key.raw(digest, { highS: sign.highS }) : passkeySignature(key, digest, sign.flaw);
  return {
    account,
    nonce,
    deadline,
    signature,
    ...(options.calls ? { calls: options.calls } : { call: one }),
  };
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A passkey assertion of `digest` by `key`, encoded the way `P256Account` takes it. */
export function passkeySignature(key: Key, digest: Hex, flaw?: 'challenge' | 'type' | 'no-uv' | 'high-s'): Hex {
  const challenge = flaw === 'challenge' ? keccak256(digest) : digest;
  const type = flaw === 'type' ? 'webauthn.create' : 'webauthn.get';
  const clientDataJSON = `{"type":"${type}","challenge":"${base64url(hexToBytes(challenge))}","origin":"https://gamebox-operator.pages.dev"}`;
  // rpIdHash, flags (UP, and UV unless the flaw is its absence), sign count.
  const authenticatorData = concatHex([sha256(toHex('gamebox-operator.pages.dev')), flaw === 'no-uv' ? '0x01' : '0x05', '0x00000001']);
  const hash = sha256(concatHex([authenticatorData, sha256(toHex(clientDataJSON))]));
  const { r, s } = key.sign(hash);
  if (flaw === 'type') {
    // The shared encoder needs a webauthn.get type to point at, so encode this one by hand: type at byte 1.
    const challengeIndex = BigInt(clientDataJSON.indexOf('"challenge"'));
    return encodeAbiParameters(
      parseAbiParameters('bytes32, bytes32, uint256, uint256, bytes, string'),
      [r, s, challengeIndex, 1n, authenticatorData, clientDataJSON],
    );
  }
  const signature = encodeWebAuthnSignature({ authenticatorData, clientDataJSON, r: BigInt(r), s: BigInt(s) });
  if (flaw !== 'high-s') return signature;
  // `encodeWebAuthnSignature` makes s low: put the high one back in its slot (the second word).
  const high = numberToHex(P256_N - BigInt(s), { size: 32 }).slice(2);
  return `0x${signature.slice(2, 66)}${high}${signature.slice(130)}`;
}

export function resultBody(
  world: World,
  winner: Address,
  loser: Address,
  options: { round?: bigint; highS?: boolean; box?: string; game?: string } = {},
) {
  const result: Result = {
    box: options.box ?? BOX,
    game: options.game ?? 'quickdraw',
    round: options.round ?? 1n,
    winner,
    loser,
    draw: false,
    deadline: BigInt(NOW + 600),
  };
  return { result, ...world.key.sign(resultDigest(result, addresses.results), { highS: options.highS }) };
}

/** A `ClaimName` an account's key signs raw, for its ERC-1271 `isValidSignature`. */
export function accountClaimBody(world: World, label: string, account: Address, key: Key) {
  const deadline = BigInt(NOW + 600);
  const signature = key.raw(claimNameDigest({ label, badge: account, deadline }, addresses.names));
  world.erc1271.set(account.toLowerCase(), new Set([signature.toLowerCase()]));
  return { label, badge: account, deadline, signature };
}

/** A `Stake` of 10 USDC each for round 1 of `stockduel`, signed by the Box (or by `key`). */
export function stakeBody(world: World, a: Address, b: Address, options: Partial<Stake> & { key?: Key; highS?: boolean } = {}) {
  const { key = world.key, highS, ...fields } = options;
  const stake: Stake = {
    box: BOX,
    game: 'stockduel',
    round: 1n,
    a,
    b,
    amount: usdc(10),
    deadline: BigInt(NOW + 600),
    ...fields,
  };
  return { stake, ...key.sign(stakeDigest(stake, addresses.pot), { highS }) };
}

/** A `Seat` of `<label>.gamebox.eth` for `badge`, signed by the Box (or by `key`). */
export function seatBody(world: World, label: string, badge: Address, options: Partial<Seat> & { key?: Key; highS?: boolean } = {}) {
  const { key = world.key, highS, ...fields } = options;
  const seat: Seat = { label, badge, box: BOX, deadline: BigInt(NOW + 600), ...fields };
  return { seat, ...key.sign(seatDigest(seat, addresses.seats), { highS }) };
}
