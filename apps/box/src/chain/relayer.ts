// The relayer (`apps/relayer`, RELAYER_URL): it pays the gas for the Box's signed requests. Every POST answers 202
// with the request's `TxView` (its id), or a 4xx/5xx `ApiError`; `GET /tx/:id` follows it to `done` or `failed`.
// A request that can't reach it at all answers status 0 with the reason.
import type { ApiError, TxView } from "@egb/shared/names";

/** A request to the relayer waits this long for its answer. */
export const RELAYER_TIMEOUT_MS = 15_000;

export type RelayerReply = { readonly status: 202 | 200; readonly tx: TxView } | { readonly status: number; readonly error: string };

export interface Relayer {
  post(path: string, body: unknown): Promise<RelayerReply>;
  /** A request's progress (`/tx/:id`). */
  tx(id: string): Promise<RelayerReply>;
}

export function relayerAt(base: string, fetcher: typeof fetch = fetch): Relayer {
  async function call(path: string, init: RequestInit): Promise<RelayerReply> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, base), { ...init, signal: AbortSignal.timeout(RELAYER_TIMEOUT_MS) });
    } catch (error) {
      return { status: 0, error: `the relayer can't be reached: ${error instanceof Error ? error.message : String(error)}` };
    }
    const body = (await response.json().catch(() => null)) as (TxView & ApiError) | null;
    if ((response.status === 200 || response.status === 202) && body && typeof body.id === "string") return { status: response.status, tx: body };
    const reason = body?.error ?? `the relayer answered ${response.status}`;
    return { status: response.status, error: body?.revert ? `${reason} (${body.revert})` : reason };
  }
  return {
    post: (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    tx: (id) => call(`/tx/${id}`, { method: "GET" }),
  };
}
