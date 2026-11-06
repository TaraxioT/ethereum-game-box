// Injected taps: a badge taps a seat with no station involved, straight into the core (touch, then done, with a roll
// from the Pi's own randomness when the plan asks for one). They never touch a chip. They test games on the Pi while
// the real stations show the screens and buzz, and they are never evidence for a counted result.
import { randomInt } from "node:crypto";
import { SEATS, type Seat } from "@egb/sdk";
import type { TapPlan } from "../core/ports.ts";
import type { Core } from "../core/core.ts";
import type { Badge } from "../core/types.ts";
import { instantTap } from "../core/instant-tap.ts";
import { HttpError } from "./http.ts";

export interface Injection {
  readonly seat: Seat;
  /** A roster label (`NOVA`, any case) or an address. */
  readonly badge: string;
}

export interface Injected {
  readonly tap: number;
  readonly plan: TapPlan;
  readonly badge: Badge;
  /** Whether the Box took the tap. */
  readonly accepted: boolean;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** `{ seat, badge: "NOVA" | "0x…" }` from a request body, for a Box with `seats` seats; a 400 when it isn't. */
export function parseInjection(body: unknown, seats: number): Injection {
  const shape = `the body must be { seat: 0 to ${seats - 1}, badge: a roster label ("NOVA") or an address }`;
  if (typeof body !== "object" || body === null) throw new HttpError(400, shape);
  const { seat, badge } = body as Record<string, unknown>;
  const taken = SEATS.slice(0, seats).find((s) => s === seat);
  if (taken === undefined || typeof badge !== "string" || !badge.trim() || badge.length > 64) throw new HttpError(400, shape);
  return { seat: taken, badge: badge.trim() };
}

/**
 * The badge a label or an address names, from the roster's badges. An address the roster doesn't know yet is still a
 * badge (its name is the address's start, until a station reads it); a label it doesn't know is a 404.
 */
export function resolveBadge(name: string, roster: readonly Badge[]): Badge {
  const wanted = name.toLowerCase();
  const known = roster.find((b) => b.address.toLowerCase() === wanted || b.name.toLowerCase() === wanted);
  if (known) return known;
  if (ADDRESS.test(name)) return { address: wanted as `0x${string}`, name: wanted.slice(0, 6) };
  throw new HttpError(404, `no badge "${name}" in the roster: tap it on a station first, or give its address`);
}

export function injectTap(core: Core, seat: Seat, badge: Badge): Injected {
  let accepted = false;
  const unsubscribe = core.subscribe((_, event) => {
    if (event.type === "tap" && event.seat === seat) accepted = event.accepted;
  });
  try {
    const { tap, plan } = instantTap(core, seat, badge, randomInt(2 ** 32));
    return { tap, plan, badge, accepted };
  } finally {
    unsubscribe();
  }
}
