// @vitest-environment happy-dom
// Where the kiosk's frame meets the core: a store match gets the bundle's view, hears the core's finished taps, and every
// word its page may say comes out as a command the Box's link takes. server/store-match.test.ts plays this in a real
// browser.
import { describe, expect, it } from "vitest";
import type { BoxEvent, BoxState, FrameWord, Match, ScreenCommand, StorePlay } from "../../core/types.ts";
import { parseCommand } from "../../server/link.ts";
import type { ViewContext } from "../views/view.ts";
import { routes } from "../views/routes.ts";
import { storeMatch, storePowers } from "./bundle-feed.ts";

const BUNDLE = `0x${"ab".repeat(32)}` as const;

const play: StorePlay = { game: "store", id: "tap-rush", title: "Tap Rush", bundle: BUNDLE, taps: "identify", endsAt: 0, lines: ["PLAY", "PLAY"], judged: null, resultAt: null };

const seat = (name: string | null) => ({ badge: name ? { address: `0x${"a1".repeat(20)}`, name: `${name}.gamebox.eth` } : null, ens: null });

function stateOf(matchPlay: Match["play"] | null): BoxState {
  const match = matchPlay && ({ id: 7, play: matchPlay } as Match);
  return { phase: "playing", match, seats: [seat("nova"), seat("kite")] } as unknown as BoxState;
}

describe("a store match on the kiosk", () => {
  it("is the frame's, under its own key, and a built match keeps its own view", () => {
    const store = routes(stateOf(play));
    const built = routes(stateOf({ game: "built", id: "tap-three", state: null, stations: [{}, {}] } as unknown as Match["play"]));
    expect(store).toMatchObject({ key: "play-7", pose: "game" });
    expect(store.view).toBeTypeOf("function");
    expect(store.view).not.toBe(built.view);
  });

  it("names the bundle, the title and the players in seat order, and nothing else plays", () => {
    expect(storeMatch.match(stateOf(play))).toEqual({ hash: BUNDLE, title: "Tap Rush", players: [{ name: "NOVA" }, { name: "KITE" }] });
    expect(storeMatch.match(stateOf(null))).toBeNull();
    expect(storeMatch.match(stateOf({ game: "built", id: "x", state: null, stations: [{}, {}] } as unknown as Match["play"]))).toBeNull();
  });

  it("hears a finished tap and no other moment", () => {
    expect(storeMatch.tap({ type: "game-tap", seat: 1, at: 1234, roll: 77 })).toEqual({ seat: 1, at: 1234, roll: 77 });
    const others: BoxEvent[] = [{ type: "init" }, { type: "touch", seat: 0 }, { type: "tap", seat: 0, accepted: true, meaning: "play" }, { type: "game" }];
    expect(others.map((event) => storeMatch.tap(event))).toEqual([null, null, null, null]);
  });

  it("sends each of a page's words as a command the Box's link takes unchanged", () => {
    const sent: ScreenCommand[] = [];
    const powers = storePowers({ link: { send: (command: ScreenCommand) => sent.push(command) } } as unknown as ViewContext);
    powers.event("score", { counts: [3, 1] });
    powers.station(1, "GO");
    powers.buzz(0);
    powers.end("game");
    powers.end("lost");

    const words: FrameWord[] = [
      { t: "event", name: "score", data: { counts: [3, 1] } },
      { t: "station", seat: 1, text: "GO" },
      { t: "buzz", seat: 0 },
      { t: "end", why: "game" },
      { t: "end", why: "lost" },
    ];
    expect(sent).toEqual(words.map((word) => ({ type: "frame", word })));
    expect(sent.map((command) => parseCommand(JSON.stringify({ t: "command", command })))).toEqual(sent);
  });
});
