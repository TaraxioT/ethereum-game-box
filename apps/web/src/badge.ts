// The badge a visitor claims with: an injected wallet (EIP-1193, which signs with `eth_signTypedData_v4`), or a test
// badge: a key made in this browser and kept in localStorage, labelled as a test badge everywhere it shows. At the
// event the badge is a HaLo chip; here anything that signs EIP-712 stands in for it.
import {
  type Account,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
  type WalletClient,
  createWalletClient,
  custom,
  fallback,
  http,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { type ClaimName, claimNameTypedData, contractAddress } from "@egb/shared/names";

import { RPC_URLS } from "./config.ts";

export interface Badge {
  kind: "test" | "wallet";
  address: Address;
  /** Signs `ClaimName` for `GameBoxNames`. */
  signClaim(message: ClaimName): Promise<Hex>;
  /** Sends a transaction from the badge itself (it pays the gas). */
  send(to: Address, data: Hex): Promise<Hash>;
}

/** Signs `ClaimName` with any viem account: what both kinds of badge do underneath. */
export function signClaimWith(
  wallet: WalletClient,
  account: Account | Address,
  message: ClaimName,
  gameBoxNames: Address,
  chainId: number = sepolia.id,
): Promise<Hex> {
  return wallet.signTypedData({ account, ...claimNameTypedData(message, gameBoxNames, chainId) });
}

const KEY = "gamebox-test-badge";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function fromKey(key: Hex): Badge {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: sepolia, transport: fallback(RPC_URLS.map((url) => http(url))) });
  return {
    kind: "test",
    address: account.address,
    signClaim: (message) => signClaimWith(wallet, account, message, contractAddress("GameBoxNames")),
    send: (to, data) => wallet.sendTransaction({ account, chain: sepolia, to, data }),
  };
}

/** The test badge kept in this browser, if there is one. */
export function storedTestBadge(): Badge | null {
  const key = storage()?.getItem(KEY);
  return key && /^0x[0-9a-f]{64}$/i.test(key) ? fromKey(key as Hex) : null;
}

/** A fresh test badge, kept in this browser in place of the last one (unless `keep` is false). */
export function newTestBadge(keep = true): Badge {
  const key = generatePrivateKey();
  if (keep) storage()?.setItem(KEY, key);
  return fromKey(key);
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && window.ethereum !== undefined;
}

/** Connects the injected wallet and moves it to Sepolia. */
export async function connectWallet(): Promise<Badge> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No wallet in this browser");
  const wallet = createWalletClient({ chain: sepolia, transport: custom(provider) });
  const [address] = await wallet.requestAddresses();
  if (!address) throw new Error("The wallet shared no account");
  if ((await wallet.getChainId()) !== sepolia.id) await wallet.switchChain({ id: sepolia.id });
  return {
    kind: "wallet",
    address,
    signClaim: (message) => signClaimWith(wallet, address, message, contractAddress("GameBoxNames")),
    send: (to, data) => wallet.sendTransaction({ account: address, chain: sepolia, to, data }),
  };
}
