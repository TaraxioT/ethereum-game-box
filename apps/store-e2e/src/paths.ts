// Where things are, for the tools a run starts.

import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** What goes in `node --import`, ahead of anything that reads the deployments. */
export const DEPLOYMENTS_HOOK = fileURLToPath(new URL('deployments-hook.ts', import.meta.url));
