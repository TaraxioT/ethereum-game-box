// The HTTP API of the relayer (`apps/relayer`) and the demo Box (`apps/demo-box`): request bodies and responses.
// Integers travel as decimal strings (a safe JSON number is accepted too). Errors are 4xx/5xx with `ApiError`.

import type { Address, Hex } from 'viem';

/** A uint256 in JSON: a decimal (or 0x) string, or a safe integer. */
export type JsonUint = string | number;

/** `POST /names/claim`: a badge's signed `ClaimName`. */
export interface ClaimRequest {
  label: string;
  badge: Address;
  deadline: JsonUint;
  /** The badge's EIP-712 signature (ECDSA, or ERC-1271 for a contract wallet). */
  signature: Hex;
}

/** `POST /box/execute`: a call the Box's P-256 key signed for its `BoxAccount`. */
export interface ExecuteRequest {
  account: Address;
  target: Address;
  value: JsonUint;
  data: Hex;
  nonce: JsonUint;
  deadline: JsonUint;
  r: Hex;
  s: Hex;
}

/** `POST /box/result`: a match result the Box's P-256 key signed. */
export interface ResultRequest {
  result: {
    box: string;
    game: string;
    round: JsonUint;
    winner: Address;
    loser: Address;
    draw: boolean;
    deadline: JsonUint;
  };
  r: Hex;
  s: Hex;
}

/** `POST /box/popup`: opens `popup-<label>.gamebox.eth` for 10 minutes. */
export interface PopupRequest {
  label: string;
}

/** `POST /names/drip`: a little ETH to a badge that holds a player name, once. */
export interface DripRequest {
  badge: Address;
}

export type TxKind = 'claim' | 'execute' | 'result' | 'popup' | 'drip';
export type TxStatus = 'signed' | 'sent' | 'in-block' | 'done' | 'failed';

/** A relayed request's progress: the 202 of every POST route, and `GET /tx/:id`. */
export interface TxView {
  id: string;
  kind: TxKind;
  status: TxStatus;
  hash?: Hex;
  etherscan?: string;
  block?: number;
  gasUsed?: string;
  /** Wei paid: gas used times the effective gas price. */
  fee?: string;
  /** Why it failed. */
  error?: string;
  /** The contract error a mined transaction reverted with. */
  revert?: string;
}

/** Every 4xx/5xx body. `revert` is the contract error an `eth_call` reverted with, decoded by name. */
export interface ApiError {
  error: string;
  revert?: string;
}

/** `GET /health` on the relayer. */
export interface RelayerHealth {
  address: Address;
  /** Wei, as a decimal string. */
  balance: string;
  pending: number;
  /** The head block. */
  block: number;
  tipGwei: string;
}

/** `POST /result` on the demo Box. */
export interface ReportRequest {
  box: string;
  game: string;
  winner: Address;
  loser: Address;
  draw: boolean;
}

/** The demo Box's answer: the relayer's request id and the round it signed. */
export interface ReportResponse {
  id: string;
  round: number;
}

/** `GET /box` on the demo Box. */
export interface DemoBoxView {
  label: string;
  account: Address;
  qx: Hex;
  qy: Hex;
  /** Unix seconds of the last heartbeat it sent, or null before the first. */
  lastSeen: number | null;
  /** The relayer request ids of that heartbeat's writes. */
  heartbeat: string[];
}
