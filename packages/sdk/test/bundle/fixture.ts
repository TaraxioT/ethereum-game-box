// A small good bundle, shared by the bundle tests: one of each kind of file.
import type { Raw } from "./raw-zip.ts";

export const text = (s: string): Uint8Array => new TextEncoder().encode(s);

export const MANIFEST = {
  format: 1,
  id: "test-game",
  title: "Test Game",
  blurb: "A game for tests.",
  players: { min: 2, max: 4 },
  minutes: 1,
  stakes: [5, 10, 25],
  taps: "identify",
  verifier: { instructions: "The seat with the most taps wins the whole pot." },
};

export const manifestBytes = (over: object = {}): Uint8Array => text(JSON.stringify({ ...MANIFEST, ...over }, null, 2));

/** Eight bytes that aren't text. */
const PIXELS = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const goodFiles = (): Map<string, Uint8Array> =>
  new Map([
    ["assets/dot.png", PIXELS],
    ["game.js", text("window.egb.onTap(() => window.egb.end());\n".repeat(4))],
    ["index.html", text('<!doctype html>\n<title>Test Game</title>\n<script src="game.js"></script>\n')],
    ["manifest.json", manifestBytes()],
    ["style.css", text("body { margin: 0; }\n")],
  ]);

/** The good bundle's entries, in the packer's order, for `rawZip`. */
export const goodEntries = (): Raw[] => [...goodFiles()].map(([name, body]) => ({ name, body }));
