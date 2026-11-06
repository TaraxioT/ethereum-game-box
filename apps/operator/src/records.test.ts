// The operator form: its rules, what counts as a change, and the `setText` calls a save batches.
import { decodeFunctionData, toHex } from "viem";
import { packetToBytes } from "viem/ens";
import { describe, expect, it } from "vitest";
import { permissionedResolverAbi } from "@egb/shared/names";

import { type OperatorRecords, changedKeys, checkRecords, recordCalls } from "./records.ts";

const GAMES = ["stockduel", "quickdraw"];
const form = (patch: Partial<OperatorRecords> = {}): OperatorRecords => ({
  commission: "2500",
  location: "Jio World Centre, Mumbai",
  description: "Stock Duel and Quick Draw, two seats.",
  games: "stockduel,quickdraw",
  ...patch,
});

describe("checkRecords", () => {
  it("passes a good form, tidied", () => {
    const { values, problems } = checkRecords(form({ commission: " 0900 ".replace("0900", "1000"), games: " quickdraw , stockduel " }), GAMES);
    expect(problems).toEqual({});
    expect(values.games).toBe("quickdraw,stockduel");
    expect(values.commission).toBe("1000");
  });

  it("keeps commission in basis points between 10% and 90%", () => {
    expect(checkRecords(form({ commission: "999" })).problems.commission).toMatch(/1000 and 9000/);
    expect(checkRecords(form({ commission: "9001" })).problems.commission).toMatch(/1000 and 9000/);
    expect(checkRecords(form({ commission: "12.5" })).problems.commission).toMatch(/whole number/);
    expect(checkRecords(form({ commission: "-1" })).problems.commission).toMatch(/whole number/);
    expect(checkRecords(form({ commission: "9000" })).problems.commission).toBeUndefined();
    expect(checkRecords(form({ commission: "0100" })).values.commission).toBe("100");
  });

  it("allows an empty record, which clears it", () => {
    expect(checkRecords(form({ commission: "", location: "", description: "", games: "" }), GAMES).problems).toEqual({});
  });

  it("limits location and description, and refuses line breaks", () => {
    expect(checkRecords(form({ location: "x".repeat(81) })).problems.location).toMatch(/80/);
    expect(checkRecords(form({ description: "x".repeat(281) })).problems.description).toMatch(/280/);
    expect(checkRecords(form({ description: "two\nlines" })).problems.description).toMatch(/line breaks/);
    expect(checkRecords(form({ location: "x".repeat(80) })).problems.location).toBeUndefined();
  });

  it("takes only valid, known, distinct game labels", () => {
    expect(checkRecords(form({ games: "Stockduel" }), GAMES).problems.games).toMatch(/a-z/);
    expect(checkRecords(form({ games: "chess" }), GAMES).problems.games).toMatch(/isn't a Game Box game/);
    expect(checkRecords(form({ games: "chess" })).problems.games).toBeUndefined();
    expect(checkRecords(form({ games: "quickdraw,quickdraw" }), GAMES).problems.games).toMatch(/once/);
    expect(checkRecords(form({ games: "-qd" }), GAMES).problems.games).toMatch(/hyphen/);
  });
});

describe("a save", () => {
  it("writes only the changed keys", () => {
    const current = form();
    expect(changedKeys(form(), current)).toEqual([]);
    expect(changedKeys(form({ location: "Bandra", games: "quickdraw" }), current)).toEqual(["location", "games"]);
  });

  it("is one setText per changed key on the Box's resolver, for its DNS-encoded name", () => {
    const resolver = "0x00000000000000000000000000000000000000aa";
    const values = form({ location: "Bandra" });
    const calls = recordCalls(resolver, "mumbai-01", values, ["location", "commission"]);
    expect(calls).toHaveLength(2);
    const decoded = calls.map((call) => {
      expect(call.target).toBe(resolver);
      expect(call.value).toBe(0n);
      return decodeFunctionData({ abi: permissionedResolverAbi, data: call.data });
    });
    expect(decoded.map((d) => d.functionName)).toEqual(["setText", "setText"]);
    expect(decoded[0]!.args).toEqual([toHex(packetToBytes("mumbai-01.gamebox.eth")), "location", "Bandra"]);
    expect(decoded[1]!.args?.[2]).toBe("2500");
    expect(decoded[0]!.args?.[0]).toBe("0x096d756d6261692d30310767616d65626f780365746800");
  });
});
