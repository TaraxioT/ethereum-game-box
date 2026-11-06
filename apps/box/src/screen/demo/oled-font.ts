// The tap station's pixel font and how a `StationView` lands on its 72×40 panel. Pure: glyphs are 5×7 bitmaps,
// trimmed to their inked columns so narrow marks (`.`, `:`, `!`, `1`) set close, and the layout returns the lit
// pixels for the panel to draw.
import type { StationView } from "@egb/sdk";
import { BIG_CHARS, SMALL_CHARS } from "@egb/sdk";

/** The station's SSD1306 0.42-inch panel. */
export const OLED_W = 72;
export const OLED_H = 40;

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

/**
 * The panel's zones: the tag in a lit badge at the top left, the big line under it, the small line (one or two rows)
 * at the foot.
 */
const TAG_PAD = 2;
const TAG_H = GLYPH_H + 2;
const BIG_TOP = TAG_H + 1;
const BIG_H = GLYPH_H * 2;
const SMALL_TOP = BIG_TOP + BIG_H + 1;
const SMALL_H = OLED_H - SMALL_TOP;

/** What a station shows: its idle screen, or one of the four a tap in progress brings up. */
export type Face = "idle" | "hold" | "sign" | "done" | "fail";

/** The station's own words for each tap face, when the Box gives none (firmware/tap-station/protocol.md). */
const DEFAULT_FACE: Readonly<Record<Exclude<Face, "idle">, string>> = {
  hold: "HOLD|reading",
  sign: "HOLD STILL|signing",
  done: "DONE",
  fail: "AGAIN|tap again",
};

/** A face's big and small lines: an override is `BIG|small`, cut as the station cuts it. */
export function faceLines(view: StationView, face: Face): { readonly big: string; readonly small: string } {
  if (face === "idle") return { big: view.big, small: view.small };
  const text = view[face] ?? DEFAULT_FACE[face];
  const bar = text.indexOf("|");
  const big = bar < 0 ? text : text.slice(0, bar);
  const small = bar < 0 ? "" : text.slice(bar + 1);
  return { big: big.slice(0, BIG_CHARS).toUpperCase(), small: small.slice(0, SMALL_CHARS) };
}

function centred(text: string, y: number, scale: number): Pixel[] {
  return drawText(text, Math.floor((OLED_W - textWidth(text, scale)) / 2), y, scale);
}

/** The big line: double size when it fits across the panel, else single, cut to the panel. */
export function bigLine(text: string): { readonly scale: number; readonly text: string } {
  if (textWidth(text, 2) <= OLED_W) return { scale: 2, text };
  return { scale: 1, text: fit(text, OLED_W) };
}

/** The small line, broken over at most two rows. */
export function smallLines(text: string): readonly string[] {
  return (wrap(text, OLED_W, 1, true) ?? []).slice(0, Math.floor((SMALL_H + 1) / (GLYPH_H + 1)));
}

/** The tag: dark letters cut out of a lit badge. */
function tagPixels(tag: string): Pixel[] {
  if (!tag) return [];
  const w = textWidth(tag) + TAG_PAD * 2;
  const ink = new Set(drawText(tag, TAG_PAD, 1).map(([x, y]) => y * OLED_W + x));
  const out: Pixel[] = [];
  for (let y = 0; y < TAG_H; y++) for (let x = 0; x < w; x++) if (!ink.has(y * OLED_W + x)) out.push([x, y]);
  return out;
}

/** Every lit pixel of a station's view, showing `face`. */
export function stationPixels(view: StationView, face: Face = "idle"): Pixel[] {
  const { big, small } = faceLines(view, face);
  const line = bigLine(big);
  const bigY = BIG_TOP + Math.floor((BIG_H - GLYPH_H * line.scale) / 2);
  const rows = smallLines(small);
  const blockH = rows.length * GLYPH_H + Math.max(0, rows.length - 1);
  const smallY = SMALL_TOP + Math.floor((SMALL_H - blockH) / 2);
  return [
    ...tagPixels(view.tag),
    ...centred(line.text, bigY, line.scale),
    ...rows.flatMap((row, i) => centred(row, smallY + i * (GLYPH_H + 1), 1)),
  ];
}
