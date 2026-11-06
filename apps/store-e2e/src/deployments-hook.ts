// Loaded with `node --import` ahead of the Box and `store:publish`: it swaps `deployments/sepolia.json` for the run's
// own, so they run unchanged on the run's anvil. `EGB_E2E_DEPLOYMENTS` names the file.

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const file = process.env.EGB_E2E_DEPLOYMENTS;
if (!file) throw new Error('EGB_E2E_DEPLOYMENTS is not set');

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('/deployments/sepolia.json')) return nextLoad(url, context);
    return { format: 'json', source: readFileSync(file, 'utf8'), shortCircuit: true };
  },
});
