// The claim flow's signature must be the one the contract checks: the shared vector, made with GameBoxNames'
// own digest on the fork.
import { createWalletClient, http, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { CLAIM_NAME_VECTOR, claimNameDigest, claimNameTypedData } from "@egb/shared/names";
import { describe, expect, it } from "vitest";

import { signClaimWith } from "./badge.ts";

describe("the claim signature", () => {
  const account = privateKeyToAccount(CLAIM_NAME_VECTOR.privateKey);
  // Never sends: signing with a local account makes no request.
  const wallet = createWalletClient({ account, chain: sepolia, transport: http("http://127.0.0.1:1") });

  it("equals the shared vector", async () => {
    const signature = await signClaimWith(wallet, account, CLAIM_NAME_VECTOR.message, CLAIM_NAME_VECTOR.gameBoxNames, CLAIM_NAME_VECTOR.chainId);
    expect(signature).toBe(CLAIM_NAME_VECTOR.signature);
  });

  it("is over the digest GameBoxNames.claimDigest gives, and recovers to the badge", async () => {
    const { message, gameBoxNames, chainId } = CLAIM_NAME_VECTOR;
    expect(claimNameDigest(message, gameBoxNames, chainId)).toBe(CLAIM_NAME_VECTOR.digest);
    const signer = await recoverTypedDataAddress({ ...claimNameTypedData(message, gameBoxNames, chainId), signature: CLAIM_NAME_VECTOR.signature });
    expect(signer).toBe(message.badge);
  });
});
