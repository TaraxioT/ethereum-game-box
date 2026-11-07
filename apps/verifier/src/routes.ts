// The HTTP routes. `POST /judge` is the Box's; the reads are open, since the record's whole point is that anyone can check.

import { requireLabel } from '@egb/relayer/box';
import { guarded } from '@egb/relayer/guard';
import { Refusal } from '@egb/relayer/refusal';
import { LOG_LIMITS } from '@egb/sdk';
import type { JudgeStatus } from '@egb/shared/store';
import type { Address } from 'viem';

import { type AdmitContext, type Doors, admit } from './admit.ts';
import { boundedText } from './body.ts';
import { PAGE_CSP, type RunRow, missingPage, runPage, runsPage } from './dashboard.ts';
import type { AuditView } from './judge.ts';
import { parsed } from './json.ts';
import type { OpenedPot } from './runs.ts';
import type { Scrub } from './safe.ts';

/** A pot's judgement, for the read routes. */
export interface JudgementReads {
  status(): Promise<JudgeStatus | null>;
  audit(): Promise<AuditView | null>;
  recordText(): Promise<string | null>;
}

export interface Deps {
  ctx: AdmitContext;
  doors: Doors & { reads(box: string, round: string): JudgementReads };
  /** The verifier key's address. */
  verifier: () => Address;
  /** Every store pot opened, for the index. */
  opened: () => Promise<readonly OpenedPot[]>;
  /** The store's game titles, by bundle hash. */
  titles: () => Promise<Readonly<Record<string, string>>>;
  scrub: Scrub;
}

const json = (status: number, body: unknown) => Response.json(body, { status });

const POT_PATH = /^\/(judge|audit)\/([a-z0-9-]{1,63})\/([0-9]{1,78})$/;
const BOX_PATH = /^\/judge\/([a-z0-9-]{1,63})\/?$/;

/** The newest runs the index shows. */
const INDEX_RUNS = 200;

const html = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP, 'x-content-type-options': 'nosniff' },
  });

/** A browser asks for HTML; the Box and `curl` don't, and keep the JSON. */
const wantsPage = (request: Request, url: URL) =>
  url.searchParams.get('format') !== 'json' && (request.headers.get('accept') ?? '').includes('text/html');

async function runRows(box: string, deps: Deps): Promise<RunRow[]> {
  const [opened, titles] = await Promise.all([deps.opened(), deps.titles().catch(() => ({}) as Record<string, string>)]);
  const mine = opened.filter((pot) => pot.box === box).sort((a, b) => Number(BigInt(b.round) - BigInt(a.round)));
  return Promise.all(
    mine.slice(0, INDEX_RUNS).map(async (pot) => ({
      ...pot,
      title: titles[pot.bundle] ?? null,
      status: await deps.doors.reads(box, pot.round).status(),
    })),
  );
}

async function boxRuns(box: string, page: boolean, deps: Deps): Promise<Response> {
  requireLabel(box, 'box');
  const rows = await runRows(box, deps);
  return page ? html(200, runsPage(box, rows)) : json(200, { box, runs: rows });
}

async function runDetail(box: string, round: string, reads: JudgementReads): Promise<Response> {
  const [status, audit, recordText] = await Promise.all([reads.status(), reads.audit(), reads.recordText()]);
  return status ? html(200, runPage({ box, round, status, audit, recordText })) : html(404, missingPage(box, round));
}

/** A log at its limit, escaped into a JSON string, with room for the rest of the body. */
const MAX_BODY_BYTES = 3 * LOG_LIMITS.logBytes;

async function read(request: Request, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const page = wantsPage(request, url);
  const [, listed] = BOX_PATH.exec(pathname) ?? [];
  if (listed) return boxRuns(listed, page, deps);
  if (pathname === '/health') return json(200, { verifier: deps.verifier() });
  const [, route, box, round] = POT_PATH.exec(pathname) ?? [];
  if (!route || !box || !round) return json(404, { error: 'not found' });
  requireLabel(box, 'box');
  const reads = deps.doors.reads(box, round);
  if (route === 'judge' && page) return runDetail(box, round, reads);
  const found = route === 'judge' ? await reads.status() : await reads.audit();
  return found ? json(200, found) : json(404, { error: 'no judgement for that pot' });
}

async function route(request: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === 'GET') return read(request, deps);
  if (request.method !== 'POST' || pathname !== '/judge') return json(404, { error: 'not found' });
  const text = await boundedText(request, MAX_BODY_BYTES);
  if (text === null) return json(413, { error: 'body: too large' });
  const body = parsed(text);
  if (body === undefined) return json(400, { error: 'body: expected JSON' });
  const { fresh, status } = await admit(deps.ctx, deps.doors, body, request.headers.get('cf-connecting-ip') ?? 'unknown');
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
