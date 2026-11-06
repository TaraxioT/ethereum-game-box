// Runs the fake 0G on a port, and prints the Worker vars that point at it: `pnpm --filter @egb/verifier fake-zg [port]`.

import { SERVING_CONTRACT } from './index.ts';
import { startFakeZg } from './server.ts';

const { url } = await startFakeZg(Number(process.argv[2] ?? 8790));

console.log(`fake 0G on ${url}`);
console.log(`ZG_BASE_URL=${url}/v1`);
console.log(`ZG_RPC=${url}/rpc`);
console.log(`ZG_SERVING_CONTRACT=${SERVING_CONTRACT}`);
console.log(`ZG_STORAGE_RPC=${url}/rpc`);
console.log(`ZG_STORAGE_INDEXER=${url}/indexer`);
console.log(`Set a split with: curl -d '{"payouts":["2000000","0"]}' ${url}/__fake`);
