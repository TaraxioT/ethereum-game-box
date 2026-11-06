import { describe, expect, it } from "vitest";
import { BUNDLE_LIMITS, bundleManifestProblems, nameProblem } from "../../src/bundle/index.ts";
import { MANIFEST } from "./fixture.ts";

const problemsWith = (over: object) => bundleManifestProblems({ ...MANIFEST, ...over });
const without = (key: keyof typeof MANIFEST) => Object.fromEntries(Object.entries(MANIFEST).filter(([k]) => k !== key));

describe("bundleManifestProblems", () => {
  it("takes the plan's manifest", () => {
    expect(bundleManifestProblems(MANIFEST)).toEqual([]);
  });

  it("takes players from 2 to 4 and one to four stakes", () => {
    expect(problemsWith({ players: { min: 2, max: 2 } })).toEqual([]);
    expect(problemsWith({ players: { min: 3, max: 4 } })).toEqual([]);
    expect(problemsWith({ players: { min: 4, max: 4 } })).toEqual([]);
    expect(problemsWith({ stakes: [1] })).toEqual([]);
    expect(problemsWith({ stakes: [1, 2, 3, 4] })).toEqual([]);
  });

  it("takes instructions of exactly 16 KB", () => {
    expect(problemsWith({ verifier: { instructions: "x".repeat(BUNDLE_LIMITS.instructionsBytes) } })).toEqual([]);
  });

  it.each<[string, unknown, RegExp]>([
    ["null", null, /not an object/],
    ["a list", [], /not an object/],
    ["a string", "tap-rush", /not an object/],
    ["no format", without("format"), /format must be 1/],
    ["another format", { ...MANIFEST, format: 2 }, /format must be 1/],
    ["a string format", { ...MANIFEST, format: "1" }, /format must be 1/],
    ["no id", without("id"), /id must be/],
    ["an id in capitals", { ...MANIFEST, id: "Tap-Rush" }, /id must be lower-case/],
    ["a path as an id", { ...MANIFEST, id: "../tap" }, /id must be lower-case/],
    ["an id over 40", { ...MANIFEST, id: "a".repeat(41) }, /id is longer/],
    ["no title", without("title"), /title must be/],
    ["a blank title", { ...MANIFEST, title: "   " }, /title must be/],
    ["a title over 24", { ...MANIFEST, title: "a".repeat(25) }, /title is longer/],
    ["no blurb", without("blurb"), /blurb must be/],
    ["a blurb over 120", { ...MANIFEST, blurb: "a".repeat(121) }, /blurb is longer/],
    ["no players", without("players"), /players must be \{ min, max \}/],
    ["a number of players", { ...MANIFEST, players: 2 }, /players must be \{ min, max \}/],
    ["a stray players key", { ...MANIFEST, players: { min: 2, max: 4, teams: 2 } }, /players must be \{ min, max \}/],
    ["one player", { ...MANIFEST, players: { min: 1, max: 4 } }, /players must be 2–4/],
    ["five players", { ...MANIFEST, players: { min: 2, max: 5 } }, /players must be 2–4/],
    ["min over max", { ...MANIFEST, players: { min: 4, max: 3 } }, /players must be 2–4/],
    ["half a player", { ...MANIFEST, players: { min: 2.5, max: 4 } }, /players must be whole/],
    ["string players", { ...MANIFEST, players: { min: "2", max: 4 } }, /players must be whole/],
    ["no minutes", without("minutes"), /minutes must be/],
    ["no time at all", { ...MANIFEST, minutes: 0 }, /minutes must be/],
    ["an hour", { ...MANIFEST, minutes: 31 }, /minutes must be/],
    ["no stakes", without("stakes"), /stakes must list/],
    ["an empty stake list", { ...MANIFEST, stakes: [] }, /stakes must list/],
    ["five stakes", { ...MANIFEST, stakes: [1, 2, 3, 4, 5] }, /stakes must list/],
    ["stakes out of order", { ...MANIFEST, stakes: [10, 5] }, /whole USDC, ascending/],
    ["a repeated stake", { ...MANIFEST, stakes: [5, 5] }, /whole USDC, ascending/],
    ["a stake of nothing", { ...MANIFEST, stakes: [0, 5] }, /whole USDC, ascending/],
    ["a negative stake", { ...MANIFEST, stakes: [-5] }, /whole USDC, ascending/],
    ["half a USDC", { ...MANIFEST, stakes: [1.5] }, /whole USDC, ascending/],
    ["a stake past safe integers", { ...MANIFEST, stakes: [2 ** 53] }, /whole USDC, ascending/],
    ["a string stake", { ...MANIFEST, stakes: ["5"] }, /whole USDC, ascending/],
    ["no taps", without("taps"), /taps must be/],
    ["unknown taps", { ...MANIFEST, taps: "swipe" }, /taps must be/],
    ["no verifier", without("verifier"), /verifier must be/],
    ["a string verifier", { ...MANIFEST, verifier: "pay seat 0" }, /verifier must be/],
    ["a stray verifier key", { ...MANIFEST, verifier: { instructions: "x", model: "y" } }, /verifier must be/],
    ["no instructions", { ...MANIFEST, verifier: {} }, /instructions must be/],
    ["blank instructions", { ...MANIFEST, verifier: { instructions: " \n " } }, /instructions must be/],
    ["instructions over 16 KB", { ...MANIFEST, verifier: { instructions: "x".repeat(BUNDLE_LIMITS.instructionsBytes + 1) } }, /instructions is over/],
    ["instructions over 16 KB in bytes, not letters", { ...MANIFEST, verifier: { instructions: "é".repeat(BUNDLE_LIMITS.instructionsBytes / 2 + 1) } }, /instructions is over/],
    ["an unknown field", { ...MANIFEST, onChain: true }, /isn't a field/],
    ["a tier of its own", { ...MANIFEST, tier: "verified" }, /isn't a field/],
    ["a __proto__ key", JSON.parse(`{"__proto__":1,${JSON.stringify(MANIFEST).slice(1)}`), /isn't a field/],
  ])("refuses %s", (_, value, why) => {
    expect(bundleManifestProblems(value).join("\n")).toMatch(why);
  });
});

describe("nameProblem", () => {
  it.each([
    "index.html",
    "manifest.json",
    "game.js",
    "game.min.js",
    "style.css",
    "assets/logo.png",
    "assets/photo.jpg",
    "assets/photo.webp",
    "assets/icon.svg",
    "assets/fonts/grid-mono.woff2",
    "assets/sounds/tap_01.mp3",
    "pages/help.html",
    `${"a".repeat(BUNDLE_LIMITS.nameBytes - 3)}.js`,
  ])("takes %s", (name) => {
    expect(nameProblem(name)).toBeNull();
  });

  it.each([
    "",
    ".",
    "..",
    "/",
    "/index.html",
    "./index.html",
    "../index.html",
    "assets/../index.html",
    "assets//logo.png",
    "assets/",
    "assets",
    "assets\\logo.png",
    "c:\\index.html",
    "c:/index.html",
    "Index.html",
    "assets/Logo.png",
    "logo.PNG",
    "logo.jpeg",
    "logo.gif",
    "game.ts",
    "game.mjs",
    "game.wasm",
    "data.json",
    "assets/manifest.json",
    "game.js.map",
    "notes.md",
    ".env",
    ".well-known/a.js",
    "-rf.js",
    "a..b.js",
    "a b.js",
    "a\0.js",
    "a\n.js",
    "é.js",
    "game.js/evil.js",
    "__proto__",
    `${"a".repeat(BUNDLE_LIMITS.nameBytes - 2)}.js`,
  ])("refuses %j", (name) => {
    expect(nameProblem(name)).toEqual(expect.any(String));
  });
});
