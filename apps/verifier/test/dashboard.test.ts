import { describe, expect, it } from 'vitest';

import { type RunRow, esc, runPage, runsPage, usdc } from '../src/dashboard.ts';
import { handle } from '../src/routes.ts';
import { openedPots, remembered } from '../src/runs.ts';
import { BOX, ROUND, stakedWorld } from './world.ts';

const ATTACK = '<script>alert(1)</script>';
const PLAYER = `0x${'ab'.repeat(20)}` as const;
const status = { state: 'paid', payouts: ['0', '20000000'], tx: `0x${'12'.repeat(32)}`, record: `0x${'34'.repeat(32)}`, reason: null } as const;

const recordText = JSON.stringify({
  v: 1,
  bundle: `0x${'56'.repeat(32)}`,
  instructions: ATTACK,
  attempts: 1,
  turns: [{ chatId: 'c', model: 'm', teeVerified: true, request: {}, response: {} }],
  verdict: { kind: 'split', payouts: ['0', '20000000'], why: `Seat 2 tapped more ${ATTACK}` },
  log: JSON.stringify({
    header: { v: 1, box: BOX, round: '5', bundle: `0x${'56'.repeat(32)}`, game: ATTACK, players: [PLAYER, PLAYER], amount: '10000000', startedAt: 1000 },
    entries: [
      { src: 'box', t: 'tap', seat: 1, at: 2000, roll: null },
      { src: 'game', t: 'event', at: 2500, name: ATTACK, data: { html: ATTACK } },
      { src: 'box', t: 'end', at: 3000, why: 'game' },
    ],
  }),
});

const row: RunRow = { box: BOX, round: '5', bundle: `0x${'56'.repeat(32)}`, players: [PLAYER, PLAYER], amount: '10000000', openedAt: 1, title: ATTACK, status };

describe('the pages', () => {
  it('says what happened in words', () => {
    const html = runPage({ box: BOX, round: '5', status, audit: null, recordText });
    expect(html).toContain('Seat 2 tapped');
    expect(html).toContain('The match closed: the game ended it');
    expect(html).toContain('20 USDC');
    expect(html).toContain('upload pending');
    expect(html).toContain('1 of 1 model turns');
  });

  it('escapes all the log, the rules and the model say', () => {
    expect(runPage({ box: BOX, round: '5', status, audit: null, recordText })).not.toContain('<script');
    expect(runsPage(BOX, [row])).not.toContain('<script');
  });

  it('points at 0G Storage once the record has left', () => {
    const audit = { record: status.record, root: `0x${'cd'.repeat(32)}`, tx: null } as const;
    expect(runPage({ box: BOX, round: '5', status, audit, recordText: null })).toContain('on 0G Storage');
  });

  it('survives a record that is not JSON', () => {
    expect(runPage({ box: BOX, round: '5', status, audit: null, recordText: 'nope' })).toContain('Round 5');
  });

  it('adds up the index', () => {
    const html = runsPage(BOX, [row, { ...row, round: '6', status: null }]);
    expect(html).toContain('/judge/mumbai-01/5'.replace('mumbai-01', BOX));
    expect(html).toContain('40 USDC');
    expect(html).toContain('Not judged');
  });

  it('writes USDC plainly', () => {
    expect(usdc('20000000')).toBe('20 USDC');
    expect(usdc('2500000')).toBe('2.5 USDC');
    expect(usdc('1')).toBe('0.000001 USDC');
    expect(esc(`"'`)).toBe('&#34;&#39;');
  });
});

describe('the routes', () => {
  const asBrowser = { headers: { accept: 'text/html,*/*' } };

  it('keeps the JSON for the Box, and gives a browser the page', async () => {
    const world = await stakedWorld();
    const deps = world.deps();
    await world.post(deps, world.signedRequest(world.log));
    const path = `http://verifier/judge/${BOX}/${ROUND}`;
    expect((await handle(new Request(path), deps)).headers.get('content-type')).toContain('json');
    const page = await handle(new Request(path, asBrowser), deps);
    expect(page.headers.get('content-type')).toContain('html');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await handle(new Request(`${path}?format=json`, asBrowser), deps)).headers.get('content-type')).toContain('json');
  });

  it('lists only this Box, newest first', async () => {
    const world = await stakedWorld();
    const pot = { bundle: row.bundle, players: row.players, amount: row.amount, openedAt: 1 };
    const opened = async () => [{ ...pot, box: BOX, round: '9' }, { ...pot, box: 'other-box', round: '10' }, { ...pot, box: BOX, round: '11' }];
    const reply = await handle(new Request(`http://verifier/judge/${BOX}`), { ...world.deps(), opened });
    const { runs } = (await reply.json()) as { runs: { round: string }[] };
    expect(runs.map((run) => run.round)).toEqual(['11', '9']);
  });

  it('answers a page with a 404 for a round with no judgement', async () => {
    const world = await stakedWorld();
    const reply = await handle(new Request(`http://verifier/judge/${BOX}/7`, asBrowser), world.deps());
    expect(reply.status).toBe(404);
    expect(await reply.text()).toContain('No judgement for round 7');
  });
});

describe('the reads behind the index', () => {
  it('asks for logs in spans a provider takes', async () => {
    const spans: [bigint, bigint][] = [];
    const client = {
      getBlockNumber: async () => 12000n,
      getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => (spans.push([fromBlock, toBlock]), []),
    };
    await openedPots(client as never, PLAYER, 1n);
    expect(spans).toEqual([[1n, 5000n], [5001n, 10000n], [10001n, 12000n]]);
  });

  it('remembers an answer for a while, but not a failure', async () => {
    let now = 0;
    let calls = 0;
    const load = remembered(async () => { calls += 1; if (calls === 2) throw new Error('down'); return calls; }, 10, () => now);
    expect(await load()).toBe(1);
    expect(await load()).toBe(1);
    now = 11;
    await expect(load()).rejects.toThrow('down');
    expect(await load()).toBe(3);
  });
});
