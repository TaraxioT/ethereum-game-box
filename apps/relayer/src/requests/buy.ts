// `POST /swap/buy`: a badge's tap buys GBX at the Box, as `GameBoxLobby.buy`. The Box signs `GameBoxHook`'s `TapSwap`
// (the lobby as its sender), which earns the swap the 0.25% tap fee; the lobby mints the USDC the swap owes, and the
// GBX goes to the badge, or to the Box's stake once the Box is bonded. The relayer runs the buy with `eth_call` first,
// and sends it with `minGbxOut` set `SLIPPAGE_BPS` under what that returned.

import { formatUsdc } from '@egb/shared/names';
import { type LobbyBuy, type LobbyPool, gameBoxLobbyAbi, lobbyTapSwap, tapSwapDigest } from '@egb/shared/swap';
import { decodeFunctionResult, encodeFunctionData } from 'viem';

import { requireBoxSigned, requireLabel } from '../box.ts';
import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, estimatedGas, requireDeadline, simulate } from '../request.ts';

/** `GameBoxLobby.MAX_BUY`: one buy's most, 100 USDC. */
export const MAX_BUY = 100_000_000n;
/** How far under the simulated GBX the sent buy may land (the pool can move before it is mined): 2%. */
export const SLIPPAGE_BPS = 200n;

function lobbyOf(ctx: Context): LobbyPool {
  const pool = ctx.addresses.lobby;
  if (!pool) throw new Refusal(404, 'GameBoxLobby is not deployed yet');
  return pool;
}

function parseBuy(body: field.Body): LobbyBuy {
  const buy: LobbyBuy = {
    box: field.text(body, 'box'),
    badge: field.address(body, 'badge'),
    usdcIn: field.uint(body, 'usdcIn'),
    nonce: field.uint(body, 'nonce'),
    deadline: field.uint(body, 'deadline'),
  };
  requireLabel(buy.box, 'box');
  if (buy.usdcIn === 0n || buy.usdcIn > MAX_BUY) {
    const range = `between 0 and ${formatUsdc(MAX_BUY)}`;
    throw new Refusal(400, `usdcIn: ${formatUsdc(buy.usdcIn)} USDC is not ${range}`, 'BadAmount');
  }
  return buy;
}

export async function prepareBuy(ctx: Context, input: unknown): Promise<Prepared> {
  const pool = lobbyOf(ctx);
  const body = field.object(input);
  const buy = parseBuy(body);
  const r = field.bytes32(body, 'r');
  const s = field.bytes32(body, 's');
  requireDeadline(ctx, buy.deadline);
  const digest = tapSwapDigest(lobbyTapSwap(buy, pool), pool.hook);
  await requireBoxSigned(ctx, buy.box, digest, r, s);

  // The buy as it would run now (the daily cap, the hook's checks, the minter role), and the GBX it would get.
  const lobby = { address: pool.lobby, abi: gameBoxLobbyAbi } as const;
  const encode = (minGbxOut: bigint) =>
    encodeFunctionData({ ...lobby, functionName: 'buy', args: [{ ...buy, minGbxOut }, r, s] });
  const returned = await simulate(ctx, { to: lobby.address, data: encode(0n) });
  if (!returned) throw new Refusal(422, 'the buy returned nothing');
  const [gbxOut] = decodeFunctionResult({ ...lobby, functionName: 'buy', data: returned });

  const call = { to: lobby.address, data: encode(gbxOut - (gbxOut * SLIPPAGE_BPS) / 10_000n) };
  return {
    kind: 'buy',
    account: buy.badge,
    box: buy.box,
    ...call,
    value: 0n,
    gas: await estimatedGas(ctx, call),
    replay: { key: digest, until: Number(buy.deadline) },
    locks: [`buy:${buy.box}:${buy.nonce}`],
  };
}
