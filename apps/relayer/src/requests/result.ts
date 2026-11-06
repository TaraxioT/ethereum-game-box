// `POST /box/result`: a match result a Box's P-256 key signed, sent as `BoxResults.submit`.

import { boxResultsAbi, gameBoxNamesAbi, labelProblem, resultDigest, type Result } from '@egb/shared/names';
import { encodeFunctionData } from 'viem';

import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, estimatedGas, requireDeadline, simulate } from '../request.ts';
import { requireP256 } from '../verify.ts';

function parseResult(input: unknown): Result {
  const body = field.object(input, 'result');
  const result: Result = {
    box: field.text(body, 'box'),
    game: field.text(body, 'game'),
    round: field.uint(body, 'round'),
    winner: field.address(body, 'winner'),
    loser: field.address(body, 'loser'),
    draw: field.bool(body, 'draw'),
    deadline: field.uint(body, 'deadline'),
  };
  for (const key of ['box', 'game'] as const) {
    const problem = labelProblem(result[key]);
    if (problem) throw new Refusal(400, `result.${key}: ${problem}`);
  }
  return result;
}

export async function prepareResult(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const result = parseResult(body.result);
  const r = field.bytes32(body, 'r');
  const s = field.bytes32(body, 's');
  requireDeadline(ctx, result.deadline);

  const box = await ctx.client.readContract({
    address: ctx.addresses.names,
    abi: gameBoxNamesAbi,
    functionName: 'getBox',
    args: [result.box],
  });
  if (box.status === 0) throw new Refusal(403, `${result.box} is not a Box`, 'UnknownBox');
  requireP256(resultDigest(result, ctx.addresses.results), r, s, box.qx, box.qy);

  const results = { address: ctx.addresses.results, abi: boxResultsAbi } as const;
  const used = await ctx.client.readContract({ ...results, functionName: 'roundUsed', args: [result.box, result.round] });
  if (used) throw new Refusal(409, `round ${result.round} of ${result.box} is already settled`, 'RoundUsed');

  const call = { to: ctx.addresses.results, data: encodeFunctionData({ ...results, functionName: 'submit', args: [result, r, s] }) };
  await simulate(ctx, call);
  return {
    kind: 'result',
    ...call,
    value: 0n,
    gas: await estimatedGas(ctx, call),
    replay: { key: resultDigest(result, ctx.addresses.results), until: Number(result.deadline) },
    locks: [`round:${result.box}:${result.round}`],
  };
}
