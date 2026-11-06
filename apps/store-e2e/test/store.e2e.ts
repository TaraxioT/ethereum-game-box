// `pnpm store:e2e`: every scenario in the plan's "done when" that a laptop can reach, on real contracts, real Workers, a
// real container and the real Box. Only 0G and the badges are fakes. Each scenario believes the chain and nothing else.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hex } from 'viem';

import type { RunningBox } from '../src/box.ts';
import { type Ledger, STATE, ledger, showUsdc, usdc } from '../src/ledger.ts';
import { BADGES, judgedOf, stakeAndPlay } from '../src/match.ts';
import { TAP_RUSH, publish } from '../src/publish.ts';
import { BOX_LABEL, type World, startWorld } from '../src/world.ts';

let world: World;
let chain: Ledger;
let box: RunningBox;
let tapRush: Hex;

const say = (line: string) => console.log(`    ${line}`);

beforeAll(async () => {
  world = await startWorld();
  chain = ledger(world.chain, world.contracts, BOX_LABEL);
});

afterAll(async () => {
  await world?.stop();
});

describe('a store match', () => {
  it('publishes Tap Rush, two badges stake and play, and the agent pays a split', async () => {
    const publisher = {
      storeUrl: world.storeUrl,
      token: world.keys.publish,
      chainUrl: world.chain.url,
      deployments: world.contracts.deployments,
      listerKey: world.keys.lister,
    };
    const published = await publish(TAP_RUSH, publisher);
    tapRush = published.hash;
    published.lines.forEach(say);
    expect(await chain.listed(tapRush)).toBe(true);

    for (const badge of BADGES) {
      const topped = await fetch(`${world.relayerUrl}/store/topup`, { method: 'POST', body: JSON.stringify({ player: badge }) });
      expect(topped.status).toBe(202);
    }
    await world.name(BADGES);

    box = await world.startBox();
    await world.zg.set({ payouts: [usdc(15).toString(), usdc(5).toString()] });
    const round = await stakeAndPlay(box, 'tap-rush', 10, [3, 1]);
    say(`round ${round} judging`);
    const state = await box.link.until(({ phase }) => phase === 'result', 'Result', 120_000);
    say(JSON.stringify(judgedOf(state)));
    const pot = await chain.pot(round);
    expect(pot.state).toBe(STATE.settled);
    say(`${(await chain.balances(BADGES)).map(showUsdc)}`);
    console.log(box.log());
  });
});
