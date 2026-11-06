// The Box: its real server on fake stations, with a software key behind the real signer daemon's protocol, and its real
// screen in a real browser. Only `apps/box/src/server/main.ts` runs here, as it runs on the Pi. It can be stopped and
// started on its data folder, as a power cut would.

import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CHROMIUM, headlessFlags } from '../../box/src/server/games/chromium.ts';
import type { RunKeys } from './keys.ts';
import { type Link, openLink } from './link.ts';
import { ROOT } from './paths.ts';
import { local, PORTS } from './ports.ts';
import { type Child, start } from './processes.ts';

/** The stations, in the order they link: Player 1's, then Player 2's. */
export const STATIONS = ['e4ba70', 'df3d88'] as const;

const HOOK = path.join(ROOT, 'apps/store-e2e/src/deployments-hook.ts');
const SIGNER = path.join(ROOT, 'apps/store-e2e/src/p256-signer.ts');
const MAIN = path.join(ROOT, 'apps/box/src/server/main.ts');
const READY_MS = 30_000;
/** A badge rests on a station this long, past the fake's own read of it. */
const REST_MS = 250;

export interface BoxOptions {
  readonly label: string;
  readonly keys: RunKeys;
  readonly deployments: string;
  readonly chainUrl: string;
  readonly relayerUrl: string;
  readonly storeUrl: string;
  readonly verifierUrl: string;
  readonly work: string;
}

export interface RunningBox {
  readonly url: string;
  readonly link: Link;
  /** Everything the Box has said lately. */
  log(): string;
  /** Rests a simulated badge on a station, and lifts it. */
  tap(badge: string, seat: 0 | 1): Promise<void>;
  /** The kiosk's back to Home, whatever the match was doing. */
  reset(): Promise<void>;
  /** Stops the server and the kiosk, leaving the data folder. */
  stop(): Promise<void>;
  /** `rounds.json` in the data folder. */
  readonly rounds: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function kiosk(url: string, work: string): ChildProcess {
  if (!CHROMIUM) throw new Error('no Chromium here: set EGB_CHROMIUM');
  return spawn(CHROMIUM, [...headlessFlags(path.join(work, 'kiosk-profile')), url], { stdio: 'ignore' });
}

export async function startBox(options: BoxOptions): Promise<RunningBox> {
  const { label, keys, deployments, chainUrl, relayerUrl, storeUrl, verifierUrl, work } = options;
  const url = local(PORTS.box);
  const data = path.join(work, 'box-data');
  const envFile = path.join(work, 'box.env');
  writeFileSync(envFile, '');

  const child: Child = start('the Box', 'node', ['--import', HOOK, MAIN], {
    cwd: ROOT,
    env: {
      ...process.env,
      EGB_ENV_FILE: envFile,
      EGB_E2E_DEPLOYMENTS: deployments,
      EGB_E2E_BOX_KEY: keys.box,
      EGB_PORT: String(PORTS.box),
      EGB_DATA: data,
      EGB_RECEIVER: 'fake',
      EGB_STATIONS: STATIONS.join(','),
      EGB_BOX: label,
      EGB_FORGE_PROVIDER: 'sim',
      EGB_STORE_URL: storeUrl,
      EGB_VERIFIER_URL: verifierUrl,
      P256_SIGNER_CMD: `node ${SIGNER}`,
      RELAYER_URL: relayerUrl,
      SEPOLIA_RPC_URL: chainUrl,
    },
  });
  await child.says(/Game Box on/, READY_MS);
  const browser = kiosk(url, work);
  const link = await openLink(url);

  const post = async (route: string, body?: unknown) => {
    const response = await fetch(`${url}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${route} answered ${response.status}: ${await response.text()}`);
  };

  return {
    url,
    link,
    log: child.tail,
    rounds: path.join(data, 'rounds.json'),
    async tap(badge, seat) {
      await post('/api/taps/fake', { op: 'place', badge, st: STATIONS[seat] });
      await sleep(REST_MS);
      await post('/api/taps/fake', { op: 'lift', badge });
      await sleep(REST_MS);
    },
    reset: () => post('/api/box/reset'),
    async stop() {
      link.close();
      browser.kill('SIGKILL');
      await child.stop();
    },
  };
}

/** Says the pots in `rounds.json` opened `ms` earlier than it says. The Box reads its own clock against that, and a run
 *  can't wait an hour, so this is how a Box comes back after a long time away. */
export function ageRounds(file: string, ms: number): void {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { storePots?: Record<string, number> };
  const storePots = Object.fromEntries(Object.entries(saved.storePots ?? {}).map(([round, at]) => [round, at - ms]));
  writeFileSync(file, JSON.stringify({ ...saved, storePots }));
}
