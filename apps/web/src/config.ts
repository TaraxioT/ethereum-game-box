// Where the site reads and writes. No key ships in the bundle: the RPCs are public Sepolia endpoints (the first that
// answers wins), and the relayer and the demo Box are public Workers. `VITE_*` overrides them for local work.

const env = import.meta.env;

/** Public Sepolia RPCs, in the order tried. Both allow browser CORS and `eth_getLogs` over 10,000 blocks. */
export const RPC_URLS: readonly string[] = env.VITE_RPC_URLS
  ? String(env.VITE_RPC_URLS).split(",")
  : ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.gateway.tenderly.co"];

/** The relayer Worker: pays the gas for signed requests. Its CORS allows only the live site, so the dev server
 * passes `/_relayer` through to it (vite.config.ts). */
export const RELAYER_URL: string =
  env.VITE_RELAYER_URL ?? (env.DEV ? "/_relayer" : "https://gamebox-relayer.mathew.workers.dev");

/** The demo Box Worker: a Box with a software P-256 key. */
export const DEMO_BOX_URL: string =
  env.VITE_DEMO_BOX_URL ?? (env.DEV ? "/_demo-box" : "https://gamebox-demo-box.mathew.workers.dev");

export const ETHERSCAN = "https://sepolia.etherscan.io";

/** The operator site: where an operator signs in with a passkey and edits its Box's four keys. A separate app
 * (`apps/operator`); this site only links to it and watches the chain for its writes. */
export const OPERATOR_SITE_URL: string = env.VITE_OPERATOR_SITE_URL ?? "https://gamebox-operator.pages.dev";

/** The ENS app on Sepolia, which resolves through ENSv2 and shows the names under gamebox.eth. */
export const ENS_APP_URL = "https://sepolia.app.ens.domains";

/** A name's page in the ENS app: what the QR code after a claim opens. */
export function ensAppLink(name: string): string {
  return `${ENS_APP_URL}/${name}`;
}

/** The largest block range one `eth_getLogs` asks for. */
export const LOG_CHUNK = 9_999n;

/** The Box the story reports results from, and the game whose title moves on stage. */
export const DEMO_BOX_LABEL = "mumbai-01";
export const LIVE_TITLE_GAME = "quickdraw";
export const GAMES = ["stockduel", "quickdraw"] as const;
export const AGENT_LABEL = "bot";
