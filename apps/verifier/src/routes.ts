// The HTTP routes. `POST /judge` is the Box's; the reads are open, since the record's whole point is that anyone can check.

import { requireLabel } from '@egb/relayer/box';
import { guarded } from '@egb/relayer/guard';
import { Refusal } from '@egb/relayer/refusal';
import { LOG_LIMITS } from '@egb/sdk';
import type { JudgeStatus } from '@egb/shared/store';
import type { Address } from 'viem';

import { type AdmitContext, type Doors, admit } from './admit.ts';
import { boundedText } from './body.ts';
import type { AuditView } from './judge.ts';
import { parsed } from './json.ts';
import type { Scrub } from './safe.ts';

/** A pot's judgement, for the read routes. */
export interface JudgementReads {
  status(): Promise<JudgeStatus | null>;
  audit(): Promise<AuditView | null>;
}

export interface Deps {
  ctx: AdmitContext;
  doors: Doors & { reads(box: string, round: string): JudgementReads };
  /** The verifier key's address. */
  verifier: () => Address;
  scrub: Scrub;
}

const json = (status: number, body: unknown) => Response.json(body, { status });

const POT_PATH = /^\/(judge|audit)\/([a-z0-9-]{1,63})\/([0-9]{1,78})$/;

/** A log at its limit, escaped into a JSON string, with room for the rest of the body. */
const MAX_BODY_BYTES = 3 * LOG_LIMITS.logBytes;

async function read(pathname: string, deps: Deps): Promise<Response> {
  if (pathname === '/health') return json(200, { verifier: deps.verifier() });
  const [, route, box, round] = POT_PATH.exec(pathname) ?? [];
  if (!route || !box || !round) return json(404, { error: 'not found' });
  requireLabel(box, 'box');
  const reads = deps.doors.reads(box, round);
  const found = route === 'judge' ? await reads.status() : await reads.audit();
  return found ? json(200, found) : json(404, { error: 'no judgement for that pot' });
}

async function route(request: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === 'GET') return read(pathname, deps);
  if (request.method !== 'POST' || pathname !== '/judge') return json(404, { error: 'not found' });
  const text = await boundedText(request, MAX_BODY_BYTES);
  if (text === null) return json(413, { error: 'body: too large' });
  const body = parsed(text);
  if (body === undefined) return json(400, { error: 'body: expected JSON' });
  const { fresh, status } = await admit(deps.ctx, deps.doors, body);
  return json(fresh ? 202 : 200, status);
}

export function handle(request: Request, deps: Deps): Promise<Response> {
  return guarded(async () => {
    try {
      return await route(request, deps);
    } catch (error) {
      if (error instanceof Refusal) return json(error.status, { error: error.message });
      // Scrubbed here, so the guard only ever sees a safe line.
      throw new Error(deps.scrub(error));
    }
  });
}
