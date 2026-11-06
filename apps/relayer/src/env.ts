import type { Sender } from './sender.ts';

export interface Env {
  SENDER: DurableObjectNamespace<Sender>;
  /** Secret: the `sepolia-relayer` key. Gas only; it holds no role anywhere. */
  RELAYER_PRIVATE_KEY: string;
  /** Secret: the Sepolia RPC URL, which carries the node's key. */
  SEPOLIA_RPC_URL: string;
  /** The priority fee, in gwei. Default 2. */
  TIP_GWEI?: string;
  /** What `/names/drip` sends a badge, in ETH. Default 0.0003. */
  DRIP_ETH?: string;
  /** Comma-separated origins a browser may call from. `http://localhost:*` allows any localhost port. */
  ALLOWED_ORIGINS: string;
}
