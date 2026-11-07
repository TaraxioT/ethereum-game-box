// The verifier Worker: it takes a match's log, has an agent judge it in a container, and signs what comes of it. Every
// key is here. The container gets none of them.

import { rpc, sepoliaClient } from '@egb/relayer/chain';
import { contractAddress, ourContract } from '@egb/shared/names';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { Env } from './env.ts';
import { judgementName } from './judge.ts';
import { deployedPot } from './pot.ts';
import { handle } from './routes.ts';
import { type OpenedPot, openedPots, remembered } from './runs.ts';
import { envScrubber } from './safe.ts';
import { upstream } from './upstream.ts';

export { ContainerProxy } from '@cloudflare/containers';
export { AgentContainer } from './container.ts';
export { BoxGate } from './gate.ts';
export { Judgement } from './judgement.ts';

/** How long the index's chain and store reads last, per isolate. */
const INDEX_TTL_MS = 30_000;

let opened: (() => Promise<OpenedPot[]>) | null = null;
let titles: (() => Promise<Record<string, string>>) | null = null;

async function storeTitles(env: Env): Promise<Record<string, string>> {
  const reply = await upstream(env.STORE, env.STORE_URL)('/index.json');
  const { listings } = (await reply.json()) as { listings: { hash: string; title: string }[] };
  return Object.fromEntries(listings.map((listing) => [listing.hash, listing.title]));
}

export default {
  fetch(request, env) {
    const client = sepoliaClient(rpc(env.SEPOLIA_RPC_URL));
    opened ??= remembered(() => openedPots(client, deployedPot(), BigInt(ourContract('StorePot')?.deployBlock ?? 0)), INDEX_TTL_MS);
    titles ??= remembered(() => storeTitles(env), INDEX_TTL_MS);
    const judgement = (box: string, round: string) => env.JUDGEMENT.getByName(judgementName(box, round));
    return handle(request, {
      ctx: {
        client,
        // Read when a route needs it, so `/health` answers even before the contracts are deployed.
        addresses: {
          get names() {
            return contractAddress('GameBoxNames');
          },
        },
        pot: deployedPot,
        store: upstream(env.STORE, env.STORE_URL),
        now: () => Math.floor(Date.now() / 1000),
      },
      doors: {
        judgement,
        reads: judgement,
        takeJudgement: (box, now) => env.BOX_GATE.getByName(box).take(box, now),
        returnJudgement: (box, at) => env.BOX_GATE.getByName(box).giveBack(box, at),
        // A Box's label has no `:`, so this can't be a Box's own object.
        takeCaller: (ip, now) => env.BOX_GATE.getByName(`ip:${ip}`).takeCaller(ip, now),
      },
      verifier: () => privateKeyToAccount(env.VERIFIER_PRIVATE_KEY as Hex).address,
      opened,
      titles,
      scrub: envScrubber(env),
    });
  },
} satisfies ExportedHandler<Env>;
