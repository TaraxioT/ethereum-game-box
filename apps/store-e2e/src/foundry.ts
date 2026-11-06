// Foundry's own `anvil` and `forge`. Laravel Herd puts another `forge` on the PATH, so Foundry's folder goes first.

import { homedir } from 'node:os';
import path from 'node:path';

const FOUNDRY_BIN = path.join(homedir(), '.foundry/bin');

/** `env` with Foundry's folder first on its PATH. */
export const foundryEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...env,
  PATH: `${FOUNDRY_BIN}${path.delimiter}${env.PATH ?? ''}`,
});
