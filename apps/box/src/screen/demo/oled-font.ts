// The tap station's pixel font and how a `StationView` lands on its 128×64 panel. Pure: glyphs are 5×7 bitmaps,
// trimmed to their inked columns so narrow marks (`.`, `:`, `!`, `1`) set close, and the layout returns the lit
// pixels for the panel to draw.
import type { StationView } from "../link/types.ts";

export const OLED_W = 128;
export const OLED_H = 64;
/** A two-tone panel: the top rows glow yellow, the rest blue-white. */
export const BAND_ROWS = 16;

const GLYPH_H = 7;
const SPACE_W = 3;

/**
 * 5×7 glyphs, one character per row read top to bottom, each a base-32 digit of the row's five bits (the high bit is
 * the left column). Lower case is drawn as upper case.
 */
const FONT: Readonly<Record<string, string>> = {
  0: "ehjlphe", 1: "4c4444e", 2: "eh1248v", 3: "v2421he", 4: "26aiv22",
  5: "vgu11he", 6: "68guhhe", 7: "v124888", 8: "ehhehhe", 9: "ehhf12c",
  A: "ehhhvhh", B: "uhhuhhu", C: "ehggghe", D: "sihhhis", E: "vgguggv", F: "vgguggg", G: "ehgnhhf",
  H: "hhhvhhh", I: "e44444e", J: "72222ic", K: "hikokih", L: "ggggggv", M: "hrllhhh", N: "hhpljhh",
  O: "ehhhhhe", P: "uhhuggg", Q: "ehhhlid", R: "uhhukih", S: "fgge11u", T: "v444444", U: "hhhhhhe",
  V: "hhhhha4", W: "hhhllla", X: "hha4ahh", Y: "hhha444", Z: "v1248gv",
  "!": "4444404", "?": "eh12404", ".": "00000cc", ":": "0cc0cc0", ";": "0cc0c48", ",": "0000c48",
  "-": "000v000", "+": "044v440", "×": "0ha4ah0", "=": "00v0v00", "/": "01248g0", "%": "op248j3",
  $: "4fke5u4", "#": "aavavaa", "'": "c480000", '"': "aaa0000", "(": "2488842", ")": "8422248",
  "<": "248g842", ">": "8421248", "*": "04lel40", "@": "eh1dlle", "&": "cik8lid", _: "000000v",
  "·": "0004000", "→": "042v240", "←": "048v840", "▲": "044eev0", "▼": "0vee440",
};

/** What a character without a glyph prints: a hollow box, so a gap in the font shows rather than hides. */
const MISSING = "vhhhhhv";

export interface Glyph {
  /** Inked columns. */
  readonly width: number;
  /** Seven rows; bit `width - 1 - x` of a row is column x. */
  readonly rows: readonly number[];
}

export type Pixel = readonly [x: number, y: number];

function decode(code: string): Glyph {
  const full = Array.from(code, (digit) => parseInt(digit, 32));
  const ink = full.reduce((all, row) => all | row, 0);
  let low = 0;
  while (!(ink & (1 << low))) low++;
  let high = 4;
  while (!(ink & (1 << high))) high--;
  return { width: high - low + 1, rows: full.map((row) => row >> low) };
}

const GLYPHS = new Map<string, Glyph>(Object.entries(FONT).map(([ch, code]) => [ch, decode(code)]));
const SPACE: Glyph = { width: SPACE_W, rows: [0, 0, 0, 0, 0, 0, 0] };
const BOX = decode(MISSING);

export function glyph(ch: string): Glyph {
  if (ch === " ") return SPACE;
  return GLYPHS.get(ch) ?? GLYPHS.get(ch.toUpperCase()) ?? BOX;
}

export function hasGlyph(ch: string): boolean {
  return ch === " " || GLYPHS.has(ch) || GLYPHS.has(ch.toUpperCase());
}

/** Width in panel pixels: glyphs one (scaled) pixel apart. */
export function textWidth(text: string, scale = 1): number {
  const chars = Array.from(text);
  if (chars.length === 0) return 0;
  const inked = chars.reduce((sum, ch) => sum + glyph(ch).width, 0);
  return (inked + chars.length - 1) * scale;
}

/** The lit pixels of one line set at (x, y), its top-left corner, clipped to the panel. */
export function drawText(text: string, x: number, y: number, scale = 1): Pixel[] {
  const out: Pixel[] = [];
  let pen = x;
  for (const ch of Array.from(text)) {
    const g = glyph(ch);
    g.rows.forEach((row, gy) => {
      for (let gx = 0; gx < g.width; gx++) {
        if (!(row & (1 << (g.width - 1 - gx)))) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = pen + gx * scale + sx;
            const py = y + gy * scale + sy;
            if (px >= 0 && px < OLED_W && py >= 0 && py < OLED_H) out.push([px, py]);
          }
        }
      }
    });
    pen += (g.width + 1) * scale;
  }
  return out;
}

/** The longest start of `text` that fits `width`. */
export function fit(text: string, width: number, scale = 1): string {
  const chars = Array.from(text);
  while (chars.length > 0 && textWidth(chars.join(""), scale) > width) chars.pop();
  return chars.join("");
}

/**
 * Breaks `text` into lines no wider than `width`, at spaces. With `breakWords`, a word too long for a line is cut
 * across lines; without, such a word makes the text unfit (null).
 */
export function wrap(text: string, width: number, scale: number, breakWords = false): string[] | null {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word;
    if (textWidth(joined, scale) <= width) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (textWidth(line, scale) > width) {
      if (!breakWords) return null;
      const head = fit(line, width, scale) || Array.from(line)[0] || "";
      lines.push(head);
      line = line.slice(head.length);
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The panel's three zones. */
const TOP_Y = 4;
const BIG_TOP = 17;
const BIG_H = 38;
const BOTTOM_Y = 57;

function centred(text: string, y: number, scale: number): Pixel[] {
  return drawText(text, Math.floor((OLED_W - textWidth(text, scale)) / 2), y, scale);
}

/** The big line: the largest scale (3, 2, then 1) at which it fits, on as many lines as the zone holds. */
export function bigLines(text: string): { readonly scale: number; readonly lines: readonly string[] } {
  for (const scale of [3, 2, 1]) {
    const gap = scale;
    const room = Math.floor((BIG_H + gap) / (GLYPH_H * scale + gap));
    const lines = wrap(text, OLED_W, scale);
    if (lines && lines.length <= room) return { scale, lines };
  }
  const room = Math.floor((BIG_H + 1) / (GLYPH_H + 1));
  return { scale: 1, lines: (wrap(text, OLED_W, 1, true) ?? []).slice(0, room) };
}

/** Every lit pixel of a station's view: the top line in the yellow band, the big line, the bottom line. */
export function stationPixels(view: StationView): Pixel[] {
  const { scale, lines } = bigLines(view.big);
  const lineH = GLYPH_H * scale;
  const blockH = lines.length * lineH + Math.max(0, lines.length - 1) * scale;
  const bigY = BIG_TOP + Math.floor((BIG_H - blockH) / 2);
  return [
    ...centred(fit(view.top, OLED_W), TOP_Y, 1),
    ...lines.flatMap((line, i) => centred(line, bigY + i * (lineH + scale), scale)),
    ...centred(fit(view.bottom, OLED_W), BOTTOM_Y, 1),
  ];
}
