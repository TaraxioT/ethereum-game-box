// The bot on Player 2's seat. A pure planner says what the bot is waiting to do and how long a person would take to
// do it; a small scheduler on the core's clock turns that into one timed tap at a time.
import type { Badge, BoxState } from "./types.ts";
import type { Clock, TimerHandle } from "./ports.ts";
import { frontRemainingMs } from "../games/stock-duel/rules.ts";

export const BOT_SEAT = 1;

/** Human timing, in ms. */
export const JOIN_MS = [800, 1600] as const;
export const SIGN_MS = [700, 1500] as const;
export const REACT_MS = [220, 420] as const;
export const THINK_MS = [600, 2200] as const;
export const REFUND_MS = [1000, 2000] as const;
/** How often the bot jumps the gun in Quick Draw. */
export const EARLY_CHANCE = 0.04;
/** How likely the bot is to play a Stock Duel card that comes to the front, if there is time to think. */
export const PLAY_CHANCE = 0.45;
/** The tap must land this long before the card leaves the front. */
const CARD_MARGIN_MS = 50;

/** The tap the bot is waiting to make. `key` names the moment, so it is planned once. */
export type BotIntent =
  | { readonly kind: "join"; readonly key: string }
  | { readonly kind: "sign"; readonly key: string }
  /** `untilDraw`: ms from now until the sign flips. */
  | { readonly kind: "draw"; readonly key: string; readonly untilDraw: number }
  /** `remainingMs`: how long the card stays in front. */
  | { readonly kind: "card"; readonly key: string; readonly remainingMs: number }
  | { readonly kind: "refund"; readonly key: string };

/** What the bot would tap for now, or null. `bot` is its badge; it only acts while it holds Player 2's seat. */
export function botIntent(state: BoxState, now: number, bot: Badge): BotIntent | null {
  const mine = state.seats[BOT_SEAT];
  const player = state.seats[0];
  if (!mine.badge) {
    const wanted = state.phase === "join" || (state.phase === "home" && player.badge !== null);
    return wanted ? { kind: "join", key: "join" } : null;
  }
  if (mine.badge.address !== bot.address) return null;
  const { match } = state;
  switch (state.phase) {
    case "stake":
      return player.signed && !mine.signed ? { kind: "sign", key: "sign" } : null;
    case "playing": {
      if (!match || match.outcome) return null;
      const { play } = match;
      // The demo's bot plays the team games only (the demo runs no built or store games).
      if (play.game === "built" || play.game === "store") return null;
      if (play.game === "quick-draw") {
        if (play.state.phase === "done" || play.state.taps[BOT_SEAT] !== null) return null;
        return { kind: "draw", key: `draw:${match.id}`, untilDraw: play.state.drawAt - now };
      }
      const duel = play.state;
      if (duel.phase !== "pick" || duel.played[BOT_SEAT] !== null) return null;
      const slot = Math.floor((now - duel.drumAt[BOT_SEAT]) / duel.dwellMs);
      const remainingMs = frontRemainingMs(duel, BOT_SEAT, now);
      return { kind: "card", key: `card:${match.id}:${duel.round}:${slot}`, remainingMs };
    }
    case "refund":
      if (!match || match.refunded[BOT_SEAT] || now < match.refundAt) return null;
      return { kind: "refund", key: `refund:${match.id}` };
    default:
      return null;
  }
}

function between(range: readonly [number, number], rnd: () => number): number {
  return range[0] + rnd() * (range[1] - range[0]);
}

/** How long until the bot taps for this intent, or null to let the moment pass. */
export function botDelay(intent: BotIntent, rnd: () => number): number | null {
  switch (intent.kind) {
    case "join":
      return between(JOIN_MS, rnd);
    case "sign":
      return between(SIGN_MS, rnd);
    case "draw":
      if (intent.untilDraw > 0 && rnd() < EARLY_CHANCE) return intent.untilDraw * (0.2 + 0.7 * rnd());
      return Math.max(0, intent.untilDraw + between(REACT_MS, rnd));
    case "card": {
      if (rnd() >= PLAY_CHANCE) return null;
      const longest = Math.min(THINK_MS[1], intent.remainingMs - CARD_MARGIN_MS);
      if (longest < THINK_MS[0]) return null;
      return between([THINK_MS[0], longest], rnd);
    }
    case "refund":
      return between(REFUND_MS, rnd);
  }
}

export interface BotDriver {
  /** Re-plan after the Box changed. */
  update(): void;
  stop(): void;
}

export interface BotDeps {
  readonly badge: Badge;
  readonly clock: Clock;
  state(): BoxState;
  /** false: the bot sits out (hot seat). */
  active(): boolean;
  tap(): void;
  rnd: () => number;
}

export function createBot(deps: BotDeps): BotDriver {
  const { clock } = deps;
  let planned: string | null = null;
  let timer: TimerHandle | null = null;

  function cancel(): void {
    clock.cancel(timer);
    timer = null;
  }

  function current(): BotIntent | null {
    return deps.active() ? botIntent(deps.state(), clock.now(), deps.badge) : null;
  }

  return {
    update() {
      const intent = current();
      if (intent?.key === planned) return;
      cancel();
      planned = intent?.key ?? null;
      if (!intent) return;
      const delay = botDelay(intent, deps.rnd);
      if (delay === null) return;
      timer = clock.after(delay, () => {
        timer = null;
        if (current()?.key === intent.key) deps.tap();
      });
    },
    stop() {
      cancel();
      planned = null;
    },
  };
}
