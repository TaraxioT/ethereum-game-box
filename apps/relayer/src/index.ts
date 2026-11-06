// The relayer Worker: it pays the gas for requests that are already signed, and for nothing else.

import { type Hex, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { rpc, sepoliaClient } from './chain.ts';
import type { Env } from './env.ts';
import { deployedAddresses } from './request.ts';
import { type Relayer, handle } from './routes.ts';

export { Sender } from './sender.ts';

export default {
  fetch(request, env) {
    const sender = env.SENDER.get(env.SENDER.idFromName('sepolia'));
    return handle(request, {
      ctx: {
        client: sepoliaClient(rpc(env.SEPOLIA_RPC_URL)),
        relayer: privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex).address,
        addresses: deployedAddresses(),
        now: () => Math.floor(Date.now() / 1000),
        dripWei: parseEther(env.DRIP_ETH ?? '0.0003'),
      },
      relayer: sender as unknown as Relayer,
      allowedOrigins: env.ALLOWED_ORIGINS,
    });
  },
} satisfies ExportedHandler<Env>;
