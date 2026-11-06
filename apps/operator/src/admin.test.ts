// The admin's licence forms and the calls they make on `GameBoxNames`.
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { P256_VECTOR_KEY, gameBoxNamesAbi } from "@egb/shared/names";

import { DAY, checkDays, checkLicence, registerCall, renewCall, renewedExpiry, rotateCall, statusCall, statusIndex } from "./admin.ts";
import { boxKeyText } from "./p256.ts";

const NAMES = "0x00000000000000000000000000000000000000bb";
const NOW = 1_800_000_000;
const KEY = { qx: P256_VECTOR_KEY.qx, qy: P256_VECTOR_KEY.qy };
const OPERATOR = "0x2046206bd14fdece482cf36c9b947add91170de2";
const good = { label: "mumbai-01", operator: OPERATOR, boxKey: boxKeyText(KEY), days: "30" };

describe("checkLicence", () => {
  it("passes a good form", () => {
    const { licence, problems } = checkLicence(good, NOW);
    expect(problems).toEqual({});
    expect(licence).toEqual({ label: "mumbai-01", operator: "0x2046206bd14fDECe482Cf36c9B947ADD91170De2", key: KEY, expiry: BigInt(NOW + 30 * DAY) });
  });

  it("names each bad field", () => {
    const { licence, problems } = checkLicence({ label: "Mumbai", operator: "0x12", boxKey: "0x04", days: "0" }, NOW);
    expect(licence).toBeNull();
    expect(problems.label).toMatch(/a-z/);
    expect(problems.operator).toMatch(/address/);
    expect(problems.boxKey).toMatch(/P-256/);
    expect(problems.days).toMatch(/between 1 and/);
  });

  it("keeps popup- labels for pop-ups", () => {
    expect(checkLicence({ ...good, label: "popup-x1" }, NOW).problems.label).toMatch(/pop-up/);
  });
});

describe("licence terms", () => {
  it("takes whole days up to ten years", () => {
    expect(checkDays("30")).toEqual({ days: 30 });
    expect(checkDays("1.5")).toEqual({ problem: "a whole number of days" });
    expect(checkDays("3651")).toHaveProperty("problem");
  });

  it("renews from the later of now and the current expiry", () => {
    expect(renewedExpiry(NOW + 5 * DAY, NOW, 30)).toBe(BigInt(NOW + 35 * DAY));
    expect(renewedExpiry(NOW - 5 * DAY, NOW, 30)).toBe(BigInt(NOW + 30 * DAY));
  });
});

describe("the calls", () => {
  const decode = (data: `0x${string}`) => decodeFunctionData({ abi: gameBoxNamesAbi, data });

  it("registers a Box with its account and key", () => {
    const { licence } = checkLicence(good, NOW);
    const call = registerCall(NAMES, licence!, "0x00000000000000000000000000000000000000cc");
    expect(call.target).toBe(NAMES);
    const { functionName, args } = decode(call.data);
    expect(functionName).toBe("registerBox");
    expect(args).toEqual(["mumbai-01", licence!.operator, "0x00000000000000000000000000000000000000cc", KEY.qx, KEY.qy, BigInt(NOW + 30 * DAY)]);
  });

  it("renews, sets the status and rotates the key", () => {
    expect(decode(renewCall(NAMES, "mumbai-01", 5n).data)).toMatchObject({ functionName: "renewBox", args: ["mumbai-01", 5n] });
    expect(decode(statusCall(NAMES, "mumbai-01", "suspended").data)).toMatchObject({ functionName: "setBoxStatus", args: ["mumbai-01", 2] });
    expect(decode(rotateCall(NAMES, "mumbai-01", KEY, OPERATOR).data)).toMatchObject({ functionName: "setBoxKey", args: ["mumbai-01", KEY.qx, KEY.qy, "0x2046206bd14fDECe482Cf36c9B947ADD91170De2"] });
  });

  it("numbers statuses as GameBoxNames.BoxStatus does", () => {
    expect([statusIndex("active"), statusIndex("suspended"), statusIndex("revoked")]).toEqual([1, 2, 3]);
  });
});
