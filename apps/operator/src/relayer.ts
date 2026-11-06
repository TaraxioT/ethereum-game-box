// The relayer over HTTP, with the request and response types from `@egb/shared/names`. It pays the gas for what a
// passkey signed: `POST /account/deploy` makes a passkey's account, `POST /account/execute` runs its signed calls.
import type { ApiError, DeployAccountRequest, ExecuteRequest, RelayerHealth, TxView } from "@egb/shared/names";

import { RELAYER_URL } from "./config.ts";

/** A refused request: the reason, and the contract error the relayer's `eth_call` hit, if any. */
export class ApiRefusal extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.revert ?? body.error);
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${RELAYER_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T | ApiError;
  if (!res.ok) throw new ApiRefusal(res.status, json as ApiError);
  return json as T;
}

export const relayer = {
  execute: (body: ExecuteRequest) => request<TxView>("/account/execute", body),
  deploy: (body: DeployAccountRequest) => request<TxView>("/account/deploy", body),
  tx: (id: string) => request<TxView>(`/tx/${encodeURIComponent(id)}`),
  health: () => request<RelayerHealth>("/health"),
};
