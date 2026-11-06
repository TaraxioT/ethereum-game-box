import { describe, expect, it } from "vitest";
import type { BoxState, SeatState } from "../../core/types.ts";
import { joinWords } from "./join-words.ts";

const seat = (taken: boolean): SeatState => ({ badge: taken ? { address: "0x1", name: "nova" } : null, ens: null, balance: null, pending: 0, signed: false, record: null });

const state = (seated: number, seats: number, fewest: number, fetching = false): Pick<BoxState, "seats" | "fewest" | "fetching"> => ({
  seats: Array.from({ length: seats }, (_, i) => seat(i < seated)) as unknown as BoxState["seats"],
  fewest,
  fetching,
});

describe("Join's words", () => {
  it("keeps a two-seat game's", () => {
    expect(joinWords(state(0, 2, 2), "Quick Draw").plate).toBe("Quick Draw · TAP BOTH BADGES TO JOIN");
    expect(joinWords(state(1, 2, 2), "Quick Draw").plate).toBe("Quick Draw · TAP A BADGE TO JOIN");
    expect(joinWords(state(2, 2, 2), "Quick Draw").plate).toBe("BOTH SEATED");
    expect(joinWords(state(2, 2, 2, true), "Tap Rush").plate).toBe("DOWNLOADING THE GAME…");
  });

  it("asks for as many as the game needs, and lights START only with them seated and the bundle here", () => {
    expect(joinWords(state(0, 4, 3), "Tap Rush")).toEqual({ plate: "Tap Rush · TAP 3 BADGES TO JOIN", ready: false });
    expect(joinWords(state(2, 4, 3), "Tap Rush")).toEqual({ plate: "Tap Rush · TAP A BADGE TO JOIN", ready: false });
    expect(joinWords(state(3, 4, 3, true), "Tap Rush")).toEqual({ plate: "DOWNLOADING THE GAME…", ready: false });
    expect(joinWords(state(3, 4, 3), "Tap Rush")).toEqual({ plate: "3 SEATED · TAP TO JOIN, OR START", ready: true });
    expect(joinWords(state(4, 4, 3), "Tap Rush")).toEqual({ plate: "ALL SEATED", ready: true });
  });
});
