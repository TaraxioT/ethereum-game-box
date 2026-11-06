// The ports of a run: a range nothing else in the repo uses, so a Box, a relayer or a fake 0G already running here can't
// answer in place of the real thing.

import { createServer } from 'node:net';

export const PORTS = {
  anvil: 28545,
  relayer: 28546,
  store: 28547,
  verifier: 28548,
  zg: 28549,
  box: 28550,
  tamper: 28551,
  relayerInspector: 28552,
  storeInspector: 28553,
  verifierInspector: 28554,
} as const;

const isFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });

/** Stops the run before it starts if anything holds one of its ports. */
export async function requirePortsFree(): Promise<void> {
  const taken: number[] = [];
  for (const port of Object.values(PORTS)) if (!(await isFree(port))) taken.push(port);
  if (taken.length > 0) throw new Error(`something is on port ${taken.join(', ')}: stop it, or a run could talk to it`);
}

export const local = (port: number) => `http://127.0.0.1:${port}`;
