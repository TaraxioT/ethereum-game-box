// The screen's entry. One codebase, two builds: `VITE_EGB_MODE=demo` (the default) lets the screen stand in for the
// tap stations and adds the DEMO tag; `box` is the bare screen for the Pi's kiosk browser. Both run on the simulated
// Box until the Box server's link exists; in both, the A and L keys tap Player 1 and Player 2.
import "./fonts.css";
import "./tokens.css";
import "./shell/shell.css";
import "./views/views.css";
import type { Badge, Seat } from "./link/types.ts";
import { registerParts } from "./parts/register.ts";
import { createSimLink } from "./link/sim/engine.ts";
import { createSound } from "./shell/sound.ts";
import { startApp } from "./shell/app.ts";
import { routes } from "./views/routes.ts";
import { bindTapKeys } from "./demo/keys.ts";
import { mountDemoTag } from "./demo/demo-tag.ts";
import { showIntroOnce } from "./demo/intro.ts";

const demo = (import.meta.env.VITE_EGB_MODE ?? "demo") === "demo";

registerParts();
const sim = createSimLink();
const sound = createSound();
// A Box has two real stations and no bot: both seats are people.
if (!demo) sim.setOpponent("hotseat");
bindTapKeys(sim);

startApp(document.body, {
  link: sim,
  sound,
  routes,
  // Demo mode: the screen taps the seats, and the bot's port says so.
  ...(demo ? { onSeatTap: (seat: Seat) => sim.tap(seat), isBot: (badge: Badge) => badge.address === sim.botBadge.address } : {}),
});
if (demo) {
  mountDemoTag(document.body, sim, sound);
  showIntroOnce(document.body, sim);
}
