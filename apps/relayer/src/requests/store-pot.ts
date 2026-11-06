// A store game's pot in `StorePot`, paid in Store USDC:
// - `POST /store/open`: the Box's signed `Stake`, sent as `StorePot.open`, which pulls the stake from each player.
// - `POST /store/settle`: a verifier's signed `Verdict`, sent as `StorePot.settle`, which pays the split.
// - `POST /store/void`: a verifier's signed `Void`, sent as `StorePot.voidPot`, which sends each stake back.
// - `POST /store/refund`: sends each stake of a pot nobody ended back, from an hour after it opened.
// - `POST /store/topup`: `/usdc/topup`, on Store USDC.
// Each one is a 404 until `deployments/sepolia.json` has the contract it calls.

import { type TxKind, fakeUsdcAbi, formatUsdc, storePotAbi } from '@egb/shared/names';
import {
  type StoreStake,
  type StoreVerdict,
  type StoreVoid,
  storeStakeDigest,
  storeVerdictDigest,
  storeVoidDigest,
} from '@egb/shared/store';
import { type Address, type Hex, encodeFunctionData, isAddressEqual } from 'viem';

import { potLock, requireBoxSigned, requireLabel } from '../box.ts';
import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, estimatedGas, requireDeadline, simulate } from '../request.ts';
import { recoverSigner } from '../verify.ts';
import { parseRefund, requireRefundable } from './duel.ts';
import { prepareMint } from './topup.ts';

/** `IStorePot.State`. */
const STATE = ['None', 'Open', 'Settled', 'Voided', 'Refunded'] as const;

/** `StorePot.MIN_PLAYERS` and `MAX_PLAYERS`. */
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

interface Pot {
  address: Address;
  abi: typeof storePotAbi;
}

/** `StorePot`, or a 404 before it is deployed. */
function storePot(ctx: Context): Pot {
  const address = ctx.addresses.storePot;
  if (!address) throw new Refusal(404, 'StorePot is not deployed yet');
  return { address, abi: storePotAbi };
}

/** Store USDC's address, or a 404 before it is deployed. */
function storeUsdc(ctx: Context): Address {
  const address = ctx.addresses.storeUsdc;
  if (!address) throw new Refusal(404, 'Store USDC is not deployed yet');
  return address;
}

/** `body[name]`, a list with an item for each player, each read by `read`; `revert` names a list of the wrong size. */
function perPlayer<T>(
  body: field.Body,
  name: string,
  parent: string,
  read: (item: field.Body, name: string, parent: string) => T,
  revert: string,
): T[] {
  const at = `${parent}.${name}`;
  const items = body[name];
  if (!Array.isArray(items) || items.length < MIN_PLAYERS || items.length > MAX_PLAYERS) {
    throw new Refusal(400, `${at}: expected ${MIN_PLAYERS} to ${MAX_PLAYERS} items`, revert);
  }
  return items.map((item, i) => read({ [i]: item }, String(i), at));
}

function parseStake(input: unknown, pot: Address): StoreStake {
  const body = field.object(input, 'stake');
  const stake: StoreStake = {
    box: field.text(body, 'box', 'stake'),
    bundle: field.bytes32(body, 'bundle', 'stake'),
    round: field.uint(body, 'round', 'stake'),
    players: perPlayer(body, 'players', 'stake', field.address, 'PlayerCount'),
    amount: field.uint(body, 'amount', 'stake'),
    deadline: field.uint(body, 'deadline', 'stake'),
  };
  requireLabel(stake.box, 'stake.box');
  const repeated = stake.players.find((player, i) => stake.players.indexOf(player) !== i);
  if (repeated) throw new Refusal(400, `stake.players: ${repeated} is there twice`, 'RepeatedPlayer');
  if (stake.players.some((player) => isAddressEqual(player, pot))) {
    throw new Refusal(400, 'stake.players: StorePot can not be a player', 'PotIsPlayer');
  }
  if (stake.amount === 0n) throw new Refusal(400, 'stake.amount: a stake of zero', 'ZeroAmount');
  return stake;
}

function parseVerdict(input: unknown): StoreVerdict {
  const body = field.object(input, 'verdict');
  const verdict: StoreVerdict = {
    box: field.text(body, 'box', 'verdict'),
    round: field.uint(body, 'round', 'verdict'),
    payouts: perPlayer(body, 'payouts', 'verdict', field.uint, 'PayoutCount'),
    record: field.bytes32(body, 'record', 'verdict'),
    deadline: field.uint(body, 'deadline', 'verdict'),
  };
  requireLabel(verdict.box, 'verdict.box');
  return verdict;
}

function parseVoid(input: unknown): StoreVoid {
  const body = field.object(input, 'void');
  const voiding: StoreVoid = {
    box: field.text(body, 'box', 'void'),
    round: field.uint(body, 'round', 'void'),
    record: field.bytes32(body, 'record', 'void'),
    deadline: field.uint(body, 'deadline', 'void'),
  };
  requireLabel(voiding.box, 'void.box');
  return voiding;
}

/** Throws a 401 unless `signature` over `digest` recovers, then a 403 unless its signer holds `VERIFIER_ROLE` now. */
async function requireVerifierSigned(ctx: Context, pot: Pot, digest: Hex, signature: Hex): Promise<void> {
  const signer = await recoverSigner(digest, signature);
  const role = await ctx.client.readContract({ ...pot, functionName: 'VERIFIER_ROLE' });
  const verifier = await ctx.client.readContract({ ...pot, functionName: 'hasRole', args: [role, signer] });
  if (!verifier) throw new Refusal(403, `${signer} does not hold VERIFIER_ROLE`, 'NotVerifier');
}

/** The pot of `(box, round)`, or a 409 unless it is open. */
async function openPot(ctx: Context, pot: Pot, box: string, round: bigint) {
  const entry = await ctx.client.readContract({ ...pot, functionName: 'getPot', args: [box, round] });
  if (entry.state !== 1) {
    throw new Refusal(409, `round ${round} of ${box} has no open pot (${STATE[entry.state]})`, 'PotNotOpen');
  }
  return entry;
}

/** `call`, simulated, with its gas limit, under the lock that keeps a round to one transaction in flight. */
async function roundCall(
  ctx: Context,
  kind: TxKind,
  { box, round }: { box: string; round: bigint },
  call: { to: Address; data: Hex },
  replay?: Prepared['replay'],
): Promise<Prepared> {
  await simulate(ctx, call);
  return { kind, ...call, value: 0n, gas: await estimatedGas(ctx, call), replay, locks: [potLock(box, round)] };
}

export async function prepareStoreOpen(ctx: Context, input: unknown): Promise<Prepared> {
  const pot = storePot(ctx);
  const token = { address: storeUsdc(ctx), abi: fakeUsdcAbi } as const;
  const body = field.object(input);
  const stake = parseStake(body.stake, pot.address);
  const r = field.bytes32(body, 'r');
  const s = field.bytes32(body, 's');
  requireDeadline(ctx, stake.deadline);
  const digest = storeStakeDigest(stake, pot.address);
  await requireBoxSigned(ctx, stake.box, digest, r, s);

  const [listed, existing, balances] = await Promise.all([
    ctx.client.readContract({ ...pot, functionName: 'listed', args: [stake.bundle] }),
    ctx.client.readContract({ ...pot, functionName: 'getPot', args: [stake.box, stake.round] }),
    Promise.all(stake.players.map((player) => ctx.client.readContract({ ...token, functionName: 'balanceOf', args: [player] }))),
  ]);
  if (!listed) throw new Refusal(403, `bundle ${stake.bundle} is not listed`, 'NotListed');
  if (existing.state !== 0) {
    throw new Refusal(409, `round ${stake.round} of ${stake.box} already had a pot (${STATE[existing.state]})`, 'PotExists');
  }
  for (const [i, balance] of balances.entries()) {
    if (balance < stake.amount) {
      throw new Refusal(409, `${stake.players[i]} holds ${formatUsdc(balance)} USDC, under the stake of ${formatUsdc(stake.amount)}`);
    }
  }

  const call = { to: pot.address, data: encodeFunctionData({ ...pot, functionName: 'open', args: [stake, r, s] }) };
  return roundCall(ctx, 'store-open', stake, call, { key: digest, until: Number(stake.deadline) });
}

export async function prepareStoreSettle(ctx: Context, input: unknown): Promise<Prepared> {
  const pot = storePot(ctx);
  const body = field.object(input);
  const verdict = parseVerdict(body.verdict);
  const signature = field.hex(body, 'signature');
  requireDeadline(ctx, verdict.deadline);
  const digest = storeVerdictDigest(verdict, pot.address);
  await requireVerifierSigned(ctx, pot, digest, signature);

  const { players, amount } = await openPot(ctx, pot, verdict.box, verdict.round);
  if (verdict.payouts.length !== players.length) {
    throw new Refusal(409, `${verdict.payouts.length} payouts for ${players.length} players`, 'PayoutCount');
  }
  const total = amount * BigInt(players.length);
  const sum = verdict.payouts.reduce((a, b) => a + b, 0n);
  if (sum !== total) {
    throw new Refusal(409, `the payouts add up to ${formatUsdc(sum)} USDC, not the pot's ${formatUsdc(total)}`, 'PayoutSum');
  }

  const call = { to: pot.address, data: encodeFunctionData({ ...pot, functionName: 'settle', args: [verdict, signature] }) };
  return roundCall(ctx, 'store-settle', verdict, call, { key: digest, until: Number(verdict.deadline) });
}

export async function prepareStoreVoid(ctx: Context, input: unknown): Promise<Prepared> {
  const pot = storePot(ctx);
  const body = field.object(input);
  const voiding = parseVoid(body.void);
  const signature = field.hex(body, 'signature');
  requireDeadline(ctx, voiding.deadline);
  const digest = storeVoidDigest(voiding, pot.address);
  await requireVerifierSigned(ctx, pot, digest, signature);
  await openPot(ctx, pot, voiding.box, voiding.round);

  const call = { to: pot.address, data: encodeFunctionData({ ...pot, functionName: 'voidPot', args: [voiding, signature] }) };
  return roundCall(ctx, 'store-void', voiding, call, { key: digest, until: Number(voiding.deadline) });
}

export async function prepareStoreRefund(ctx: Context, input: unknown): Promise<Prepared> {
  const pot = storePot(ctx);
  const { box, round } = parseRefund(input);
  const [entry, delay] = await Promise.all([
    openPot(ctx, pot, box, round),
    ctx.client.readContract({ ...pot, functionName: 'REFUND_DELAY' }),
  ]);
  requireRefundable(ctx, entry.opened, delay);

  const call = { to: pot.address, data: encodeFunctionData({ ...pot, functionName: 'refund', args: [box, round] }) };
  return roundCall(ctx, 'store-refund', { box, round }, call);
}

export async function prepareStoreTopup(ctx: Context, input: unknown): Promise<Prepared> {
  return prepareMint(ctx, input, storeUsdc(ctx), 'store-topup');
}
