// The digests the operator site has a passkey sign, and the WebAuthn signature it sends, against the vectors the
// contracts produced (`@egb/shared/names`, written by `Vectors.t.sol`).
import { type Hex, bytesToHex, decodeAbiParameters, hexToBytes, numberToHex } from "viem";
import { describe, expect, it } from "vitest";
import {
  EXECUTE_BATCH_VECTOR,
  EXECUTE_VECTOR,
  P256_HALF_N,
  P256_N,
  P256_VECTOR_KEY,
  WEBAUTHN_VECTOR,
} from "@egb/shared/names";

import { executeRequest, workDigest } from "./account.ts";
import { assertionSignature, base64url, checkAssertion, fromBase64url } from "./passkey.ts";
import { assertionHash, boxKeyText, parseBoxKey, recoverKeys, verifies } from "./p256.ts";

/** DER `SEQUENCE { INTEGER r, INTEGER s }`, as an authenticator returns a signature. */
function der(r: bigint, s: bigint): Uint8Array {
  const int = (n: bigint) => {
    let bytes = hexToBytes(numberToHex(n));
    while (bytes.length > 1 && bytes[0] === 0 && bytes[1]! < 0x80) bytes = bytes.subarray(1);
    if (bytes[0]! >= 0x80) bytes = Uint8Array.of(0, ...bytes);
    return [0x02, bytes.length, ...bytes];
  };
  const body = [...int(r), ...int(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}

const assertion = {
  authenticatorData: hexToBytes(WEBAUTHN_VECTOR.authenticatorData),
  clientDataJSON: hexToBytes(WEBAUTHN_VECTOR.clientDataJSON),
  signature: der(BigInt(WEBAUTHN_VECTOR.r), BigInt(WEBAUTHN_VECTOR.s)),
};
const key = { qx: P256_VECTOR_KEY.qx, qy: P256_VECTOR_KEY.qy };

describe("the digest a passkey signs", () => {
  it("is P256Account.executeDigest for one call", () => {
    const { target, value, data, nonce, deadline } = EXECUTE_VECTOR.call;
    expect(workDigest(EXECUTE_VECTOR.account, { call: { target, value, data } }, nonce, deadline)).toBe(EXECUTE_VECTOR.digest);
  });

  it("is P256Account.batchDigest for a batch", () => {
    const { calls, nonce, deadline } = EXECUTE_BATCH_VECTOR.batch;
    expect(workDigest(EXECUTE_BATCH_VECTOR.account, { calls }, nonce, deadline)).toBe(EXECUTE_BATCH_VECTOR.digest);
  });

  it("goes to /account/execute with its integers as decimal strings", () => {
    const { calls, nonce, deadline } = EXECUTE_BATCH_VECTOR.batch;
    const body = JSON.parse(JSON.stringify(executeRequest(EXECUTE_BATCH_VECTOR.account, { calls }, nonce, deadline, EXECUTE_BATCH_VECTOR.signature)));
    expect(body).toEqual({
      account: EXECUTE_BATCH_VECTOR.account,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signature: EXECUTE_BATCH_VECTOR.signature,
      calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
    });
    const single = executeRequest(EXECUTE_VECTOR.account, { call: EXECUTE_VECTOR.call }, 1n, 2n, "0x");
    expect(single.call?.value).toBe(EXECUTE_VECTOR.call.value.toString());
    expect("calls" in single).toBe(false);
  });
});

describe("the WebAuthn signature", () => {
  it("encodes the vector's assertion as the account ran it", () => {
    expect(assertionSignature(key, WEBAUTHN_VECTOR.digest, assertion)).toBe(WEBAUTHN_VECTOR.signature);
  });

  it("sends a high s as the low one", () => {
    const high = { ...assertion, signature: der(BigInt(WEBAUTHN_VECTOR.r), P256_N - BigInt(WEBAUTHN_VECTOR.s)) };
    const encoded = assertionSignature(key, WEBAUTHN_VECTOR.digest, high);
    expect(encoded).toBe(WEBAUTHN_VECTOR.signature);
    const [, s, challengeIndex, typeIndex] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "string" }],
      encoded,
    );
    expect(BigInt(s) <= P256_HALF_N).toBe(true);
    expect(Number(challengeIndex)).toBe(WEBAUTHN_VECTOR.challengeIndex);
    expect(Number(typeIndex)).toBe(WEBAUTHN_VECTOR.typeIndex);
  });

  it("refuses an assertion of another challenge", () => {
    const other = `0x${"11".repeat(32)}` as Hex;
    expect(() => assertionSignature(key, other, assertion)).toThrow(/different challenge/);
  });

  it("refuses an assertion without user verification", () => {
    const data = Uint8Array.from(assertion.authenticatorData);
    data[32] = data[32]! & ~0x04;
    expect(() => assertionSignature(key, WEBAUTHN_VECTOR.digest, { ...assertion, authenticatorData: data })).toThrow(/verify you/);
  });

  it("refuses a registration's clientData", () => {
    const json = new TextDecoder().decode(assertion.clientDataJSON).replace("webauthn.get", "webauthn.create");
    expect(() => checkAssertion({ ...assertion, clientDataJSON: new TextEncoder().encode(json) }, hexToBytes(WEBAUTHN_VECTOR.digest))).toThrow(/Not a WebAuthn assertion/);
  });

  it("refuses another key's signature", () => {
    const other = parseBoxKey(`0x04${"6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"}${"4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"}`)!;
    expect(() => assertionSignature(other, WEBAUTHN_VECTOR.digest, assertion)).toThrow(/isn't this passkey's/);
  });
});

describe("a passkey's public key, from a sign-in", () => {
  it("is one of the keys its signature recovers to", () => {
    const hash = assertionHash(assertion.authenticatorData, assertion.clientDataJSON);
    const keys = recoverKeys(BigInt(WEBAUTHN_VECTOR.r), BigInt(WEBAUTHN_VECTOR.s), hash);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.map((k) => k.qx)).toContain(P256_VECTOR_KEY.qx);
    for (const k of keys) expect(verifies(k, BigInt(WEBAUTHN_VECTOR.r), BigInt(WEBAUTHN_VECTOR.s), hash)).toBe(true);
  });

  it("round-trips a credential id through base64url", () => {
    const id = Uint8Array.from({ length: 33 }, (_, i) => (i * 37) & 0xff);
    expect(bytesToHex(fromBase64url(base64url(id)))).toBe(bytesToHex(id));
  });
});

describe("a Box's key, as an admin pastes it", () => {
  it("reads 0x04 + x + y, and x + y", () => {
    const text = boxKeyText(key);
    expect(parseBoxKey(text)).toEqual(key);
    expect(parseBoxKey(text.slice(4))).toEqual(key);
    expect(parseBoxKey(`  ${text.toUpperCase().replace("0X", "0x")}  `)).toEqual(key);
  });

  it("refuses what isn't a point on P-256", () => {
    expect(parseBoxKey(`0x04${"00".repeat(64)}`)).toBeNull();
    expect(parseBoxKey(`0x04${P256_VECTOR_KEY.qx.slice(2)}${"01".repeat(32)}`)).toBeNull();
    expect(parseBoxKey("0x1234")).toBeNull();
    expect(parseBoxKey("not a key")).toBeNull();
  });
});
