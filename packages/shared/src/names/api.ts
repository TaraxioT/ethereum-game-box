// The HTTP API of the relayer (`apps/relayer`) and the demo Box (`apps/demo-box`): request bodies and responses.
// Integers travel as decimal strings (a safe JSON number is accepted too). Errors are 4xx/5xx with `ApiError`.

import type { Address, Hex } from 'viem';

/** A uint256 in JSON: a decimal (or 0x) string, or a safe integer. */
export type JsonUint = string | number;

/** `POST /names/claim`: a badge's signed `ClaimName`. */
export interface ClaimRequest {
  label: string;
  /** The badge: a wallet, or a contract account such as an agent's `P256Account`. */
  badge: Address;
  deadline: JsonUint;
  /** The badge's EIP-712 signature: ECDSA, or for a contract account what its ERC-1271 `isValidSignature` takes (a
   *  `P256Account` takes the raw P-256 form, `rawSignature` in `webauthn.ts`). */
  signature: Hex;
  primaryName?: PrimaryNameConsent;
}

/** A badge's ERC-191 consent to its new name as its primary name (`primaryNameMessage` for `<label>.gamebox.eth`).
 *  The relayer sends `setNameForAddrWithSignature` after the claim's receipt, under the same request id. */
export interface PrimaryNameConsent {
  /** Unix seconds; at least a minute and at most `PRIMARY_NAME_MAX_EXPIRY_SECONDS` away when the claim is posted. */
  expiry: JsonUint;
  signature: Hex;
}

/** One call in an `ExecuteRequest`. */
export interface CallJson {
  target: Address;
  value: JsonUint;
  data: Hex;
}

/** `POST /account/execute`: a call (`execute`) or a batch (`executeBatch`) a `P256Account`'s key signed, over
 *  `executeDigest` or `executeBatchDigest` (`messages.ts`). */
export type ExecuteRequest = {
  /** The `P256Account`: any account `P256AccountFactory` made. */
  account: Address;
  nonce: JsonUint;
  deadline: JsonUint;
  /** Raw `r ‖ s` (64 bytes) or a passkey's assertion, encoded by `webauthn.ts`. Low `s` either way. */
  signature: Hex;
} & ({ call: CallJson; calls?: never } | { calls: CallJson[]; call?: never });

/** `POST /account/deploy`: deploys the `P256Account` of a public key through `P256AccountFactory` (a new passkey's
 *  account). The 202 is a `TxView`; the account's address is `accountOf(qx, qy)` before and after. */
export interface DeployAccountRequest {
  qx: Hex;
  qy: Hex;
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

/** `POST /usdc/topup`: mints 100 test USDC to a player holding less than 25. */
export interface TopupRequest {
  /** The player: an address, or an ENS name that resolves to one (`nova.gamebox.eth`). */
  player: string;
}

/** `POST /duel/open`: a match's stakes the Box's P-256 key signed (`stakeDigest`). */
export interface StakeRequest {
  stake: {
    box: string;
    game: string;
    round: JsonUint;
    a: Address;
    b: Address;
    /** Each player's stake, in USDC base units. */
    amount: JsonUint;
    deadline: JsonUint;
  };
  r: Hex;
  s: Hex;
}

/** `POST /duel/refund`: refunds an open pot nobody settled, from an hour after it opened. */
export interface RefundRequest {
  box: string;
  round: JsonUint;
}

/** `POST /players/box-claim`: a player name for a badge, vouched for by the Box's P-256 key (`seatDigest`). */
export interface SeatRequest {
  seat: {
    label: string;
    badge: Address;
    box: string;
    deadline: JsonUint;
  };
  r: Hex;
  s: Hex;
}

/** `POST /cup/close`: closes the game's open championship once its `ends` has passed. */
export interface CupCloseRequest {
  game: string;
}

export type TxKind =
  | 'claim'
  | 'execute'
  | 'deploy'
  | 'result'
  | 'popup'
  | 'drip'
  | 'topup'
  | 'pot-open'
  | 'pot-refund'
  | 'seat'
  | 'cup-close';
export type TxStatus = 'signed' | 'sent' | 'in-block' | 'done' | 'failed';

/** One transaction of a request. */
export interface TxStep {
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

/** A relayed request's progress: the 202 of every POST route, and `GET /tx/:id`. Its own fields are the main
 *  transaction's; `status` reaches `done` only once the primary-name step has settled too, and is `failed` only if the
 *  main transaction failed. */
export interface TxView extends TxStep {
  id: string;
  kind: TxKind;
  /** A claim's primary-name transaction, when the claim asked for one. */
  primaryName?: TxStep;
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

/** The agent's setup step it needs next, or `done`. */
export type AgentStep = 'deploy' | 'claim' | 'records' | 'done';

/** `GET /agent` on the demo Box: `bot.gamebox.eth`, the practice opponent. */
export interface AgentView {
  label: string;
  name: string;
  /** Its `P256Account`: `P256AccountFactory.accountOf(qx, qy)`. */
  account: Address;
  qx: Hex;
  qy: Hex;
  /** The ENSIP-26 records it publishes. */
  records: Record<string, string>;
  /** The setup step it needs next, or `done`. */
  next: AgentStep;
}

/** `POST /result` on the demo Box. */
export interface ReportRequest {
  box: string;
  game: string;
  winner: Address;
  loser: Address;
  draw: boolean;
  /** The round of a pot this Box opened (`POST /stake`), which the result settles. Omitted: the next round. */
  round?: JsonUint;
}

/** `POST /stake` on the demo Box: opens a match's USDC pot, which a `POST /result` with its round settles. */
export interface StakeReportRequest {
  box: string;
  game: string;
  a: Address;
  b: Address;
  /** Each player's stake, in USDC base units. */
  amount: JsonUint;
}

/** The demo Box's answer to `POST /result` and `POST /stake`: the relayer's request id and the round it signed. */
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
