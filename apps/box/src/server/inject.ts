// Injected taps: a named badge taps a seat with no station involved, straight into the core (touch, then done, with a
// roll from the Pi's own randomness when the plan asks for one). It tests games on the Pi while the real stations
// show the screens and buzz.
import { randomInt } from "node:crypto";
import type { Seat } from "@egb/sdk";
import type { TapPlan } from "../core/ports.ts";
import type { Core } from "../core/core.ts";
import type { Badge } from "../core/types.ts";
import { instantTap } from "../core/instant-tap.ts";
import { HttpError } from "./http.ts";

export interface Injection {
  readonly seat: Seat;
  readonly badge: Badge;
}

export interface Injected {
  readonly tap: number;
  readonly plan: TapPlan;
  /** Whether the Box took the tap. */
  readonly accepted: boolean;
}

/** `{ seat: 0 | 1, badge: { address, name } }` from a request body; a 400 when it isn't. */
export function parseInjection(body: unknown): Injection {
  const shape = "the body must be { seat: 0 | 1, badge: { address: 0x + 40 hex, name: 1–32 characters } }";
  if (typeof body !== "object" || body === null) throw new HttpError(400, shape);
  const { seat, badge } = body as Record<string, unknown>;
  if ((seat !== 0 && seat !== 1) || typeof badge !== "object" || badge === null) throw new HttpError(400, shape);
  const { address, name } = badge as Record<string, unknown>;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, shape);
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 32) throw new HttpError(400, shape);
  return { seat, badge: { address: address.toLowerCase() as `0x${string}`, name: name.trim() } };
}

export function injectTap(core: Core, { seat, badge }: Injection): Injected {
  let accepted = false;
  const unsubscribe = core.subscribe((_, event) => {
    if (event.type === "tap" && event.seat === seat) accepted = event.accepted;
  });
  try {
    const { tap, plan } = instantTap(core, seat, badge, randomInt(2 ** 32));
    return { tap, plan, accepted };
  } finally {
    unsubscribe();
  }
}
