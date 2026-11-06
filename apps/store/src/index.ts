// The game store Worker: serves the index and the zips, and takes the team's uploads.

import { Catalog } from './catalog.ts';
import type { Env } from './env.ts';
import { handle } from './routes.ts';

const catalog = new Catalog();

export default {
  fetch(request, env) {
    return handle(request, { bucket: env.BUNDLES, token: env.STORE_PUBLISH_TOKEN, catalog });
  },
} satisfies ExportedHandler<Env>;
