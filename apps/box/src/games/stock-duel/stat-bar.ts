// A stat as a progress bar: its name, its number, and a bar filled by where the number ranks in the deck, red for
// the deck's weakest through amber to green for its strongest. Higher wins on every stat, so a fuller bar is a
// stronger card on that stat. The hand cards show the bars alone; the played cards' faces show the numbers too.
import type { StatKey, Stock } from "./types.ts";
import { el } from "../../screen/shell/dom.ts";
import { DECK, formatStat, STAT_LABEL } from "./deck.ts";

/** Each stat's values across the deck, lowest first. */
const SORTED = new Map<StatKey, readonly number[]>();

/** Where `value` ranks among the deck's values of `stat`: 0 for the lowest, 1 for the highest. */
export function strengthOf(stat: StatKey, value: number): number {
  let sorted = SORTED.get(stat);
  if (!sorted) {
    sorted = DECK.map((stock) => stock[stat]).sort((a, b) => a - b);
    SORTED.set(stat, sorted);
  }
  if (sorted.length < 2) return 1;
  const below = sorted.filter((v) => v < value).length;
  return Math.min(1, below / (sorted.length - 1));
}

/** The bar's colour for a strength: red at 0, amber at the middle, green at 1. */
export function hueOf(strength: number): number {
  return Math.round(4 + strength * 132);
}

/** A track with its fill: the fill's share and colour are set from `--share` and `--hue`. */
export function bar(stat: StatKey, value: number): HTMLElement {
  const strength = strengthOf(stat, value);
  const track = el("i", "sd-bar");
  track.style.setProperty("--share", String(Math.max(0.06, strength)));
  track.style.setProperty("--hue", String(hueOf(strength)));
  track.append(el("i", "sd-bar-fill"));
  return track;
}

/** One stat row: the name (and, with `numbers`, the number) on a line, the bar under them. */
export function statRow(tag: "div" | "li", stock: Stock, stat: StatKey, numbers: boolean): HTMLElement {
  const row = el(tag, "sd-stat");
  row.append(el("span", "sd-stat-label", STAT_LABEL[stat]));
  if (numbers) row.append(el("b", "sd-stat-value", formatStat(stat, stock[stat])));
  row.append(bar(stat, stock[stat]));
  return row;
}
