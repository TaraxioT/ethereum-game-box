// The relayer and the demo Box over HTTP, with the request and response types from `@egb/shared/names`.
import type { Address, Hex } from "viem";
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

/** The claim with the badge's primary-name signature. `api.ts` takes this field once the relayer ships it. */
type ClaimWithPrimary = ClaimRequest & { primaryName?: { expiry: string; signature: Hex } };

export const relayer = {
  claim: (body: ClaimWithPrimary) => request<TxView>(RELAYER_URL, "/names/claim", body),
  popup: (body: PopupRequest) => request<TxView>(RELAYER_URL, "/box/popup", body),
  drip: (body: DripRequest) => request<TxView>(RELAYER_URL, "/names/drip", body),
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
