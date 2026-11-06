// A badge's primary name: after the claim, the badge signs ENS's `default.reverse` message for `<player>.gamebox.eth`
// and anyone (the relayer) submits it with `setNameForAddrWithSignature`, so `getEnsName(badge)` returns the name and
// the badge needs no ETH. The registrar is ENS's `DefaultReverseRegistrar` on Sepolia
// (`ensAddress('DefaultReverseRegistrar')`). Its message is ERC-191 (`personal_sign`) over
// `keccak256(registrar ‖ selector ‖ badge ‖ expiry ‖ name)`, and the expiry may be at most an hour away.

import { type Address, type Hex, encodePacked, hashMessage, keccak256, parseAbi, toFunctionSelector } from 'viem';

/** The longest a primary-name signature may be valid for: ENS's `SignatureExpiryTooHigh` beyond this. */
export const PRIMARY_NAME_MAX_EXPIRY_SECONDS = 3600;

/** The `DefaultReverseRegistrar` functions the flow calls. */
export const defaultReverseRegistrarAbi = parseAbi([
  'function setNameForAddrWithSignature(address addr, uint256 signatureExpiry, string name, bytes signature)',
  'function setName(string name)',
  'error InvalidSignature()',
  'error SignatureExpired()',
  'error SignatureExpiryTooHigh()',
]);

/** A badge's consent to `name` as its primary name. */
export interface PrimaryName {
  badge: Address;
  /** `<player>.gamebox.eth`. */
  name: string;
  /** Unix seconds, at most `PRIMARY_NAME_MAX_EXPIRY_SECONDS` from now when submitted. */
  expiry: bigint;
}

/** The 32 bytes the badge signs with `personal_sign` (viem: `signMessage({ message: { raw } })`). */
export function primaryNameMessage(message: PrimaryName, registrar: Address): Hex {
  const selector = toFunctionSelector(
    'setNameForAddrWithSignature(address,uint256,string,bytes)',
  );
  return keccak256(
    encodePacked(
      ['address', 'bytes4', 'address', 'uint256', 'string'],
      [registrar, selector, message.badge, message.expiry, message.name],
    ),
  );
}

/** The ERC-191 digest the registrar checks the signature against. */
export function primaryNameDigest(message: PrimaryName, registrar: Address): Hex {
  return hashMessage({ raw: primaryNameMessage(message, registrar) });
}
