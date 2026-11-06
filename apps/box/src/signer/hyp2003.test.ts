// The HYP2003 signer daemon's client, against a stand-in daemon that speaks the same JSON lines (with a software key):
// it waits for `ready`, signs over stdin and stdout, passes an error on, starts a daemon that died again, and never
// starts one again after it said the token refused the PIN.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { P256_VECTOR_KEY, STAKE_VECTOR, verifyP256 } from "@egb/shared/names";
import { hexToBytes } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { processSigner, splitCommand } from "./hyp2003.ts";
import type { BoxSigner } from "./signer.ts";

const curves = new URL(import.meta.resolve("@noble/curves/nist.js")).pathname;

/** A daemon: ready with the vector key, then signs; `mode` makes it die after one answer, or refuse the PIN. */
function daemon(mode: "ok" | "die" | "pin"): string {
  const dir = mkdtempSync(join(tmpdir(), "egb-signer-"));
  const file = join(dir, "daemon.mjs");
  writeFileSync(
    file,
    `import { p256 } from ${JSON.stringify(curves)};
import { createInterface } from "node:readline";
const key = Buffer.from(${JSON.stringify(P256_VECTOR_KEY.privateKey.slice(2))}, "hex");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (${JSON.stringify(mode)} === "pin") { out({ fatal: "pin_rejected", error: "CKR_PIN_INCORRECT" }); process.exit(3); }
process.stderr.write("[p256-signer] ready in 1 ms\\n");
out({ ready: true, qx: ${JSON.stringify(P256_VECTOR_KEY.qx)}, qy: ${JSON.stringify(P256_VECTOR_KEY.qy)} });
createInterface({ input: process.stdin }).on("line", (line) => {
  const req = JSON.parse(line);
  if (req.digest === "0x" + "00".repeat(32)) return out({ id: req.id, error: "token error: CKR_DEVICE_ERROR" });
  const sig = p256.sign(Buffer.from(req.digest.slice(2), "hex"), key, { prehash: false, lowS: true, format: "compact" });
  out({ id: req.id, r: "0x" + Buffer.from(sig.subarray(0, 32)).toString("hex"), s: "0x" + Buffer.from(sig.subarray(32)).toString("hex"), ms: 1 });
  if (${JSON.stringify(mode)} === "die") process.exit(1);
});
`,
  );
  return `${process.execPath} ${file}`;
}

const signers: BoxSigner[] = [];
afterEach(() => {
  for (const signer of signers.splice(0)) signer.stop();
});

function start(mode: "ok" | "die" | "pin", logs: string[] = []): BoxSigner {
  const signer = processSigner(daemon(mode), (text) => logs.push(text));
  signers.push(signer);
  return signer;
}

describe("the HYP2003 signer's client", () => {
  it("splits the command on spaces, with no shell", () => {
    expect(splitCommand(" python3  /home/pi/egb/current/deploy/p256-signer/hyp2003_signer.py --serve ")).toEqual([
      "python3",
      "/home/pi/egb/current/deploy/p256-signer/hyp2003_signer.py",
      "--serve",
    ]);
    expect(() => splitCommand("  ")).toThrow(/empty/);
  });

  it("waits for ready, gives the key, and signs digests raw with a low s", async () => {
    const logs: string[] = [];
    const signer = start("ok", logs);
    expect(await signer.publicKey()).toEqual({ qx: P256_VECTOR_KEY.qx, qy: P256_VECTOR_KEY.qy });
    const { r, s } = await signer.sign(STAKE_VECTOR.digest);
    expect(verifyP256(P256_VECTOR_KEY, BigInt(r), BigInt(s), hexToBytes(STAKE_VECTOR.digest))).toBe(true);
    await expect(signer.sign(`0x${"00".repeat(32)}`)).rejects.toThrow(/CKR_DEVICE_ERROR/);
    await expect(signer.sign("0x12")).rejects.toThrow(/64 hex/);
    expect(logs.some((line) => line.includes("ready in 1 ms"))).toBe(true);
  });

  it("starts a daemon that exited again", async () => {
    const logs: string[] = [];
    const signer = start("die", logs);
    await signer.sign(STAKE_VECTOR.digest);
    await expect.poll(() => logs.some((line) => line.includes("starting it again")), { timeout: 3_000 }).toBe(true);
  });

  it("never starts it again once the token refused the PIN", async () => {
    const logs: string[] = [];
    const signer = start("pin", logs);
    await expect(signer.sign(STAKE_VECTOR.digest)).rejects.toThrow(/pin_rejected|refused the PIN/);
    await expect(signer.publicKey()).rejects.toThrow(/stopped for good|refused the PIN/);
    expect(logs.some((line) => line.includes("starting it again"))).toBe(false);
  });
});
