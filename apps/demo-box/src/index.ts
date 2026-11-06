// The demo Box Worker: the Box (`GET /box`, `POST /result`) and its agent (`GET /agent`, `POST /agent/setup`, and
// the agent's MCP endpoint `POST /mcp`). Every request (and an hourly cron) makes sure the heartbeat alarm is running.

import { corsHeaders, originAllowed } from '@egb/relayer/cors';
import { guarded } from '@egb/relayer/guard';

import type { Env } from './env.ts';
import { handleMcp } from './mcp.ts';
import type { DemoBox } from './object.ts';

export { DemoBox } from './object.ts';

const json = (status: number, body: unknown, headers: Record<string, string>) => Response.json(body, { status, headers });

/** The one demo Box. Its replies are plain JSON, so the stub's methods return what the object's do. */
const demoBox = (env: Env) =>
  env.DEMO_BOX.get(env.DEMO_BOX.idFromName('demo-box')) as unknown as Pick<
    DemoBox,
    'start' | 'view' | 'report' | 'agentView' | 'agentSetup'
  >;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    if (origin && !originAllowed(origin, env.ALLOWED_ORIGINS)) return json(403, { error: 'origin not allowed' }, {});
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    return guarded(async () => {
      const box = demoBox(env);
      await box.start();
      const route = `${request.method} ${new URL(request.url).pathname}`;
      switch (route) {
        case 'GET /box':
          return json(200, await box.view(), cors);
        case 'POST /result': {
          const body: unknown = await request.json().catch(() => null);
          const reply = await box.report(body, request.headers.get('cf-connecting-ip') ?? 'unknown');
          return json(reply.status, reply.body, cors);
        }
        case 'GET /agent':
          return json(200, await box.agentView(), cors);
        case 'POST /agent/setup': {
          const reply = await box.agentSetup();
          return json(reply.status, reply.body, cors);
        }
      }
      if (new URL(request.url).pathname === '/mcp') {
        return handleMcp(request, { agent: () => box.agentView(), box: () => box.view() }, cors);
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
