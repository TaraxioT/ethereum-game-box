// The fake 0G on its port, in its own process, driven through its `/__fake` route as the README says.

import path from 'node:path';

import type { FakeZgSettings, SeenChat } from '@egb/verifier/test/fake-zg';

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

/** A piece of a file on 0G Storage, as the SDK sent it. */
interface Segment {
  readonly root: string;
  readonly data: string;
  readonly index: number;
  readonly fileSize: number;
}

export interface FakeZgControl {
  readonly url: string;
  /** Sets how it behaves from now on: an honest 0G, but for `settings`. */
  script(settings: Partial<FakeZgSettings>): Promise<void>;
  seen(): Promise<ZgSeen>;
  /** Every chat call so far. */
  chats(): Promise<SeenChat[]>;
  /** The text of the file at `root`, as it reached 0G Storage. */
  file(root: string): Promise<string>;
  stop(): Promise<void>;
}

const HONEST: Partial<FakeZgSettings> = { chat: 'none', payouts: null, shellTurns: 1, shellCommand: 'jq .header log.json', storageUp: true };

export async function startZg(): Promise<FakeZgControl> {
  const url = local(PORTS.zg);
  const child: Child = start('fake 0G', 'node', [path.join(ROOT, 'apps/verifier/test/fake-zg/main.ts'), String(PORTS.zg)], {});
  await child.says(/fake 0G on/, 30_000);
  const control = `${url}/__fake`;
  return {
    url,
    script: async (settings) => void (await fetch(control, { method: 'POST', body: JSON.stringify({ ...HONEST, ...settings }) })),
    seen: async () => (await fetch(control)).json() as Promise<ZgSeen>,
    chats: async () => (await fetch(`${control}/chats`)).json() as Promise<SeenChat[]>,
    async file(root) {
      const segments = (await (await fetch(`${control}/segments`)).json()) as Segment[];
      const mine = segments.filter((segment) => segment.root === root).sort((a, b) => a.index - b.index);
      const bytes = Buffer.concat(mine.map(({ data }) => Buffer.from(data, 'base64')));
      return bytes.subarray(0, mine[0]?.fileSize ?? 0).toString('utf8');
    },
    stop: () => child.stop(),
  };
}
