// The record watch: each name's value, and the block where it was first seen changing.
import { describe, expect, it } from "vitest";

import { track } from "./watch.ts";

const BOX = "mumbai-01.gamebox.eth";
const POPUP = "popup-story1.gamebox.eth";

describe("the record watch", () => {
  it("a first read is no change", () => {
    const seen = track(new Map(), new Map([[BOX, "Hall B"]]), 100n);
    expect(seen.get(BOX)).toEqual({ value: "Hall B", changedAt: null });
  });

  it("a new value marks the block it appeared at, on the Box and its pop-up alike", () => {
    let seen = track(new Map(), new Map([[BOX, "Hall B"], [POPUP, "Hall B"]]), 100n);
    seen = track(seen, new Map([[BOX, "Stage 2"], [POPUP, "Stage 2"]]), 101n);
    expect(seen.get(BOX)).toEqual({ value: "Stage 2", changedAt: 101n });
    expect(seen.get(POPUP)).toEqual({ value: "Stage 2", changedAt: 101n });
  });

  it("an unchanged value keeps the block of its last change", () => {
    let seen = track(new Map(), new Map([[BOX, "Hall B"]]), 100n);
    seen = track(seen, new Map([[BOX, "Stage 2"]]), 101n);
    seen = track(seen, new Map([[BOX, "Stage 2"]]), 102n);
    expect(seen.get(BOX)?.changedAt).toBe(101n);
  });

  it("a lapsed pop-up that loses the value counts as a change; a name no longer read is dropped", () => {
    let seen = track(new Map(), new Map([[BOX, "Hall B"], [POPUP, "Hall B"]]), 100n);
    seen = track(seen, new Map([[BOX, "Hall B"], [POPUP, null]]), 150n);
    expect(seen.get(POPUP)).toEqual({ value: null, changedAt: 150n });
    seen = track(seen, new Map([[BOX, "Hall B"]]), 151n);
    expect(seen.has(POPUP)).toBe(false);
  });

  it("a pop-up that joins later starts without a change", () => {
    let seen = track(new Map(), new Map([[BOX, "Hall B"]]), 100n);
    seen = track(seen, new Map([[BOX, "Hall B"], [POPUP, "Hall B"]]), 101n);
    expect(seen.get(POPUP)).toEqual({ value: "Hall B", changedAt: null });
  });
});
