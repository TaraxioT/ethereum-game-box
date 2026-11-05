// A whole tap at once, at the core's now: the `touch`, then its `done` with the badge already known. The demo desk
// and the bot tap this way, and so do the server's injected taps. The roll goes with the tap only when the plan asks
// for one, as a real station's would. None of these is a tap the Box saw at a station: they are `injected`.
import type { Seat } from "@egb/sdk";
import type { TapPlan } from "./ports.ts";
import type { Core } from "./core.ts";
import type { Badge } from "./types.ts";

export function instantTap(core: Core, seat: Seat, badge: Badge, roll: number): { readonly tap: number; readonly plan: TapPlan } {
  const tap = core.nextTap();
  const at = core.now();
  const plan = core.plan(seat);
  core.tap({ phase: "touch", tap, seat, at, badge }, "injected");
  core.tap({ phase: "done", tap, seat, at, badge, roll: plan === "random" ? roll >>> 0 : null }, "injected");
  return { tap, plan };
}
