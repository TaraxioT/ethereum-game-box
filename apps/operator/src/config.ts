// Where the site reads and writes. No key ships in the bundle: the RPCs are public Sepolia endpoints (the first that
// answers wins) and the relayer is a public Worker. `VITE_*` overrides them for local work and the Playwright run.

const env = import.meta.env;

/** Public Sepolia RPCs, in the order tried. Both allow browser CORS and `eth_getLogs` over 10,000 blocks. */
export const RPC_URLS: readonly string[] = env.VITE_RPC_URLS
  ? String(env.VITE_RPC_URLS).split(",")
  : ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.gateway.tenderly.co"];

/** The relayer Worker: pays the gas for requests a passkey signed. Its CORS allows only the live sites, so the dev
 *  server passes `/_relayer` through to it (vite.config.ts). */
export const RELAYER_URL: string =
  env.VITE_RELAYER_URL ?? (env.DEV ? "/_relayer" : "https://gamebox-relayer.mathew.workers.dev");

export const ETHERSCAN = "https://sepolia.etherscan.io";

/** The largest block range one `eth_getLogs` asks for. */
export const LOG_CHUNK = 9_999n;

/** How long a signed request stays valid. */
export const DEADLINE_SECONDS = 15 * 60;

/** The Pages project's own host. Its preview deployments (`<hash>.gamebox-operator.pages.dev`) use it as their
 *  relying party too, so a passkey made on the live site works on every preview. */
const PAGES_HOST = "gamebox-operator.pages.dev";

/** The WebAuthn relying party: the site's own host. A passkey works only on the host it was made on. */
export function rpId(hostname: string = location.hostname): string {
  return env.VITE_RP_ID ?? (hostname.endsWith(`.${PAGES_HOST}`) ? PAGES_HOST : hostname);
}
