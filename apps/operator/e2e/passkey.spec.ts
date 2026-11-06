// The passkey flow end to end in Chromium, with a CDP virtual authenticator as the device: make a passkey, save a
// Box's records (the account is deployed first, then one executeBatch under one passkey signature), sign out and in
// again on a "new device", and, as a licensor, register a Box. Each signature the relayer receives is checked here the
// way `P256Account` checks it, with node:crypto rather than the site's own code.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import { type CDPSession, type Page, expect, test } from "@playwright/test";
import { type Hex, bytesToHex, decodeAbiParameters, decodeFunctionData, getAddress, hexToBytes } from "viem";
import {
  type ExecuteRequest,
  P256_HALF_N,
  executeBatchDigest,
  executeDigest,
  gameBoxNamesAbi,
  permissionedResolverAbi,
} from "@egb/shared/names";

import { MockChain, NAMES, mockAccountOf } from "./mock.ts";

const b64url = (hex: Hex) => Buffer.from(hexToBytes(hex)).toString("base64url");

async function authenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  return { cdp, id: authenticatorId };
}

/** The stored passkey: only its credential id and public key. */
async function stored(page: Page): Promise<{ id: string; qx: Hex; qy: Hex }> {
  const value = await page.evaluate(() => localStorage.getItem("egb.operator.passkey"));
  expect(value).not.toBeNull();
  return JSON.parse(value!) as { id: string; qx: Hex; qy: Hex };
}

/** Checks a WebAuthn signature the way `P256Account` does: the type, the challenge (the digest), user present and
 *  verified, a low s, and the key's P-256 signature over `authenticatorData ‖ sha256(clientDataJSON)`. */
function checkSignature(signature: Hex, digest: Hex, key: { qx: Hex; qy: Hex }): void {
  const [r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON] = decodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "string" }],
    signature,
  );
  const client = JSON.parse(clientDataJSON) as { type: string; challenge: string };
  expect(client.type).toBe("webauthn.get");
  expect(client.challenge).toBe(b64url(digest));
  expect(clientDataJSON.slice(Number(challengeIndex))).toMatch(/^"challenge":"/);
  expect(clientDataJSON.slice(Number(typeIndex))).toMatch(/^"type":"webauthn.get"/);
  expect(hexToBytes(authenticatorData)[32]! & 0x05).toBe(0x05);
  expect(BigInt(s) <= P256_HALF_N).toBe(true);
  const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url(key.qx), y: b64url(key.qy) }, format: "jwk" });
  const signed = Buffer.concat([Buffer.from(hexToBytes(authenticatorData)), createHash("sha256").update(clientDataJSON).digest()]);
  const rs = Buffer.concat([Buffer.from(hexToBytes(r)), Buffer.from(hexToBytes(s))]);
  expect(verify("sha256", signed, { key: publicKey, dsaEncoding: "ieee-p1363" }, rs)).toBe(true);
}

const calls = (body: ExecuteRequest) => (body.calls ?? []).map((c) => ({ target: c.target, value: BigInt(c.value), data: c.data }));

async function createPasskey(page: Page): Promise<{ id: string; qx: Hex; qy: Hex; account: `0x${string}` }> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Run your Box from a passkey." })).toBeVisible();
  await page.getByLabel("Name").fill("e2e operator");
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await expect(page.locator("[data-account]")).not.toHaveAttribute("data-account", "");
  const key = await stored(page);
  const account = mockAccountOf(key.qx, key.qy);
  await expect(page.locator("[data-account]")).toHaveAttribute("data-account", account);
  return { ...key, account };
}

test("a passkey makes an account, saves a Box's records in one signature, and signs in again", async ({ page }) => {
  const chain = new MockChain();
  await chain.install(page);
  const { cdp, id: authenticatorId } = await authenticator(page);

  const key = await createPasskey(page);
  expect(Object.keys(await stored(page)).sort()).toEqual(["id", "qx", "qy"]);
  await expect(page.getByText("Not deployed yet")).toBeVisible();

  // The site kept the authenticator's own credential and public key.
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);
  const credential = credentials[0]!;
  expect(credential.isResidentCredential).toBe(true);
  expect(credential.rpId).toBe("localhost");
  expect(Buffer.from(credential.credentialId, "base64").toString("base64url")).toBe(key.id);
  const jwk = createPublicKey(createPrivateKey({ key: Buffer.from(credential.privateKey, "base64"), format: "der", type: "pkcs8" })).export({ format: "jwk" });
  expect(b64url(key.qx)).toBe(jwk.x);
  expect(b64url(key.qy)).toBe(jwk.y);

  // The admin licenses mumbai-01 to the account; the page reads it on its next load.
  chain.boxes.push({
    label: "mumbai-01",
    operator: key.account,
    account: getAddress("0x00000000000000000000000000000000000b0c01"),
    qx: `0x${"11".repeat(32)}`,
    qy: `0x${"22".repeat(32)}`,
    status: 1,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400),
    records: { commission: "", location: "Mumbai", description: "", games: "stockduel", lastSeen: String(Math.floor(Date.now() / 1000) - 120), game: "quickdraw" },
  });
  chain.onExecute = (body) => {
    for (const call of calls(body)) {
      const { args } = decodeFunctionData({ abi: permissionedResolverAbi, data: call.data });
      const [, k, v] = args as [Hex, string, string];
      chain.boxes[0]!.records[k] = v;
    }
  };
  await page.reload();
  const card = page.locator('[data-box="mumbai-01"]');
  await expect(card).toBeVisible();
  await expect(card.getByText("2 min ago")).toBeVisible();

  // The form checks as you type.
  const save = card.getByRole("button", { name: /^Save/ });
  await expect(save).toBeDisabled();
  await card.getByLabel("Commission").fill("50");
  await expect(card.getByText("between 1000 and 9000 bps")).toBeVisible();
  await expect(save).toBeDisabled();
  await card.getByLabel("Commission").fill("2500");
  await card.getByLabel("Location").fill("Jio World Centre, Mumbai");
  await card.getByLabel("Games").fill("stockduel, quickdraw");
  await expect(save).toHaveText("Save 3 changes");
  await save.click();
  await expect(card.getByText("Saved on chain.")).toBeVisible();

  // First the account's deploy, then one executeBatch, signed by the passkey over the batch digest.
  expect(chain.posted.map((p) => p.path)).toEqual(["/account/deploy", "/account/execute"]);
  await expect(page.getByText("A P256Account on Sepolia.")).toBeVisible();
  expect(chain.posted[0]!.body).toEqual({ qx: key.qx, qy: key.qy });
  const body = chain.posted[1]!.body as ExecuteRequest;
  expect(getAddress(body.account)).toBe(key.account);
  expect(body.call).toBeUndefined();
  const batch = calls(body);
  const digest = executeBatchDigest({ calls: batch, nonce: BigInt(body.nonce), deadline: BigInt(body.deadline) }, key.account);
  checkSignature(body.signature, digest, key);
  expect(batch.map((c) => decodeFunctionData({ abi: permissionedResolverAbi, data: c.data }).args?.slice(1))).toEqual([
    ["commission", "2500"],
    ["location", "Jio World Centre, Mumbai"],
    ["games", "stockduel,quickdraw"],
  ]);

  // The strip shows both, done, with Etherscan links; the form shows the chain's new values.
  const strip = page.locator("#txs .tx");
  await expect(strip).toHaveCount(2);
  await expect(strip.nth(0)).toContainText("SAVE");
  await expect(strip.nth(0)).toHaveAttribute("data-status", "done");
  await expect(strip.nth(1)).toContainText("DEPLOY");
  await expect(strip.nth(0).locator('a[href^="https://sepolia.etherscan.io/tx/0x"]')).toBeVisible();
  await expect(page.locator('[data-box="mumbai-01"]').getByLabel("Location")).toHaveValue("Jio World Centre, Mumbai");

  // Signing out forgets the key; signing in on a "new device" recovers it from the signature, and the deployed account
  // tells the two candidates apart.
  await page.getByRole("button", { name: "Sign out" }).click();
  expect(await page.evaluate(() => localStorage.getItem("egb.operator.passkey"))).toBeNull();
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.locator("[data-account]")).toHaveAttribute("data-account", key.account);
  expect(await stored(page)).toEqual({ id: key.id, qx: key.qx, qy: key.qy });
});

test("a licensor registers a Box with one signed execute, then its Box account is deployed", async ({ page }) => {
  const chain = new MockChain();
  await chain.install(page);
  await authenticator(page);

  const key = await createPasskey(page);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  chain.licensors.add(key.account);
  chain.deployed.add(key.account);
  await page.reload();
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.getByRole("heading", { name: "Box licences" })).toBeVisible();

  const box = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
  const qx = bytesToHex(Buffer.from(box.x!, "base64url"));
  const qy = bytesToHex(Buffer.from(box.y!, "base64url"));
  const boxAccount = mockAccountOf(qx, qy);
  await page.getByLabel("Label").fill("pune-02");
  await page.getByLabel("Operator").fill("0x2046206bd14fdece482cf36c9b947add91170de2");
  await page.getByLabel("Box key").fill(`0x04${qx.slice(2)}${qy.slice(2)}`);
  await expect(page.getByText(`Its account: ${boxAccount}`)).toBeVisible();
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText("Done on chain.")).toBeVisible();

  expect(chain.posted.map((p) => p.path)).toEqual(["/account/execute", "/account/deploy"]);
  const body = chain.posted[0]!.body as ExecuteRequest;
  expect(body.calls).toBeUndefined();
  const call = { target: body.call!.target, value: BigInt(body.call!.value), data: body.call!.data };
  expect(getAddress(call.target)).toBe(NAMES);
  checkSignature(body.signature, executeDigest({ ...call, nonce: BigInt(body.nonce), deadline: BigInt(body.deadline) }, key.account), key);
  const { functionName, args } = decodeFunctionData({ abi: gameBoxNamesAbi, data: call.data });
  expect(functionName).toBe("registerBox");
  expect(args?.slice(0, 5)).toEqual(["pune-02", "0x2046206bd14fDECe482Cf36c9B947ADD91170De2", boxAccount, qx, qy]);
  expect(chain.posted[1]!.body).toEqual({ qx, qy });
});
