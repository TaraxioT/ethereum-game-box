// The demo Box Worker: `GET /box` and `POST /result`. Every request (and an hourly cron) makes sure the heartbeat
// alarm is running.

import { corsHeaders, originAllowed } from '@egb/relayer/cors';
import { guarded } from '@egb/relayer/guard';

import type { DemoBox } from './box.ts';
import type { Env } from './env.ts';

export { DemoBox } from './box.ts';

const json = (status: number, body: unknown, headers: Record<string, string>) => Response.json(body, { status, headers });

/** The one demo Box. Its replies are plain JSON, so the stub's methods return what the object's do. */
const demoBox = (env: Env) =>
  env.DEMO_BOX.get(env.DEMO_BOX.idFromName('demo-box')) as unknown as Pick<DemoBox, 'start' | 'view' | 'report'>;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    if (origin && !originAllowed(origin, env.ALLOWED_ORIGINS)) return json(403, { error: 'origin not allowed' }, {});
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    return guarded(async () => {
      const box = demoBox(env);
      await box.start();
      const { pathname } = new URL(request.url);
      if (pathname === '/box' && request.method === 'GET') return json(200, await box.view(), cors);
      if (pathname === '/result' && request.method === 'POST') {
        const body: unknown = await request.json().catch(() => null);
        const reply = await box.report(body, request.headers.get('cf-connecting-ip') ?? 'unknown');
        return json(reply.status, reply.body, cors);
      }
      return json(404, { error: 'not found' }, cors);
    }, cors);
  },

  async scheduled(_controller, env) {
    await guarded(async () => {
      await demoBox(env).start();
      return new Response(null, { status: 204 });
    });
  },
} satisfies ExportedHandler<Env>;
