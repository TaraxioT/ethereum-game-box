// Which resolver answered, and why: decided from recorded reads of each case the site meets.
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { type AnswerReads, ancestorsOf, classifyAnswer, explainAnswer } from "./answer.ts";

const BOX_RESOLVER = getAddress("0x91b2000000000000000000000000000000077c40");
const PLAYER_RESOLVER = getAddress("0x4c10000000000000000000000000000000003e21");
const GAMEBOX_RESOLVER = getAddress("0x7a30000000000000000000000000000000005d02");
const ancestors = [{ name: "gamebox.eth", resolver: GAMEBOX_RESOLVER }];

const reads = (patch: Partial<AnswerReads>): AnswerReads => ({
  answeredBy: null,
  own: null,
  recordId: 0n,
  ancestors,
  link: null,
  ...patch,
});

describe("which resolver answered", () => {
  it("a name with no resolver anywhere answers nothing", () => {
    expect(classifyAnswer(reads({}))).toEqual({ kind: "none" });
  });

  it("a player name is answered by its own resolver, from its own record", () => {
    const answer = classifyAnswer(reads({ answeredBy: PLAYER_RESOLVER, own: PLAYER_RESOLVER, recordId: 1n }));
    expect(answer).toEqual({ kind: "own", resolver: PLAYER_RESOLVER, recordId: 1n });
    expect(explainAnswer(answer).why).toContain("record #1");
  });

  it("a live pop-up is answered from its Box's record: a linked record, named, with its id", () => {
    const answer = classifyAnswer(
      reads({ answeredBy: BOX_RESOLVER, own: BOX_RESOLVER, recordId: 3n, link: { name: "mumbai-01.gamebox.eth", recordId: 3n } }),
    );
    expect(answer).toEqual({ kind: "linked", resolver: BOX_RESOLVER, recordId: 3n, linkedTo: "mumbai-01.gamebox.eth" });
    const { headline, why } = explainAnswer(answer);
    expect(headline).toBe("A linked record: mumbai-01.gamebox.eth's");
    expect(why).toContain("record #3");
    expect(why).toContain("record aliasing");
  });

  it("a pop-up whose record differs from its Box's is its own, not linked", () => {
    const answer = classifyAnswer(
      reads({ answeredBy: BOX_RESOLVER, own: BOX_RESOLVER, recordId: 4n, link: { name: "mumbai-01.gamebox.eth", recordId: 3n } }),
    );
    expect(answer.kind).toBe("own");
  });

  it("a lapsed pop-up falls back to gamebox.eth's resolver by wildcard, and reads its default record", () => {
    const answer = classifyAnswer(
      reads({ answeredBy: GAMEBOX_RESOLVER, own: null, recordId: 0n, link: { name: "mumbai-01.gamebox.eth", recordId: 3n } }),
    );
    expect(answer).toEqual({ kind: "wildcard", resolver: GAMEBOX_RESOLVER, from: "gamebox.eth", recordId: 0n });
    const { headline, why } = explainAnswer(answer);
    expect(headline).toBe("gamebox.eth's resolver, by wildcard");
    expect(why).toContain("ENSIP-10");
    expect(why).toContain("default record");
  });

  it("a free name is answered by gamebox.eth's resolver by wildcard", () => {
    expect(classifyAnswer(reads({ answeredBy: GAMEBOX_RESOLVER })).kind).toBe("wildcard");
  });

  it("compares resolver addresses whatever their case", () => {
    const answer = classifyAnswer(reads({ answeredBy: PLAYER_RESOLVER.toLowerCase() as `0x${string}`, own: PLAYER_RESOLVER, recordId: 2n }));
    expect(answer.kind).toBe("own");
  });

  it("a resolver that isn't an ancestor's still reads as a wildcard, without a name", () => {
    const answer = classifyAnswer(reads({ answeredBy: BOX_RESOLVER, ancestors: [{ name: "gamebox.eth", resolver: null }] }));
    expect(answer).toEqual({ kind: "wildcard", resolver: BOX_RESOLVER, from: null, recordId: 0n });
  });

  it("lists a name's ancestors nearest first, without eth", () => {
    expect(ancestorsOf("champion.quickdraw.gamebox.eth")).toEqual(["quickdraw.gamebox.eth", "gamebox.eth"]);
    expect(ancestorsOf("nova.gamebox.eth")).toEqual(["gamebox.eth"]);
    expect(ancestorsOf("gamebox.eth")).toEqual([]);
  });
});
