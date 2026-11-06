// `POST /box/result`: a match result a Box's P-256 key signed, sent as `BoxResults.submit`. One transaction crowns the
// winner, records both players' stats, settles the match's USDC pot if `(box, round)` has one, and scores the game's
// open championship.

import { boxResultsAbi, resultDigest, type Result } from '@egb/shared/names';
import { encodeFunctionData } from 'viem';

import { potLock, requireBoxSigned, requireLabel } from '../box.ts';
import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, callGas, requireDeadline, simulate } from '../request.ts';

function parseResult(input: unknown): Result {
  const body = field.object(input, 'result');
  const result: Result = {
    box: field.text(body, 'box', 'result'),
    game: field.text(body, 'game', 'result'),
    round: field.uint(body, 'round', 'result'),
    winner: field.address(body, 'winner', 'result'),
    loser: field.address(body, 'loser', 'result'),
    draw: field.bool(body, 'draw', 'result'),
    deadline: field.uint(body, 'deadline', 'result'),
  };
  requireLabel(result.box, 'result.box');
  requireLabel(result.game, 'result.game');
  return result;
}

export async function prepareResult(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const result = parseResult(body.result);
  const r = field.bytes32(body, 'r');
  const s = field.bytes32(body, 's');
  requireDeadline(ctx, result.deadline);
  const digest = resultDigest(result, ctx.addresses.results);
  await requireBoxSigned(ctx, result.box, digest, r, s);

  const results = { address: ctx.addresses.results, abi: boxResultsAbi } as const;
  const used = await ctx.client.readContract({ ...results, functionName: 'roundUsed', args: [result.box, result.round] });
  if (used) throw new Refusal(409, `round ${result.round} of ${result.box} is already settled`, 'RoundUsed');

  const call = { to: ctx.addresses.results, data: encodeFunctionData({ ...results, functionName: 'submit', args: [result, r, s] }) };
  // A wrong pot (`PotMismatch`) or a non-player (`NotAPlayer`) reverts here, by name.
  await simulate(ctx, call);
  return {
    kind: 'result',
    ...call,
    value: 0n,
    // The championship's `score` runs under a 3M cap and writes records, so the estimate is large: `callGas` gives it
    // the state-gas reservoir.
    gas: await callGas(ctx, call),
    replay: { key: digest, until: Number(result.deadline) },
    // A result sent before its round's `/duel/open` is mined would leave the pot open for good (only a refund then):
    // it waits for the pot's request, which holds the same lock.
    locks: [`round:${result.box}:${result.round}`, potLock(result.box, result.round)],
  };
}
