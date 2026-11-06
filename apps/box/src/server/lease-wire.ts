// The lease's HTTP wire: its routes and what they answer, as the server (lease.ts) and the screen (the lease pill and
// the offline gate) see them. GBX travels as decimal strings, times as unix seconds. Types and constants only.
import type { AdminJob } from "./admin-wire.ts";

export const LEASE = {
  /** GET, anyone: LeaseReply. */
  status: "/api/lease",
  /** POST StakeBody, launcher token: 202 AdminJob. */
  stake: "/api/lease/stake",
  /** POST, launcher token: 202 AdminJob. */
  unstake: "/api/lease/unstake",
} as const;

/**
 * Whether the Box may host. `off`: no Sepolia here (the simulator), nothing gates it. `checking`: not read yet.
 * `open`: GBX is staked and its name is Active. `closed`: it isn't, and the Box refuses every tap and command.
 */
export type LeaseGate = "off" | "checking" | "open" | "closed";

export interface LeaseStatus {
  readonly label: string;
  /** `<label>.gamebox.eth`. */
  readonly name: string;
  readonly standing: "none" | "active" | "suspended" | "revoked";
  /** The name's expiry; 0 with no name. */
  readonly expiry: number;
  /** The lease's start and end; null with nothing staked. */
  readonly startedAt: number | null;
  readonly endsAt: number | null;
  /** GBX staked. */
  readonly stake: string;
  /** Who staked, and gets it back. */
  readonly operator: string | null;
  /** GBX per hour. */
  readonly ratePerHour: string;
  readonly minHours: number;
  readonly maxHours: number;
  /** The staker's GBX; null with no admin key. */
  readonly gbx: string | null;
  /** The contracts a stake or unstake goes through, and the ENS ones it writes. */
  readonly ens: LeaseEns;
}

/**
 * `BoxLease` calls `GameBoxNames`, which writes ENS: a first stake registers `<label>` on gamebox.eth's registry and
 * makes the name's resolver (addr, `boxKey`, `status` = active); a stake renews the name's expiry on the registry and
 * sets `status` back to active; an unstake or lapse sets only `status` = suspended. The expiry is never cut short.
 */
export interface LeaseEns {
  readonly lease: string;
  readonly names: string;
  /** gamebox.eth's registry (an ENSv2 `UserRegistry`): the name's owner and expiry. */
  readonly registry: string;
  /** The name's `PermissionedResolver`; null with no name. */
  readonly resolver: string | null;
}

export interface LeaseReply {
  readonly gate: LeaseGate;
  /** The chain's time when answered: the screen counts `endsAt` down from it. */
  readonly now: number;
  /** Null before the first read, and with the gate off. */
  readonly status: LeaseStatus | null;
  /** The address that stakes and unstakes (EGB_ADMIN_KEY's); null when this Box can't send. */
  readonly staker: string | null;
  readonly error: string | null;
  readonly jobs: readonly AdminJob[];
}

export interface StakeBody {
  readonly hours: number;
}
