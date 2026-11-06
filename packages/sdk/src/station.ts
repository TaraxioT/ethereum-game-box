// What a tap station's OLED can show: the station's own screen model (firmware/tap-station/protocol.md, Screens).

/** Most characters each line holds; longer text is cut. Ten big characters and about twenty small ones fit the OLED at
 *  once; a longer line scrolls across it (an ENS name). */
export const TAG_CHARS = 3;
export const BIG_CHARS = 32;
export const SMALL_CHARS = 40;
/** An override (`hold`, `sign`, `done`, `fail`) is `BIG|small`: both lines and the bar between them. */
export const OVERRIDE_CHARS = BIG_CHARS + 1 + SMALL_CHARS;

/** What a tap means now, which the station shows on its LED and decides itself: `open` (taps welcome outside a game:
 *  cyan breathing), `play` (a game waits for this tap: green breathing), `shut` (not welcome: dim amber, and a tap gets
 *  NOT NOW on the station at once). */
export type StationMode = "open" | "play" | "shut";

export interface StationView {
  /** Up to 3 characters in the top-left badge (`P1`); empty: none. */
  readonly tag: string;
  /** The idle big line, up to 32 characters, upper case (`TAP`, `WAIT`, `WIN`); over 10 it scrolls. */
  readonly big: string;
  /** The idle small line, up to 40 characters (a name, `10 EGB`); one too wide for the OLED scrolls. */
  readonly small: string;
  /** `BIG|small` while the chip is held and the Box reads it. Absent: the station's `HOLD|reading`. */
  readonly hold?: string;
  /** The same while the chip signs. Absent: `HOLD STILL|signing`. */
  readonly sign?: string;
  /** Read done, or signature back. Absent: `DONE`. */
  readonly done?: string;
  /** Sign failed or lifted mid-sign. Absent: `AGAIN|tap again`. */
  readonly fail?: string;
  /** A tap while `mode` is `shut`. Absent: `NOT NOW|not your turn`. */
  readonly nope?: string;
  /** What a tap means now (the LED, and whether the station refuses a tap itself). Absent: the LED stays off. */
  readonly mode?: StationMode;
}

const UNPRINTABLE = /[^\x20-\x7e]/g;

/**
 * `text` as the station's font can draw it: printable ASCII (anything else becomes `?`), at most `max` characters. It cuts
 * first: each UTF-16 unit is replaced one for one, so the answer is the same, and the cost is `max`, whatever `text` is.
 */
export function printable(text: string, max: number): string {
  return text.slice(0, max).replace(UNPRINTABLE, "?");
}

/** A view cut to what the station can show: printable ASCII, each line at its length, `big` upper-cased. */
export function stationView(tag: string, big: string, small: string, extra: Partial<StationView> = {}): StationView {
  return { ...extra, tag: printable(tag, TAG_CHARS), big: printable(big, BIG_CHARS).toUpperCase(), small: printable(small, SMALL_CHARS) };
}
