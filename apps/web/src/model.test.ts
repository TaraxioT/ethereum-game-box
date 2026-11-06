// What a name is decides what its inspector shows: a game's registry holds its title and its championships.
import { describe, expect, it } from "vitest";

import { emptyDirectory } from "./directory.ts";
import { keysFor, kindOf } from "./model.ts";

describe("a name's kind", () => {
  it("tells a championship from the game's title, and tries every championship record", () => {
    const dir = emptyDirectory(1n);
    expect(kindOf(dir, "champion.stockduel.gamebox.eth")).toBe("title");
    expect(kindOf(dir, "mumbai-cup.stockduel.gamebox.eth")).toBe("cup");
    expect(keysFor("cup")).toEqual(["addr", "ends", "prize", "standings", "leader", "winner"]);
  });
});
