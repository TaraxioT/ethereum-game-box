// The relayer and the demo Box over HTTP, with the request and response types from `@egb/shared/names`.
import type { Address } from "viem";
import type {
  ApiError,
  ClaimRequest,
  DemoBoxView,
  DripRequest,
  PopupRequest,
  RelayerHealth,
  ReportRequest,
  ReportResponse,
  TxView,
} from "@egb/shared/names";

import { DEMO_BOX_URL, RELAYER_URL } from "./config.ts";

/** `POST /usdc/topup`: 100 test USDC to a player whose balance is under 25. `player` is an address or an ENS name,
 * which the relayer resolves. */
export interface TopUpRequest {
  player: string;
}

/** `POST /cup/close`: closes `game`'s open championship once its `ends` has passed. */
export interface CloseCupRequest {
  game: string;
}

/** A refused request: the reason, and the contract error the relayer's `eth_call` hit, if any. */
export class ApiRefusal extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.revert ?? body.error);
  }
}

async function request<T>(base: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T | ApiError;
  if (!res.ok) throw new ApiRefusal(res.status, json as ApiError);
  return json as T;
}

export const relayer = {
  claim: (body: ClaimRequest) => request<TxView>(RELAYER_URL, "/names/claim", body),
  popup: (body: PopupRequest) => request<TxView>(RELAYER_URL, "/box/popup", body),
  drip: (body: DripRequest) => request<TxView>(RELAYER_URL, "/names/drip", body),
  topUp: (body: TopUpRequest) => request<TxView>(RELAYER_URL, "/usdc/topup", body),
  closeCup: (body: CloseCupRequest) => request<TxView>(RELAYER_URL, "/cup/close", body),
  tx: (id: string) => request<TxView>(RELAYER_URL, `/tx/${encodeURIComponent(id)}`),
  health: () => request<RelayerHealth>(RELAYER_URL, "/health"),
};

export const demoBox = {
  report: (body: ReportRequest) => request<ReportResponse>(DEMO_BOX_URL, "/result", body),
  box: () => request<DemoBoxView>(DEMO_BOX_URL, "/box"),
};

/** The relayer's wallet, once `/health` has answered: a known account in every Try grid (it holds no role). */
let relayerAddress: Address | null = null;
export function knownRelayer(): Address | null {
  return relayerAddress;
}
export function rememberRelayer(health: RelayerHealth): void {
  relayerAddress = health.address;
}
