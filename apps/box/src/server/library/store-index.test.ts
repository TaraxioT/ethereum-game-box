// The store's index as the Box reads it: good listings kept and bad ones left out on their own, and an index that can't
// be read holding nothing until it is back.
import { describe, expect, it } from "vitest";
import { createStoreIndex, parseIndex } from "./store-index.ts";

const LISTING = {
  id: "tap-rush",
  title: "Tap Rush",
  blurb: "Most taps in ten seconds takes the pot.",
  players: { min: 2, max: 4 },
  stakes: [5, 10, 25],
  icon: null,
  hash: `0x${"ab".repeat(32)}`,
  size: 2048,
};
const KEPT = { id: "tap-rush", title: "Tap Rush", players: { min: 2, max: 4 }, stakes: [5, 10, 25], hash: LISTING.hash };

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe("the store's index", () => {
  it("keeps what the rack needs from each good listing", () => {
    expect(parseIndex({ listings: [LISTING] })).toEqual([KEPT]);
    expect(parseIndex({ listings: [] })).toEqual([]);
  });

  it("isn't an index without its list", () => {
    for (const bad of [null, "index", [LISTING], {}, { listings: "many" }]) expect(parseIndex(bad)).toBeNull();
  });

  it("leaves out a bad listing and keeps the rest, the first of an id that comes twice", () => {
    const bad = [
      null,
      "game",
      { ...LISTING, id: "Tap Rush" },
      { ...LISTING, id: "" },
      { ...LISTING, title: "" },
      { ...LISTING, title: "t".repeat(25) },
      { ...LISTING, players: { min: 1, max: 4 } },
      { ...LISTING, players: { min: 3, max: 2 } },
      { ...LISTING, players: { min: 2, max: 5 } },
      { ...LISTING, players: 2 },
      { ...LISTING, stakes: [] },
      { ...LISTING, stakes: [10, 5] },
      { ...LISTING, stakes: "5" },
      { ...LISTING, hash: "0x12" },
      { ...LISTING, hash: `0x${"AB".repeat(32)}` },
      { ...LISTING, hash: "ab".repeat(32) },
    ];
    expect(parseIndex({ listings: [...bad, LISTING, { ...LISTING, title: "Second" }] })).toEqual([KEPT]);
  });

  it("is read from the store, and holds nothing while it can't be, said once", async () => {
    const logs: string[] = [];
    const answers: (Response | Error)[] = [json({ listings: [LISTING] }), new Error("unreachable"), json({ error: "boom" }, 500), new Response("not json"), json({ listings: [LISTING] })];
    const asked: string[] = [];
    const index = createStoreIndex({
      url: "https://store.example",
      log: (text) => logs.push(text),
      async fetcher(url) {
        asked.push(String(url));
        const answer = answers.shift() as Response | Error;
        if (answer instanceof Error) throw answer;
        return answer;
      },
    });
    expect(index.listings()).toEqual([]);
    await index.refresh();
    expect(index.listings()).toEqual([KEPT]);
    expect(asked).toEqual(["https://store.example/index.json"]);
    await index.refresh();
    expect(index.listings()).toEqual([]);
    await index.refresh();
    await index.refresh();
    expect(index.listings()).toEqual([]);
    expect(logs).toEqual(["store: no index, so no store games: unreachable"]);
    await index.refresh();
    expect(index.listings()).toEqual([KEPT]);
    expect(logs.at(-1)).toBe("store: the index is back");
  });

  it("stops reading an index too big to be one", async () => {
    const logs: string[] = [];
    const huge = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024));
      },
    });
    const index = createStoreIndex({ url: "https://store.example", log: (text) => logs.push(text), fetcher: async () => new Response(huge) });
    await index.refresh();
    expect(index.listings()).toEqual([]);
    expect(logs[0]).toMatch(/is over 1048576 B/);
  });
});
