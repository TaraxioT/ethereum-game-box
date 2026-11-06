// SimLink: the whole Box in the browser, for the demo. A thin host round the core: the browser's clock, a ledger
// kept in memory, the team games, stations that aren't there (the screen stands in for them, so their port does
// nothing), and the bot on Player 2's seat. The screen taps with a whole tap at once (touch, then done with a fresh
// roll).
import type { Seat } from "@egb/sdk";
import { hash32, mulberry32 } from "@egb/sdk";
import type { CorePorts } from "../../core/ports.ts";
import type { Badge } from "../../core/types.ts";
import type { SimLink } from "./control.ts";
import { createCore } from "../../core/core.ts";
import { createBot } from "../../core/bot.ts";
import { BOT_BADGE, DEMO_BADGES, sameBadge } from "../../core/badges.ts";
import { teamLibrary } from "../../core/catalogue.ts";
import { memoryLedgerStore } from "../../core/ledger.ts";
import { instantTap } from "../../core/instant-tap.ts";
import { systemClock } from "../../core/system-clock.ts";

export function createSimLink(options: { seed?: number } = {}): SimLink {
  const seed = (options.seed ?? Date.now()) >>> 0;
  const rnd = mulberry32(seed);
  const random = (): number => Math.floor(rnd() * 2 ** 32) >>> 0;
  const clock = systemClock();
  const ports: CorePorts = {
    clock,
    stations: { show() {}, buzz() {} },
    ledger: memoryLedgerStore(),
    library: teamLibrary(),
    // The demo keeps no records.
    log: { record() {}, countedSince: () => 0 },
    random,
  };
  const core = createCore(ports, { bot: BOT_BADGE });

  const tapNow = (seat: Seat, badge: Badge): void => void instantTap(core, seat, badge, random());

  const bot = createBot({
    badge: BOT_BADGE,
    clock,
    state: core.state,
    active: () => core.opponent() === "bot",
    tap: () => tapNow(1, BOT_BADGE),
    rnd: mulberry32(hash32("bot", seed)),
  });
  core.subscribe(() => bot.update());

  /** With the bot playing, Player 2's seat is the bot's. */
  function botHolds(seat: Seat): boolean {
    if (seat !== 1 || core.opponent() !== "bot") return false;
    const badge = core.state().seats[1].badge;
    return badge === null || sameBadge(badge, BOT_BADGE);
  }

  function demoBadgeFor(seat: Seat): Badge | null {
    const seats = core.state().seats;
    const seated = seats[seat].badge;
    if (seated) return seated;
    return DEMO_BADGES.find((badge) => !seats.some((slot) => sameBadge(slot.badge, badge))) ?? null;
  }

  return {
    badges: [...DEMO_BADGES, BOT_BADGE],
    botBadge: BOT_BADGE,
    state: core.state,
    now: core.now,
    subscribe: core.subscribe,
    send: core.send,
    tap(seat, badge) {
      if (botHolds(seat)) return;
      const chosen = badge ?? demoBadgeFor(seat);
      if (chosen) tapNow(seat, chosen);
    },
    opponent: core.opponent,
    setOpponent(next) {
      core.setOpponent(next);
      bot.update();
    },
    power: core.power,
    setPower: core.setPower,
    stop() {
      core.stop();
      bot.stop();
    },
  };
}
