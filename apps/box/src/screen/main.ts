// The screen's entry. One codebase, two builds: `VITE_EGB_MODE=demo` (the default) runs the whole Box in the browser
// (SimLink), lets the screen stand in for the tap stations and adds the DEMO tag; `box` is the bare screen for the
// Pi's kiosk, on LiveLink to the Box server that served it. In box mode the real stations tap: neither the screen nor
// the keyboard taps anything. At `#sounds` either build shows the sound board instead (`sound/board.ts`).
import "./fonts.css";
import "./tokens.css";
import "./shell/shell.css";
import "./views/views.css";
import type { Badge, Seat } from "../core/types.ts";
import { registerParts } from "./parts/register.ts";
import { createSound } from "./sound/sound.ts";
import { BOARD_HASH, mountSoundBoard } from "./sound/board.ts";
import { startApp } from "./shell/app.ts";
import { routes } from "./views/routes.ts";
import { LINK_PATH } from "../core/wire.ts";
import { connectLive } from "./link/live.ts";
import { createSimLink } from "./link/sim.ts";
import { bindTapKeys } from "./demo/keys.ts";
import { mountDemoTag } from "./demo/demo-tag.ts";
import { showIntroOnce } from "./demo/intro.ts";
import { mountSettings } from "./kiosk/settings.ts";

registerParts();
const sound = createSound();

if (location.hash === BOARD_HASH) {
  mountSoundBoard(document.body, sound);
} else if (import.meta.env.VITE_EGB_MODE === "box") {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const link = await connectLive({ url: `${scheme}//${location.host}${LINK_PATH}` });
  startApp(document.body, { link, sound, routes });
  mountSettings(document.body, sound);
} else {
  const sim = createSimLink();
  bindTapKeys(sim);
  startApp(document.body, {
    link: sim,
    sound,
    routes,
    // The screen taps the seats, and the bot's port says so.
    onSeatTap: (seat: Seat) => sim.tap(seat),
    isBot: (badge: Badge) => badge.address === sim.botBadge.address,
  });
  mountDemoTag(document.body, sim, sound);
  showIntroOnce(document.body, sim);
}
