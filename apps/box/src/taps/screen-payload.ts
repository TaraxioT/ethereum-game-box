// A StationView as a station's screen payload: `key=value` lines (firmware/tap-station/protocol.md, Screens), each
// value cut to what the station shows, at most 200 bytes in all.
import { BIG_CHARS, SMALL_CHARS, TAG_CHARS, type StationView } from "@egb/sdk";

/** The most payload bytes one `screen` carries. */
export const PAYLOAD_MAX = 200;
const OVERRIDES = ["hold", "sign", "done", "fail"] as const;
const NOT_PRINTABLE = /[^\x20-\x7e]/g;

/** Printable ASCII only (the station would show anything else as `?` anyway; a newline would break the format). */
const clip = (text: string, max: number): string => text.replace(NOT_PRINTABLE, "?").slice(0, max);

/** An override's `BIG|small`, each side cut to its line; the small side can't carry another `|`. */
function override(value: string): string {
  const bar = value.indexOf("|");
  if (bar < 0) return clip(value, BIG_CHARS);
  const small = clip(value.slice(bar + 1).replaceAll("|", "/"), SMALL_CHARS);
  return small ? `${clip(value.slice(0, bar), BIG_CHARS)}|${small}` : clip(value.slice(0, bar), BIG_CHARS);
}

/**
 * The payload for a view. `big` always goes (empty blanks the line; left out, the station would show `TAP`); `tag`
 * and `small` only when they have text; then `ttl` (seconds, 0 = none); then the overrides, each left out if it would
 * take the payload past 200 bytes.
 */
export function screenPayload(view: StationView, ttl: number): string {
  const lines: string[] = [];
  let size = -1;
  const add = (line: string): void => {
    if (size + 1 + line.length > PAYLOAD_MAX) return;
    lines.push(line);
    size += 1 + line.length;
  };
  const tag = clip(view.tag, TAG_CHARS);
  if (tag) add(`tag=${tag}`);
  add(`big=${clip(view.big, BIG_CHARS)}`);
  const small = clip(view.small, SMALL_CHARS);
  if (small) add(`small=${small}`);
  if (ttl > 0) add(`ttl=${Math.round(ttl)}`);
  for (const key of OVERRIDES) {
    const value = view[key];
    if (value) add(`${key}=${override(value)}`);
  }
  return lines.join("\n");
}
