// The last catch of both Workers: no throw reaches the runtime (a bare Cloudflare 1101), every one becomes a JSON
// error with no RPC URL in it.

import { describe } from './chain.ts';

/** `run()`, or a JSON error: 503 before our contracts are in `deployments/sepolia.json`, 502 for anything else. */
export async function guarded(run: () => Promise<Response>, headers: Record<string, string> = {}): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const message = describe(error);
    console.error(message);
    const notDeployed = /is not in deployments/.test(message);
    return Response.json(
      { error: notDeployed ? `not deployed: ${message}` : `upstream: ${message}` },
      { status: notDeployed ? 503 : 502, headers },
    );
  }
}
