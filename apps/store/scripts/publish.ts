// `pnpm store:publish <folder>`. Takes its settings from `.env`. The RPC URL carries its node's key, so a failure
// prints only `describe`'s one redacted line.

import { describe, rpc } from '@egb/relayer/chain';
import { ourContract } from '@egb/shared/names';

import { publish } from './publisher.ts';

const [folder] = process.argv.slice(2);

if (!folder) {
  console.error('usage: pnpm store:publish <folder>');
  process.exit(1);
}

const { EGB_STORE_URL, SEPOLIA_RPC_URL, STORE_LISTER_KEY, STORE_PUBLISH_TOKEN } = process.env;

publish({
  folder,
  storeUrl: EGB_STORE_URL,
  token: STORE_PUBLISH_TOKEN,
  pot: ourContract('StorePot')?.address,
  listerKey: STORE_LISTER_KEY,
  transport: SEPOLIA_RPC_URL ? rpc(SEPOLIA_RPC_URL) : undefined,
  print: console.log,
}).catch((error: unknown) => {
  console.error(describe(error));
  process.exit(1);
});
