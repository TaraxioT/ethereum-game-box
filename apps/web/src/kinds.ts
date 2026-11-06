// What kind of account an address is: a `P256Account` (made by our `P256AccountFactory`, moved only by a P-256
// signature), an EOA (an ECDSA key), or another contract (a registrar, `PlayerStats`, …).
import { type Address, type Hex, type PublicClient, getAddress } from "viem";
import { ourContract, p256AccountAbi, p256AccountFactoryAbi } from "@egb/shared/names";

export type AccountKind = "P256Account" | "EOA" | "contract";

/** The reads `accountKind` decides from. */
export interface KindReads {
  /** The code at the address (`0x` or undefined for none). */
  code: Hex | undefined;
  /** What `P256AccountFactory.accountOf(publicKey())` gave for it, or null when it has no `publicKey()`. */
  factoryAccount: Address | null;
}

/** EIP-7702: an EOA that delegates to code still signs with its own key. */
const DELEGATION_PREFIX = "0xef0100";

export function accountKind(address: Address, reads: KindReads): AccountKind {
  const code = reads.code ?? "0x";
  if (code === "0x" || code.toLowerCase().startsWith(DELEGATION_PREFIX)) return "EOA";
  if (reads.factoryAccount && getAddress(reads.factoryAccount) === getAddress(address)) return "P256Account";
  return "contract";
}

/** Reads one address's kind from chain. */
export async function readAccountKind(client: PublicClient, address: Address): Promise<AccountKind> {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return "EOA";
  const factory = ourContract("P256AccountFactory");
  const factoryAccount = await client
    .readContract({ address, abi: p256AccountAbi, functionName: "publicKey" })
    .then(([qx, qy]) =>
      factory
        ? client.readContract({ address: factory.address, abi: p256AccountFactoryAbi, functionName: "accountOf", args: [qx, qy] })
        : null,
    )
    .catch(() => null);
  return accountKind(address, { code, factoryAccount });
}

/** The kinds of several addresses, read together. */
export async function readAccountKinds(client: PublicClient, addresses: readonly Address[]): Promise<Map<string, AccountKind>> {
  const kinds = await Promise.all(addresses.map((a) => readAccountKind(client, a).catch(() => null)));
  const out = new Map<string, AccountKind>();
  addresses.forEach((a, i) => {
    const kind = kinds[i];
    if (kind) out.set(getAddress(a), kind);
  });
  return out;
}
