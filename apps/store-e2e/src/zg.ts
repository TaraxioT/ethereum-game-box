// The fake 0G on its port, in its own process, driven through its `/__fake` route as the README says. It is the one thing
// in a run, with the badges, that isn't real.

import path from 'node:path';

import type { FakeZgSettings } from '@egb/verifier/test/fake-zg';

import { ROOT } from './paths.ts';
import { local, PORTS } from './ports.ts';
import { type Child, start } from './processes.ts';

/** What the fake has seen. */
export interface ZgSeen {
  readonly settings: FakeZgSettings;
  readonly chats: number;
  readonly segments: number;
  readonly shellOutput: unknown;
}

export interface FakeZgControl {
  readonly url: string;
  /** Sets how it behaves from now on. */
  set(settings: Partial<FakeZgSettings>): Promise<ZgSeen>;
  seen(): Promise<ZgSeen>;
  stop(): Promise<void>;
}

export async function startZg(): Promise<FakeZgControl> {
  const url = local(PORTS.zg);
  const child: Child = start('fake 0G', 'node', [path.join(ROOT, 'apps/verifier/test/fake-zg/main.ts'), String(PORTS.zg)], {});
  await child.says(/fake 0G on/, 30_000);
  const control = `${url}/__fake`;
  return {
    url,
    set: async (settings) => (await fetch(control, { method: 'POST', body: JSON.stringify(settings) })).json() as Promise<ZgSeen>,
    seen: async () => (await fetch(control)).json() as Promise<ZgSeen>,
    stop: () => child.stop(),
  };
}
