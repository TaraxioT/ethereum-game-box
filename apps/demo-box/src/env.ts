import type { DemoBox } from './box.ts';

export interface Env {
  DEMO_BOX: DurableObjectNamespace<DemoBox>;
  /** Secret: the demo Box's P-256 key, a `0x`-prefixed 32-byte hex scalar. */
  DEMO_BOX_P256_KEY: string;
  /** Secret: the Sepolia RPC URL for reads, which carries the node's key. */
  SEPOLIA_RPC_URL: string;
  /** The relayer's URL. */
  RELAYER_URL: string;
  /** The relayer Worker, bound as a service. */
  RELAYER?: Fetcher;
  /** The Box's own name's label. */
  BOX_LABEL: string;
  /** The `game` a Box shows before its first result. */
  DEFAULT_GAME: string;
  /** Comma-separated origins a browser may call from. `http://localhost:*` allows any localhost port. */
  ALLOWED_ORIGINS: string;
}
