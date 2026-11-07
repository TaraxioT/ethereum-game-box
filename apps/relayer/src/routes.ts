// The HTTP routes. Each POST route runs its checks (no gas), then hands the checked call to the sender.

import type { RelayerHealth, TxView } from '@egb/shared/names';

import { corsHeaders, originAllowed } from './cors.ts';
import { guarded } from './guard.ts';
import { Refusal } from './refusal.ts';
import type { Context, Prepared } from './request.ts';
import { prepareBuy } from './requests/buy.ts';
import { prepareClaim } from './requests/claim.ts';
import { prepareCupClose } from './requests/cup.ts';
import { prepareDeploy } from './requests/deploy.ts';
import { prepareDrip } from './requests/drip.ts';
import { prepareDuelOpen, prepareDuelRefund } from './requests/duel.ts';
import { prepareExecute } from './requests/execute.ts';
import { preparePopup } from './requests/popup.ts';
import { prepareResult } from './requests/result.ts';
import { prepareSeat } from './requests/seat.ts';
import {
  prepareStoreOpen,
  prepareStoreRefund,
  prepareStoreSettle,
  prepareStoreTopup,
  prepareStoreVoid,
} from './requests/store-pot.ts';
import { prepareTopup } from './requests/topup.ts';
import type { Submitted } from './sender.ts';

/** The sender, as the routes see it (the Durable Object's stub, or a `Relay` in tests). */
export interface Relayer {
  submit(request: Prepared, ip: string): Promise<Submitted>;
  status(id: string): Promise<TxView | null>;
  health(): Promise<RelayerHealth>;
}

export interface Deps {
  ctx: Context;
  relayer: Relayer;
  allowedOrigins: string;
}

const prepare: Record<string, (ctx: Context, body: unknown) => Promise<Prepared>> = {
  '/names/claim': prepareClaim,
  '/names/drip': prepareDrip,
  '/account/execute': prepareExecute,
  '/account/deploy': prepareDeploy,
  '/box/result': prepareResult,
  '/box/popup': preparePopup,
  '/usdc/topup': prepareTopup,
  '/duel/open': prepareDuelOpen,
  '/duel/refund': prepareDuelRefund,
  '/players/box-claim': prepareSeat,
  '/cup/close': prepareCupClose,
  '/store/open': prepareStoreOpen,
  '/store/settle': prepareStoreSettle,
  '/store/void': prepareStoreVoid,
  '/store/refund': prepareStoreRefund,
  '/store/topup': prepareStoreTopup,
  '/swap/buy': prepareBuy,
};

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  Response.json(body, { status, headers });

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && !originAllowed(origin, deps.allowedOrigins)) return json(403, { error: 'origin not allowed' }, {});
  const cors = corsHeaders(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  return guarded(async () => {
    const { pathname } = new URL(request.url);
    const route = prepare[pathname];
    if (route && request.method === 'POST') {
      const body: unknown = await request.json().catch(() => undefined);
      if (body === undefined) return json(400, { error: 'body: expected JSON' }, cors);
      let checked: Prepared;
      try {
        checked = await route(deps.ctx, body);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        return json(error.status, { error: error.message, ...(error.revert && { revert: error.revert }) }, cors);
      }
      const sent = await deps.relayer.submit(checked, request.headers.get('cf-connecting-ip') ?? 'unknown');
      return sent.ok ? json(202, sent.tx, cors) : json(sent.status, { error: sent.error }, cors);
    }
    if (request.method === 'GET') {
      const id = /^\/tx\/([0-9a-f-]{36})$/.exec(pathname)?.[1];
      if (id) {
        const tx = await deps.relayer.status(id);
        return tx ? json(200, tx, cors) : json(404, { error: 'no request with that id' }, cors);
      }
      if (pathname === '/health') return json(200, await deps.relayer.health(), cors);
    }
    return json(404, { error: 'not found' }, cors);
  }, cors);
}
