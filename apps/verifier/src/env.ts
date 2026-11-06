import type { AgentContainer } from './container.ts';
import type { BoxGate } from './gate.ts';
import type { Judgement } from './judgement.ts';

export interface Env {
  JUDGEMENT: DurableObjectNamespace<Judgement>;
  BOX_GATE: DurableObjectNamespace<BoxGate>;
  AGENT: DurableObjectNamespace<AgentContainer>;
  /** Secret: the key with `VERIFIER_ROLE`. It signs every `Verdict` and `Void`. */
  VERIFIER_PRIVATE_KEY: string;
  /** Secret: 0G's Router key. It pays for the model. */
  ZG_API_KEY: string;
  /** Secret: the wallet that pays for 0G Storage. */
  ZG_STORAGE_KEY: string;
  /** Secret: the Sepolia RPC URL, which carries the node's key. */
  SEPOLIA_RPC_URL: string;
  /** 0G's Router, up to `/v1`. */
  ZG_BASE_URL: string;
  ZG_MODEL: string;
  /** 0G's chain, read for each provider's record. */
  ZG_RPC: string;
  /** 0G's serving contract, on that chain. */
  ZG_SERVING_CONTRACT: string;
  /** 0G's chain, for storage payments. */
  ZG_STORAGE_RPC: string;
  ZG_STORAGE_INDEXER: string;
  RELAYER_URL: string;
  STORE_URL: string;
  /** The relayer, on the same account: a Worker can't fetch another Worker's workers.dev URL. */
  RELAYER?: Fetcher;
  /** The store, on the same account, for the same reason. */
  STORE?: Fetcher;
}
