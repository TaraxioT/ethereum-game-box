// What a tap station's OLED can show: the station's own screen model (firmware/tap-station/protocol.md, Screens).

/** Most characters each line holds; longer text is cut. */
export const TAG_CHARS = 3;
export const BIG_CHARS = 10;
export const SMALL_CHARS = 20;
/** An override (`hold`, `sign`, `done`, `fail`) is `BIG|small`: both lines and the bar between them. */
export const OVERRIDE_CHARS = BIG_CHARS + 1 + SMALL_CHARS;

export interface StationView {
  /** Up to 3 characters in the top-left badge (`P1`); empty: none. */
  readonly tag: string;
  /** The idle big line, up to 10 characters, upper case (`TAP`, `WAIT`, `WIN`). */
  readonly big: string;
  /** The idle small line, up to 20 characters (a name, `10 EGB`). */
  readonly small: string;
  /** `BIG|small` while the chip is held and the Box reads it. Absent: the station's `HOLD|reading`. */
  readonly hold?: string;
  /** The same while the chip signs. Absent: `HOLD STILL|signing`. */
  readonly sign?: string;
  /** Read done, or signature back. Absent: `DONE`. */
  readonly done?: string;
  /** Sign failed or lifted mid-sign. Absent: `AGAIN|tap again`. */
  readonly fail?: string;
}

const UNPRINTABLE = /[^\x20-\x7e]/g;

/** `text` as the station's font can draw it: printable ASCII (anything else becomes `?`), at most `max` characters. */
export function printable(text: string, max: number): string {
  return text.replace(UNPRINTABLE, "?").slice(0, max);
}

/** A view cut to what the station can show: printable ASCII, each line at its length, `big` upper-cased. */
export function stationView(tag: string, big: string, small: string, extra: Partial<StationView> = {}): StationView {
  return { ...extra, tag: printable(tag, TAG_CHARS), big: printable(big, BIG_CHARS).toUpperCase(), small: printable(small, SMALL_CHARS) };
}
