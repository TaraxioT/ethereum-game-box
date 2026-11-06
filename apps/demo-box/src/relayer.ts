// The relayer, as the demo Box and its agent see it: JSON over its HTTP routes.

import type { Env } from './env.ts';

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export interface Relayer {
  post(path: string, body: unknown): Promise<Reply>;
  get(path: string): Promise<Reply>;
}

/** The relayer through the service binding when there is one (a Worker can't fetch another Worker's workers.dev URL
 *  on the same account), else at `RELAYER_URL`. */
export function relayer(env: Pick<Env, 'RELAYER' | 'RELAYER_URL'>): Relayer {
  const send = async (path: string, init: RequestInit): Promise<Reply> => {
    const request = new Request(new URL(path, env.RELAYER_URL), init);
    const response = await (env.RELAYER ? env.RELAYER.fetch(request) : fetch(request));
    const body = (await response.json().catch(() => ({ error: `relayer answered ${response.status}` }))) as Reply['body'];
    return { status: response.status, body };
  };
  return {
    post: (path, body) =>
      send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    get: (path) => send(path, { method: 'GET' }),
  };
}
