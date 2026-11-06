// The team's side: the real `store:publish` script, run on a game's folder, as a person runs it.

import { execFile } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Hex } from 'viem';

import { ROOT } from './paths.ts';

const run = promisify(execFile);

const HOOK = path.join(ROOT, 'apps/store-e2e/src/deployments-hook.ts');
const SCRIPT = path.join(ROOT, 'apps/store/scripts/publish.ts');
export const TAP_RUSH = path.join(ROOT, 'apps/store/sample/tap-rush');

export interface Publisher {
  readonly storeUrl: string;
  readonly token: string;
  readonly chainUrl: string;
  readonly deployments: string;
  /** Holds `LISTER_ROLE`. Without it the bundle is uploaded, and not listed. */
  readonly listerKey?: Hex;
}

export interface Published {
  readonly hash: Hex;
  /** What the script printed. */
  readonly lines: readonly string[];
}

export async function publish(folder: string, { storeUrl, token, chainUrl, deployments, listerKey }: Publisher): Promise<Published> {
  const { stdout } = await run('node', ['--import', HOOK, SCRIPT, folder], {
    cwd: ROOT,
    env: {
      ...process.env,
      EGB_E2E_DEPLOYMENTS: deployments,
      EGB_STORE_URL: storeUrl,
      STORE_PUBLISH_TOKEN: token,
      SEPOLIA_RPC_URL: chainUrl,
      ...(listerKey && { STORE_LISTER_KEY: listerKey }),
    },
  });
  const lines = stdout.trim().split('\n');
  const hash = lines.find((line) => /^0x[0-9a-f]{64}$/.test(line));
  if (!hash) throw new Error(`the script printed no hash:\n${stdout}`);
  return { hash: hash as Hex, lines };
}

/** Tap Rush as another game, in `folder`: same page, a manifest of its own. */
export function variantOfTapRush(folder: string, id: string, title: string): string {
  cpSync(TAP_RUSH, folder, { recursive: true });
  const file = path.join(folder, 'manifest.json');
  writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, 'utf8')) as object), id, title }));
  return folder;
}
