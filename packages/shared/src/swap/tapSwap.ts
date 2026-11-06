// The `TapSwap` message of `GameBoxHook`: a Box's approval of one swap at the tap fee (0.25% instead of 1%), signed
// with the Box's P-256 key after a player taps their badge. `tapSwapTypedData` is the EIP-712 typed data,
// `tapSwapDigest` the 32 bytes the Box signs (raw, no prehash, low `s`), and `tapSwapHookData` the hook data the swap
// carries to the pool.

import { type Address, type Hex, encodeAbiParameters, hashTypedData } from 'viem';

import { chainId as deploymentsChainId } from '../names/deployments.ts';

export const TAP_SWAP_DOMAIN = { name: 'Game Box Swap', version: '1' } as const;

export const tapSwapTypes = {
  TapSwap: [
    { name: 'box', type: 'string' },
    { name: 'badge', type: 'address' },
    { name: 'sender', type: 'address' },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountSpecified', type: 'int256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** One swap a Box approves. */
export interface TapSwap {
  /** The Box's label, e.g. `mumbai-01`. */
  box: string;
  /** The badge that tapped. */
  badge: Address;
  /** The router that calls the pool manager: the `sender` the hook sees. */
  sender: Address;
  /** The direction, as in the pool manager's `SwapParams`. */
  zeroForOne: boolean;
  /** As in `SwapParams`: negative for exact in, positive for exact out. */
  amountSpecified: bigint;
  /** Any number the Box hasn't used. */
  nonce: bigint;
  /** Unix seconds. */
  deadline: bigint;
}

/** `TapSwap`, for the `GameBoxHook` at `hook`. */
export function tapSwapTypedData(swap: TapSwap, hook: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...TAP_SWAP_DOMAIN, chainId, verifyingContract: hook },
    types: tapSwapTypes,
    primaryType: 'TapSwap',
    message: swap,
  } as const;
}

/** The digest `GameBoxHook.tapSwapDigest` returns. The Box signs it with P-256. */
export function tapSwapDigest(swap: TapSwap, hook: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(tapSwapTypedData(swap, hook, chainId));
}

/** The hook data of a tap swap: the `TapSwapData` tuple `GameBoxHook.beforeSwap` decodes. */
export function tapSwapHookData(swap: TapSwap, r: Hex, s: Hex): Hex {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'box', type: 'string' },
          { name: 'badge', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
    ],
    [{ box: swap.box, badge: swap.badge, nonce: swap.nonce, deadline: swap.deadline, r, s }],
  );
}
