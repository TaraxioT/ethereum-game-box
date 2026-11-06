// The downloader against a stand-in store, with real bundles from the one packer: a good zip lands in its own temporary
// folder and goes when it is dropped, and every way a download can go wrong seals the game with nothing left on disk.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUNDLE_LIMITS, packBundle, readBundle } from "@egb/sdk/bundle";
import { describe, expect, it, vi } from "vitest";
import { createBundles, type BundlesOptions } from "./bundles.ts";

const manifest = (over: Record<string, unknown> = {}) => ({
  format: 1,
  id: "tap-rush",
  title: "Tap Rush",
  blurb: "Most taps wins.",
  players: { min: 2, max: 4 },
  minutes: 1,
  stakes: [5, 10],
  taps: "random",
  verifier: { instructions: "Most taps wins." },
  ...over,
});

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function zipOf(over: Record<string, unknown> = {}): Uint8Array {
  return packBundle(
    new Map([
      ["index.html", bytes("<!doctype html><title>Tap Rush</title>")],
      ["manifest.json", bytes(JSON.stringify(manifest(over)))],
      ["art/ring.svg", bytes("<svg></svg>")],
    ]),
  );
}

async function hashOf(zip: Uint8Array): Promise<`0x${string}`> {
  return (await readBundle(zip)).hash;
}

function rig(answer: (url: string, init: RequestInit | undefined) => Promise<Response>, more: Pick<BundlesOptions, "seats" | "listed"> = {}) {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "egb-bundles-")), "store-bundles");
  const seals: [string, string, boolean][] = [];
  const asked: string[] = [];
  const bundles = createBundles({
    url: "https://store.example",
    dir,
    log: () => {},
    seal: (id, reason, passing) => void seals.push([id, reason, passing]),
    ...more,
    fetcher: (url, init) => {
      asked.push(String(url));
      return answer(String(url), init);
    },
  });
  const left = (): string[] => (existsSync(dir) ? readdirSync(dir) : []);
  return { dir, bundles, seals, asked, left };
}

const serving = (zip: Uint8Array) => async () => new Response(new Uint8Array(zip));
const settled = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

describe("the downloader", () => {
  it("fetches by hash, and writes a checked bundle to a temporary folder for the frame", async () => {
    const zip = zipOf();
    const hash = await hashOf(zip);
    const r = rig(serving(zip));
    expect(r.bundles.held(hash)).toBeNull();
    expect(await r.bundles.fetch("tap-rush", hash)).toEqual({ minutes: 1, taps: "random" });
    expect(r.asked).toEqual([`https://store.example/bundles/${hash}.zip`]);
    const held = r.bundles.held(hash);
    expect(path.dirname(held?.dir ?? "")).toBe(r.dir);
    expect([...(held?.files ?? [])].sort()).toEqual(["art/ring.svg", "index.html", "manifest.json"]);
    expect(readFileSync(path.join(held?.dir ?? "", "index.html"), "utf8")).toContain("Tap Rush");
    expect(readFileSync(path.join(held?.dir ?? "", "art/ring.svg"), "utf8")).toBe("<svg></svg>");
    expect(r.seals).toEqual([]);
  });

  it("deletes the folder when the bundle is dropped, and fetches again for the next match", async () => {
    const zip = zipOf();
    const hash = await hashOf(zip);
    const r = rig(serving(zip));
    await r.bundles.fetch("tap-rush", hash);
    const first = r.bundles.held(hash)?.dir;
    r.bundles.drop();
    expect(r.bundles.held(hash)).toBeNull();
    await vi.waitFor(() => expect(r.left()).toEqual([]));
    await r.bundles.fetch("tap-rush", hash);
    expect(r.asked).toHaveLength(2);
    expect(r.bundles.held(hash)?.dir).not.toBe(first);
    expect(r.left()).toHaveLength(1);
  });

  it("keeps one bundle at a time", async () => {
    const one = zipOf();
    const two = zipOf({ id: "tap-rush-2" });
    const [first, second] = [await hashOf(one), await hashOf(two)];
    const r = rig(async (url) => new Response(new Uint8Array(url.includes(first) ? one : two)));
    await r.bundles.fetch("tap-rush", first);
    await r.bundles.fetch("tap-rush-2", second);
    expect(r.bundles.held(first)).toBeNull();
    await vi.waitFor(() => expect(r.left()).toEqual([path.basename(r.bundles.held(second)?.dir ?? "")]));
  });

  it("seals the game for good on a zip that fails its checks, with nothing on disk", async () => {
    const zip = zipOf();
    const hash = await hashOf(zip);
    const changed = new Uint8Array(zip);
    changed[40] = (changed[40] as number) ^ 1;
    const other = zipOf({ title: "Another" });
    const renamed = zipOf({ id: "another-game" });
    const big = zipOf({ players: { min: 3, max: 4 } });
    const cases: [Uint8Array, RegExp][] = [
      [changed, /./],
      [new TextEncoder().encode("not a zip"), /zip/],
      [other, /isn't the one listed/],
    ];
    for (const [served, reason] of cases) {
      const r = rig(serving(served));
      await expect(r.bundles.fetch("tap-rush", hash)).rejects.toThrow(reason);
      await settled();
      expect(r.seals).toHaveLength(1);
      expect(r.seals[0]?.[0]).toBe("tap-rush");
      expect(r.seals[0]?.[1]).toMatch(/^its bundle failed: /);
      expect(r.seals[0]?.[2]).toBe(false);
      expect(r.bundles.held(hash)).toBeNull();
      expect(r.left()).toEqual([]);
    }

    const wrongId = rig(serving(renamed));
    await expect(wrongId.bundles.fetch("tap-rush", await hashOf(renamed))).rejects.toThrow(/names another game/);
    const tooMany = rig(serving(big));
    await expect(tooMany.bundles.fetch("tap-rush", await hashOf(big))).rejects.toThrow(/needs 3 players/);
    expect(tooMany.seals[0]?.[2]).toBe(false);
  });

  it("takes a game for as many as the Box's stations, and refuses a zip that seats other numbers than the store lists", async () => {
    const big = zipOf({ players: { min: 3, max: 4 } });
    const hash = await hashOf(big);
    expect(await rig(serving(big), { seats: 3 }).bundles.fetch("tap-rush", hash)).toEqual({ minutes: 1, taps: "random" });
    const listed = { min: 3, max: 4 };
    expect(await rig(serving(big), { seats: 4, listed: () => listed }).bundles.fetch("tap-rush", hash)).toEqual({ minutes: 1, taps: "random" });
    const wrong = rig(serving(big), { seats: 4, listed: () => ({ min: 2, max: 4 }) });
    await expect(wrong.bundles.fetch("tap-rush", hash)).rejects.toThrow(/other numbers than the store lists/);
    expect(wrong.seals[0]?.[2]).toBe(false);
  });

  it("stops reading a zip past the format's limit", async () => {
    let sent = 0;
    const r = rig(async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 1024 * 1024;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
      });
      return new Response(body);
    });
    await expect(r.bundles.fetch("tap-rush", `0x${"ab".repeat(32)}`)).rejects.toThrow(/is over/);
    expect(sent).toBeLessThan(BUNDLE_LIMITS.zipBytes + 4 * 1024 * 1024);
    expect(r.seals[0]?.[2]).toBe(false);
  });

  it("seals only until the next scan when the zip never arrived", async () => {
    const hash = `0x${"ab".repeat(32)}` as const;
    const down = rig(() => Promise.reject(new Error("no route to host")));
    await expect(down.bundles.fetch("tap-rush", hash)).rejects.toThrow("no route to host");
    expect(down.seals).toEqual([["tap-rush", "its bundle failed: no route to host", true]]);
    const missing = rig(async () => new Response("gone", { status: 404 }));
    await expect(missing.bundles.fetch("tap-rush", hash)).rejects.toThrow("the store answered 404");
    expect(missing.seals[0]?.[2]).toBe(true);
  });

  it("stops a download that is dropped, and blames nobody", async () => {
    const hash = `0x${"ab".repeat(32)}` as const;
    let stopped = false;
    const r = rig(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            stopped = true;
            reject(new Error("aborted"));
          });
        }),
    );
    const fetching = r.bundles.fetch("tap-rush", hash);
    await settled();
    r.bundles.drop();
    await expect(fetching).rejects.toThrow("aborted");
    expect(stopped).toBe(true);
    expect(r.seals).toEqual([]);
  });

  it("throws away a bundle dropped while it was being checked", async () => {
    const zip = zipOf();
    const hash = await hashOf(zip);
    const r = rig(serving(zip));
    const fetching = r.bundles.fetch("tap-rush", hash);
    await new Promise<void>((resolve) => setImmediate(resolve));
    r.bundles.drop();
    await expect(fetching).rejects.toThrow();
    expect(r.seals).toEqual([]);
    await vi.waitFor(() => expect(r.left()).toEqual([]));
  });

  it("clears what a power cut left behind", async () => {
    const r = rig(serving(zipOf()));
    await r.bundles.clear();
    mkdirSync(path.join(r.dir, "abc-1"), { recursive: true });
    writeFileSync(path.join(r.dir, "abc-1", "index.html"), "old");
    await r.bundles.clear();
    expect(r.left()).toEqual([]);
  });
});
