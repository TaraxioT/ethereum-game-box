// `POST /judge`'s checks, in order of cost. Everything the Box sends is untrusted until its signature checks out, and
// after that the chain and the store still have the last word: the pot's terms come from `StorePot`, and the
// instructions from the bundle the pot was staked on.

import { type BoxContext, requireBoxSigned, requireLabel } from '@egb/relayer/box';
import * as field from '@egb/relayer/parse';
import { Refusal } from '@egb/relayer/refusal';
import { type MatchLog, logTextProblems } from '@egb/sdk';
import { type JudgeStatus, judgeDigest, jsonTextHash } from '@egb/shared/store';
import { type Address, type Hex, isAddressEqual } from 'viem';

import { fetchManifest } from './bundle.ts';
import { ANOTHER_LOG, type JudgeJob } from './judge.ts';
import { POT_STATE, type Pot, readPot } from './pot.ts';
import type { Upstream } from './upstream.ts';

export interface AdmitContext extends BoxContext {
  /** `StorePot`'s address, read when asked: the Worker runs before it is deployed. */
  readonly pot: () => Address;
  readonly store: Upstream;
}

/** A pot's judgement, as a route sees it: the Durable Object's stub, or a `Judge` in tests. */
export interface JudgementDoor {
  find(logHash: Hex): Promise<JudgeStatus | typeof ANOTHER_LOG | null>;
  begin(job: JudgeJob): Promise<JudgeStatus | typeof ANOTHER_LOG>;
}

export interface Doors {
  judgement(box: string, round: string): JudgementDoor;
  /** Counts one new judgement against a Box. Returns the limit it broke, or null. */
  takeJudgement(box: string, now: number): Promise<string | null>;
  /** Gives back the count taken at `at`. */
  returnJudgement(box: string, at: number): Promise<void>;
}

export interface Signed {
  readonly text: string;
  readonly log: MatchLog;
  readonly hash: Hex;
  readonly deadline: bigint;
  readonly r: Hex;
  readonly s: Hex;
}

const ANOTHER_LOG_REFUSAL = 'this pot is already being judged, on another log';

/** The request's fields and its log, checked for shape alone. The check is on the text, since the agent, the signature
 *  and the audit record all use the text, not what it parses to. */
export function parseRequest(input: unknown): Signed {
  const body = field.object(input);
  const text = field.text(body, 'log');
  const deadline = field.uint(body, 'deadline');
  const r = field.bytes32(body, 'r');
  const s = field.bytes32(body, 's');
  const [problem] = logTextProblems(text);
  if (problem) throw new Refusal(400, `log: ${problem}`);
  return { text, log: JSON.parse(text) as MatchLog, hash: jsonTextHash(text), deadline, r, s };
}

/** Throws unless the Box signed this exact log, and the deadline hasn't passed. */
async function requireSigned(ctx: AdmitContext, { log, hash, deadline, r, s }: Signed): Promise<void> {
  const { box, round } = log.header;
  requireLabel(box, 'log.header.box');
  if (deadline <= BigInt(ctx.now())) throw new Refusal(400, `deadline ${deadline} has passed`);
  const digest = judgeDigest({ box, round: BigInt(round), log: hash, deadline }, ctx.pot());
  await requireBoxSigned(ctx, box, digest, r, s);
}

/** Throws unless the pot is open on exactly the terms the log's header states. */
function requireSamePot(pot: Pot, { header }: MatchLog): void {
  if (pot.state !== POT_STATE.open) throw new Refusal(409, `round ${header.round} of ${header.box} has no open pot`, 'PotNotOpen');
  const samePlayers =
    pot.players.length === header.players.length && pot.players.every((player, i) => isAddressEqual(player, header.players[i] as Address));
  if (!samePlayers) throw new Refusal(409, "the log's players aren't the pot's");
  if (pot.amount !== BigInt(header.amount)) throw new Refusal(409, "the log's amount isn't the pot's");
  if (pot.bundle !== header.bundle) throw new Refusal(409, "the log's bundle isn't the pot's");
}

/** Reads the pot and the bundle, and opens the judgement if they agree with the log. */
async function open(ctx: AdmitContext, judgement: JudgementDoor, { log, hash, text }: Signed): Promise<JudgeStatus> {
  const { box, round, bundle, game, players, amount } = log.header;
  requireSamePot(await readPot(ctx.client, ctx.pot(), box, BigInt(round)), log);
  const manifest = await fetchManifest(ctx.store, bundle);
  if (manifest.id !== game) throw new Refusal(409, "the log's game isn't the bundle's");

  const status = await judgement.begin({
    box,
    round,
    bundle,
    logHash: hash,
    log: text,
    instructions: manifest.verifier.instructions,
    seats: players.length,
    amount,
  });
  if (status === ANOTHER_LOG) throw new Refusal(409, ANOTHER_LOG_REFUSAL);
  return status;
}

export type Admitted = { readonly fresh: boolean; readonly status: JudgeStatus };

/** Runs every check, and opens the pot's one judgement. A repeat of the same log gets the running one back. */
export async function admit(ctx: AdmitContext, doors: Doors, input: unknown): Promise<Admitted> {
  const signed = parseRequest(input);
  await requireSigned(ctx, signed);

  const { box, round } = signed.log.header;
  const judgement = doors.judgement(box, round);
  const found = await judgement.find(signed.hash);
  if (found === ANOTHER_LOG) throw new Refusal(409, ANOTHER_LOG_REFUSAL);
  if (found) return { fresh: false, status: found };

  const now = ctx.now();
  const limited = await doors.takeJudgement(box, now);
  if (limited) throw new Refusal(429, `rate limit: ${limited}`);
  try {
    return { fresh: true, status: await open(ctx, judgement, signed) };
  } catch (error) {
    // Something upstream failed, and the Box will repeat this: an outage mustn't use up its hour. A refusal keeps its
    // count, as an honest Box doesn't repeat one, and the reads it cost are what the limit is there to bound.
    if (!(error instanceof Refusal)) await doors.returnJudgement(box, now);
    throw error;
  }
}
