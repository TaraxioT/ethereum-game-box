// A match's USDC pot in `DuelPot`:
// - `POST /duel/open`: the Box's signed `Stake`, sent as `DuelPot.open`, which pulls the stake from both players. The
//   result (`POST /box/result`) of the same `(box, round)` settles it.
// - `POST /duel/refund`: refunds both players of a pot nobody settled, from an hour after it opened.

import { type Stake, duelPotAbi, fakeUsdcAbi, formatUsdc, gameBoxNamesAbi, stakeDigest } from '@egb/shared/names';
import { type Address, encodeFunctionData } from 'viem';

import { requireBoxSigned, requireLabel } from '../box.ts';
import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, estimatedGas, requireDeadline, simulate } from '../request.ts';

/** `IDuelPot.State`. */
const STATE = ['None', 'Open', 'Settled', 'Refunded'] as const;

function parseStake(input: unknown): Stake {
  const body = field.object(input, 'stake');
  const stake: Stake = {
    box: field.text(body, 'box', 'stake'),
    game: field.text(body, 'game', 'stake'),
    round: field.uint(body, 'round', 'stake'),
    a: field.address(body, 'a', 'stake'),
    b: field.address(body, 'b', 'stake'),
    amount: field.uint(body, 'amount', 'stake'),
    deadline: field.uint(body, 'deadline', 'stake'),
  };
  requireLabel(stake.box, 'stake.box');
  requireLabel(stake.game, 'stake.game');
  if (stake.a === stake.b) throw new Refusal(400, 'stake: a and b are the same player', 'SamePlayer');
  if (stake.amount === 0n) throw new Refusal(400, 'stake.amount: a stake of zero', 'ZeroAmount');
  return stake;
}

const lock = (box: string, round: bigint) => `pot:${box}:${round}`;

/** Throws unless `player` holds a player name (a result needs both players to have one, or the pot can only be
 *  refunded) and at least `amount` USDC. */
async function requireStakeable(ctx: Context, player: Address, amount: bigint): Promise<void> {
  const [name, balance] = await Promise.all([
    ctx.client.readContract({ address: ctx.addresses.names, abi: gameBoxNamesAbi, functionName: 'nameOf', args: [player] }),
    ctx.client.readContract({ address: ctx.addresses.usdc, abi: fakeUsdcAbi, functionName: 'balanceOf', args: [player] }),
  ]);
  if (!name) throw new Refusal(403, `${player} holds no player name`, 'NotAPlayer');
  if (balance < amount) {
    throw new Refusal(409, `${name} holds ${formatUsdc(balance)} USDC, under the stake of ${formatUsdc(amount)}`);
  }
}

export async function prepareDuelOpen(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const stake = parseStake(body.stake);
  const r = field.bytes32(body, 'r');
  const s = field.bytes32(body, 's');
  requireDeadline(ctx, stake.deadline);
  const digest = stakeDigest(stake, ctx.addresses.pot);
  await requireBoxSigned(ctx, stake.box, digest, r, s);

  const pot = { address: ctx.addresses.pot, abi: duelPotAbi } as const;
  const existing = await ctx.client.readContract({ ...pot, functionName: 'getPot', args: [stake.box, stake.round] });
  if (existing.state !== 0) {
    throw new Refusal(409, `round ${stake.round} of ${stake.box} already had a pot (${STATE[existing.state]})`, 'PotExists');
  }
  await Promise.all([requireStakeable(ctx, stake.a, stake.amount), requireStakeable(ctx, stake.b, stake.amount)]);

  const call = { to: pot.address, data: encodeFunctionData({ ...pot, functionName: 'open', args: [stake, r, s] }) };
  await simulate(ctx, call);
  return {
    kind: 'pot-open',
    ...call,
    value: 0n,
    gas: await estimatedGas(ctx, call),
    replay: { key: digest, until: Number(stake.deadline) },
    locks: [lock(stake.box, stake.round)],
  };
}

export async function prepareDuelRefund(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const box = field.text(body, 'box');
  requireLabel(box, 'box');
  const round = field.uint(body, 'round');

  const pot = { address: ctx.addresses.pot, abi: duelPotAbi } as const;
  const [entry, delay] = await Promise.all([
    ctx.client.readContract({ ...pot, functionName: 'getPot', args: [box, round] }),
    ctx.client.readContract({ ...pot, functionName: 'REFUND_DELAY' }),
  ]);
  if (entry.state !== 1) {
    throw new Refusal(409, `round ${round} of ${box} has no open pot (${STATE[entry.state]})`, 'PotNotOpen');
  }
  const refundableAt = BigInt(entry.opened) + BigInt(delay);
  if (BigInt(ctx.now()) < refundableAt) {
    throw new Refusal(409, `the pot can be refunded from ${refundableAt} (an hour after it opened)`, 'TooEarly');
  }

  const call = { to: pot.address, data: encodeFunctionData({ ...pot, functionName: 'refund', args: [box, round] }) };
  await simulate(ctx, call);
  return { kind: 'pot-refund', ...call, value: 0n, gas: await estimatedGas(ctx, call), locks: [lock(box, round)] };
}
