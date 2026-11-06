// The admin panel's HTTP wire: its routes and what they answer, as the server (admin.ts) and the test page's Admin
// tab see them. Amounts travel as decimal strings (ETH, USDC) and ids as strings, since JSON has no bigint. Types and
// constants only: no DOM, no Node.

/** Every admin route needs the launcher token; every one that isn't a GET also needs a local origin. */
export const ADMIN = {
  /** GET: AdminReply. */
  status: "/api/admin",
  /** POST AddGameBody: 202 AdminJob. */
  game: "/api/admin/game",
  /** POST OpenCupBody: 202 AdminJob. */
  openCup: "/api/admin/cup/open",
  /** POST CloseCupBody: 202 AdminJob. */
  closeCup: "/api/admin/cup/close",
} as const;

export interface AddGameBody {
  readonly label: string;
  /** Seconds the title lasts after the holder's last win. */
  readonly titleTerm: number;
}

export interface OpenCupBody {
  readonly game: string;
  readonly label: string;
  /** Seconds from now until scoring stops. */
  readonly runSeconds: number;
  /** USDC, as a decimal string ("0" for no prize). */
  readonly prize: string;
}

export interface CloseCupBody {
  readonly game: string;
}

export interface AdminTitle {
  readonly name: string;
  readonly holder: string | null;
  readonly holderName: string | null;
  readonly streak: number;
  /** Unix seconds; 0 before anyone won it. */
  readonly expiry: number;
  readonly live: boolean;
}

export interface AdminGame {
  readonly label: string;
  readonly name: string;
  readonly titleTerm: number;
  readonly title: AdminTitle;
  /** The open championship's id, or null. */
  readonly openCup: string | null;
}

export interface AdminCup {
  readonly id: string;
  readonly game: string;
  readonly label: string;
  readonly name: string;
  /** Unix seconds. */
  readonly ends: number;
  /** USDC. */
  readonly prize: string;
  readonly closed: boolean;
  readonly winner: string | null;
  readonly winnerName: string | null;
}

export interface AdminView {
  readonly block: string;
  /** The block's timestamp (unix seconds). */
  readonly now: number;
  /** ETH. */
  readonly eth: string;
  /** USDC. */
  readonly usdc: string;
  readonly roles: { readonly games: boolean; readonly cups: boolean; readonly minter: boolean };
  readonly games: readonly AdminGame[];
  /** The latest championships, newest first. */
  readonly cups: readonly AdminCup[];
}

export interface AdminStep {
  readonly what: string;
  readonly hash: string;
  readonly etherscan: string;
}

export interface AdminJob {
  readonly id: number;
  readonly what: string;
  readonly status: "running" | "done" | "failed";
  /** The sent transactions, in order. */
  readonly steps: readonly AdminStep[];
  /** Why it failed: the contract's error by name, or a short reason. */
  readonly error: string | null;
  /** Unix ms. */
  readonly at: number;
}

export type AdminReply =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly address: string;
      /** Null until the first read lands, or while reads fail. */
      readonly view: AdminView | null;
      readonly error: string | null;
      /** The latest jobs, newest first. */
      readonly jobs: readonly AdminJob[];
    };
