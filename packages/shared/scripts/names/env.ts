// The live-deployment scripts' environment: a Sepolia client and the Etherscan key, from `.env`. The RPC URL carries
// its key, so every error these scripts print goes through `redact`.

import { type PublicClient, createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

/** Replaces any URL in `text` with `<rpc>`, so no RPC key reaches the output. */
export function redact(text: string): string {
  return text.replace(/https?:\/\/[^\s"'`]+/g, (url) => (url.includes('etherscan') ? url : '<rpc>'));
}

export function sepoliaClient(): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(required('SEPOLIA_RPC_URL')) });
}

export function etherscanKey(): string {
  return required('ETHERSCAN_API_KEY');
}

/** Runs `main`, printing any failure redacted and exiting non-zero. */
export function run(main: () => Promise<boolean>): void {
  main().then(
    (ok) => process.exit(ok ? 0 : 1),
    (error: unknown) => {
      console.error(redact(error instanceof Error ? (error.stack ?? error.message) : String(error)));
      process.exit(1);
    },
  );
}
