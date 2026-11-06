// Where the site reads and writes. No key ships in the bundle: the RPCs are public Sepolia endpoints (the first that
// answers wins), and the relayer and the demo Box are public Workers. `VITE_*` overrides them for local work.

const env = import.meta.env;

/** Public Sepolia RPCs, in the order tried. Both allow browser CORS and `eth_getLogs` over 10,000 blocks. */
export const RPC_URLS: readonly string[] = env.VITE_RPC_URLS
  ? String(env.VITE_RPC_URLS).split(",")
  : ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.gateway.tenderly.co"];

/** The relayer Worker: pays the gas for signed requests. Its CORS allows only the live site, so the dev server
 * passes `/relayer` through to it (vite.config.ts). */
export const RELAYER_URL: string =
  env.VITE_RELAYER_URL ?? (env.DEV ? "/relayer" : "https://gamebox-relayer.mathew.workers.dev");

/** The demo Box Worker: a Box with a software P-256 key. */
export const DEMO_BOX_URL: string =
  env.VITE_DEMO_BOX_URL ?? (env.DEV ? "/demo-box" : "https://gamebox-demo-box.mathew.workers.dev");

export const ETHERSCAN = "https://sepolia.etherscan.io";

/** The largest block range one `eth_getLogs` asks for. */
export const LOG_CHUNK = 9_999n;

/** The Box the story reports results from, and the game whose title moves on stage. */
export const DEMO_BOX_LABEL = "mumbai-01";
export const LIVE_TITLE_GAME = "quickdraw";
export const GAMES = ["stockduel", "quickdraw"] as const;
export const AGENT_LABEL = "bot";
