// The short words badges are named with: the roster's local labels, and the lobby's proposed player names (each one
// already a valid ENS label: 3 to 32 of a-z, 0-9 and -). Pure.
import type { Badge } from "./types.ts";

/** Labels in the order new badges get them; after these, the words again with a number. */
export const LABELS = [
  "nova", "orbit", "pixel", "comet", "ember", "flux", "echo", "quark", "vega", "lumen", "onyx", "rune",
  "zephyr", "jade", "atlas", "cinder", "drift", "sol", "ion", "kite", "lynx", "mesa", "opal", "raven",
] as const;

/** A badge's own label: the roster's word (`nova`), or the first label of its name (`nova.gamebox.eth`). */
export function ownLabel(badge: Badge): string {
  return (badge.name.split(".")[0] ?? badge.name).toLowerCase();
}

/**
 * The label the lobby proposes to a badge with no player name: its own label first (so the demo's badges are `nova`,
 * `kite` and `juno`), then, each time a player asks for another, a word with two digits (`comet-42`). `random` is a
 * uint32.
 */
export function proposeLabel(badge: Badge, attempt: number, random: number): string {
  if (attempt === 0) return ownLabel(badge);
  const word = LABELS[random % LABELS.length] ?? "nova";
  return `${word}-${String(Math.floor(random / LABELS.length) % 90 + 10)}`;
}
