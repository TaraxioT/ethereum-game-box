// The badges Demo mode taps with and the bot's (names invented; addresses fake but fixed, derived from the name), how a
// station or port prints any badge, and when two are the same badge.
import type { Badge } from "./types.ts";
import { hash32 } from "@egb/sdk";

/** A 20-byte address from five hashes of the name, so a badge has the same address every visit. */
function fakeAddress(name: string): `0x${string}` {
  const words = [0, 1, 2, 3, 4].map((word) => hash32("badge", name, word).toString(16).padStart(8, "0"));
  return `0x${words.join("")}`;
}

function badge(label: string): Badge {
  const name = `${label}.gamebox.eth`;
  return { name, address: fakeAddress(name) };
}

/** The badges Demo mode taps with: an empty seat takes the next one that isn't seated. */
export const DEMO_BADGES: readonly Badge[] = [badge("nova"), badge("kite"), badge("juno")];

export const BOT_BADGE: Badge = badge("bot");

/** What a station or port prints for a badge: the label before `.gamebox.eth`, in caps. */
export function badgeLabel(badge: Badge): string {
  return (badge.name.split(".")[0] ?? badge.name).toUpperCase();
}

/** The same badge: both known, with one address. */
export function sameBadge(a: Badge | null, b: Badge | null): boolean {
  return a !== null && b !== null && a.address === b.address;
}
