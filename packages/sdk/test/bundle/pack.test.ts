import { createHash } from "node:crypto";
import { crc32 as nodeCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BUNDLE_LIMITS, BundleRefused, packBundle, readBundle } from "../../src/bundle/index.ts";
import { crc32 } from "../../src/bundle/pack.ts";
import { goodFiles, manifestBytes, text } from "./fixture.ts";

const sha256 = (bytes: Uint8Array) => `0x${createHash("sha256").update(bytes).digest("hex")}`;

describe("packBundle", () => {
  it("packs twice to the same bytes and hash", async () => {
    const first = packBundle(goodFiles());
    const second = packBundle(goodFiles());
    expect(second).toEqual(first);
    expect((await readBundle(second)).hash).toBe((await readBundle(first)).hash);
  });

  it("doesn't care what order a folder is walked in", () => {
    expect(packBundle(new Map([...goodFiles()].reverse()))).toEqual(packBundle(goodFiles()));
  });

  it("writes the bytes it always has: a change here changes every game's identity", () => {
    expect(sha256(packBundle(goodFiles()))).toBe("0x8c219265e532d5d8311de432c7f173d5facd1322ba1af0c20515146b6e1d746b");
  });

  it("comes back whole through the reader", async () => {
    const zip = packBundle(goodFiles());
    const opened = await readBundle(zip);
    expect(opened.files).toEqual(goodFiles());
    expect(opened.manifest).toEqual(JSON.parse(new TextDecoder().decode(goodFiles().get("manifest.json"))));
    expect(opened.hash).toBe(sha256(zip));
  });

  it("gives a changed file a new hash", async () => {
    const changed = goodFiles().set("style.css", text("body { margin: 1px; }\n"));
    expect((await readBundle(packBundle(changed))).hash).not.toBe((await readBundle(packBundle(goodFiles()))).hash);
  });

  it("takes a Node Buffer as readily as a Uint8Array", async () => {
    const zip = packBundle(goodFiles());
    expect((await readBundle(Buffer.from(zip))).hash).toBe(sha256(zip));
  });

  it("deflates text and stores what is compressed already", () => {
    const body = Uint8Array.from({ length: 2000 }, () => 7);
    const zip = (name: string) => packBundle(goodFiles().set(name, body)).length;
    expect(zip("extra.mp3") - zip("extra.js")).toBeGreaterThan(1900);
  });

  it("keeps the packed manifest's text, layout included", async () => {
    const manifest = text(`{"format":1,"id":"a","title":"A","blurb":"B",\n"players":{ "min": 2, "max": 2 },"minutes":1,"stakes":[1],"taps":"random","verifier":{"instructions":"say \\"hi\\"\\n"}}\n`);
    const opened = await readBundle(packBundle(goodFiles().set("manifest.json", manifest)));
    expect(opened.files.get("manifest.json")).toEqual(manifest);
    expect(opened.manifest.verifier.instructions).toBe('say "hi"\n');
  });

  it("packs an empty asset", async () => {
    const opened = await readBundle(packBundle(goodFiles().set("empty.js", new Uint8Array(0)).set("empty.mp3", new Uint8Array(0))));
    expect(opened.files.get("empty.js")).toEqual(new Uint8Array(0));
    expect(opened.files.get("empty.mp3")).toEqual(new Uint8Array(0));
  });

  it("takes exactly as many files as the limit", async () => {
    const files = goodFiles();
    for (let i = files.size; i < BUNDLE_LIMITS.files; i++) files.set(`f${i}.js`, text("x"));
    expect((await readBundle(packBundle(files))).files.size).toBe(BUNDLE_LIMITS.files);
  });

  it("takes a zip of exactly the limit, and refuses a byte more", async () => {
    const overhead = packBundle(goodFiles().set("big.mp3", new Uint8Array(0))).length;
    const fits = goodFiles().set("big.mp3", new Uint8Array(BUNDLE_LIMITS.zipBytes - overhead));
    const zip = packBundle(fits);
    expect(zip.length).toBe(BUNDLE_LIMITS.zipBytes);
    expect((await readBundle(zip)).files.size).toBe(fits.size);
    expect(() => packBundle(goodFiles().set("big.mp3", new Uint8Array(BUNDLE_LIMITS.zipBytes - overhead + 1)))).toThrow(/the zip is/);
  });

  it("takes files that inflate to exactly the limit, and refuses a byte more", async () => {
    const used = [...goodFiles().values()].reduce((sum, body) => sum + body.length, 0);
    const fits = goodFiles().set("big.js", new Uint8Array(BUNDLE_LIMITS.totalBytes - used));
    expect((await readBundle(packBundle(fits))).files.size).toBe(fits.size);
    expect(() => packBundle(goodFiles().set("big.js", new Uint8Array(BUNDLE_LIMITS.totalBytes - used + 1)))).toThrow(/at most 33554432/);
  });

  it.each<[string, Map<string, Uint8Array>, RegExp]>([
    ["no page", (() => { const f = goodFiles(); f.delete("index.html"); return f; })(), /no index.html/],
    ["no manifest", (() => { const f = goodFiles(); f.delete("manifest.json"); return f; })(), /no manifest.json/],
    ["a stray .DS_Store", goodFiles().set(".DS_Store", text("x")), /isn't a name/],
    ["a bad manifest", goodFiles().set("manifest.json", manifestBytes({ players: { min: 1, max: 4 } })), /players must be/],
    ["too many files", new Map([...goodFiles(), ...Array.from({ length: 60 }, (_, i): [string, Uint8Array] => [`f${i}.js`, text("x")])]), /65 files/],
    ["too much in all", goodFiles().set("big.js", new Uint8Array(BUNDLE_LIMITS.totalBytes + 1)), /at most 33554432/],
    ["a zip over its limit", goodFiles().set("big.mp3", new Uint8Array(BUNDLE_LIMITS.zipBytes)), /the zip is/],
  ])("refuses %s", (_, files, why) => {
    expect(() => packBundle(files)).toThrow(BundleRefused);
    expect(() => packBundle(files)).toThrow(why);
  });
});

describe("crc32", () => {
  it("matches the standard's check value and zlib", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    const body = text("Tap Rush".repeat(100));
    expect(crc32(body)).toBe(nodeCrc32(body));
  });
});
