// `POST /players/box-claim`: a player name for a badge that tapped a Box, vouched for by the Box's signed `Seat` (a
// HaLo badge can't sign a `ClaimName`), sent as `BoxSeats.claim`. The name is exactly what `/names/claim` gives.

import { type Seat, boxSeatsAbi, seatDigest } from '@egb/shared/names';
import { encodeFunctionData } from 'viem';

import { requireBoxSigned, requireLabel } from '../box.ts';
import * as field from '../parse.ts';
import { CREATES_STORAGE_GAS, type Context, type Prepared, requireDeadline, simulate } from '../request.ts';
import { requireFreeName } from './claim.ts';

function parseSeat(input: unknown): Seat {
  const body = field.object(input, 'seat');
  const seat: Seat = {
    label: field.text(body, 'label', 'seat'),
    badge: field.address(body, 'badge', 'seat'),
    box: field.text(body, 'box', 'seat'),
    deadline: field.uint(body, 'deadline', 'seat'),
  };
  requireLabel(seat.label, 'seat.label');
  requireLabel(seat.box, 'seat.box');
  return seat;
}

export async function prepareSeat(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const seat = parseSeat(body.seat);
  const r = field.bytes32(body, 'r');
  const s = field.bytes32(body, 's');
  requireDeadline(ctx, seat.deadline);
  const digest = seatDigest(seat, ctx.addresses.seats);
  await requireBoxSigned(ctx, seat.box, digest, r, s);
  await requireFreeName(ctx, seat.label, seat.badge);

  const seats = { address: ctx.addresses.seats, abi: boxSeatsAbi } as const;
  const call = { to: seats.address, data: encodeFunctionData({ ...seats, functionName: 'claim', args: [seat, r, s] }) };
  await simulate(ctx, call);
  return {
    kind: 'seat',
    ...call,
    value: 0n,
    // A new resolver for the name, which the estimate undercounts.
    gas: CREATES_STORAGE_GAS,
    replay: { key: digest, until: Number(seat.deadline) },
    locks: [`label:${seat.label}`, `badge:${seat.badge.toLowerCase()}`],
  };
}
