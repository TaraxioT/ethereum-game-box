// The relayer and the demo Box over HTTP, typed with `names/api.ts`. A refused request throws `ApiRefusal`, with the
// relayer's reason and the contract error its `eth_call` hit.

import type {
  ApiError,
  ClaimRequest,
  DemoBoxView,
  DeployAccountRequest,
  DripRequest,
  ExecuteRequest,
  PopupRequest,
  RelayerHealth,
  ReportRequest,
  ReportResponse,
  TxView,
} from '../names/api.ts';

/** The live Workers. A site's dev server usually passes requests through to them, since their CORS allows only the
 *  live sites. */
export const RELAYER_URL = 'https://gamebox-relayer.mathew.workers.dev';
export const DEMO_BOX_URL = 'https://gamebox-demo-box.mathew.workers.dev';

/** A refused request: the HTTP status, the reason, and the contract error the relayer's `eth_call` hit, if any. */
export class ApiRefusal extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.revert ?? body.error);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(base: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T | ApiError;
  if (!res.ok) throw new ApiRefusal(res.status, json as ApiError);
  return json as T;
}

export type Relayer = ReturnType<typeof relayerClient>;

/** The relayer at `base` (e.g. `RELAYER_URL`, or a dev server's pass-through path). */
export function relayerClient(base: string) {
  return {
    claim: (body: ClaimRequest) => request<TxView>(base, '/names/claim', body),
    popup: (body: PopupRequest) => request<TxView>(base, '/box/popup', body),
    drip: (body: DripRequest) => request<TxView>(base, '/names/drip', body),
    execute: (body: ExecuteRequest) => request<TxView>(base, '/account/execute', body),
    deploy: (body: DeployAccountRequest) => request<TxView>(base, '/account/deploy', body),
    tx: (id: string) => request<TxView>(base, `/tx/${encodeURIComponent(id)}`),
    health: () => request<RelayerHealth>(base, '/health'),
  };
}

export type DemoBox = ReturnType<typeof demoBoxClient>;

/** The demo Box at `base`. */
export function demoBoxClient(base: string) {
  return {
    report: (body: ReportRequest) => request<ReportResponse>(base, '/result', body),
    box: () => request<DemoBoxView>(base, '/box'),
  };
}
