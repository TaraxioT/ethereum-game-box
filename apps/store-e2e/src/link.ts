// A second screen on the Box's link: it sends the commands the kiosk's buttons send, and watches the state. The kiosk
// itself runs the game's page, so nothing here plays for it.

import { WebSocket } from 'ws';

import type { BoxState, ScreenCommand } from '../../box/src/core/types.ts';
import { LINK_PATH, type LinkDown } from '../../box/src/core/wire.ts';

export interface Link {
  state(): BoxState;
  send(command: ScreenCommand): void;
  /** Resolves with the first state, now or later, that passes `check`. */
  until(check: (state: BoxState) => boolean, what: string, ms?: number): Promise<BoxState>;
  close(): void;
}

const WAIT_MS = 30_000;

export async function openLink(url: string): Promise<Link> {
  const socket = new WebSocket(`${url.replace('http', 'ws')}${LINK_PATH}`);
  const waiters = new Set<(state: BoxState) => void>();
  let latest: BoxState | undefined;

  socket.on('message', (data) => {
    latest = (JSON.parse(String(data)) as LinkDown).state;
    for (const wake of waiters) wake(latest);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  const state = () => {
    if (!latest) throw new Error('the Box has said nothing yet');
    return latest;
  };

  return {
    state,
    send: (command) => socket.send(JSON.stringify({ t: 'command', command })),
    until(check, what, ms = WAIT_MS) {
      return new Promise((resolve, reject) => {
        const finish = (run: () => void) => {
          clearTimeout(limit);
          waiters.delete(hear);
          run();
        };
        const hear = (next: BoxState) => {
          if (check(next)) finish(() => resolve(next));
        };
        const limit = setTimeout(() => finish(() => reject(new Error(`the Box never reached ${what}: it is in ${latest?.phase}`))), ms);
        waiters.add(hear);
        if (latest) hear(latest);
      });
    },
    close: () => socket.close(),
  };
}
