// The screen's entry. One codebase, two builds: `VITE_EGB_MODE=demo` (the default) runs the whole Box in the browser
// (SimLink) and draws the missing hardware on a desk below the screen; `box` is the bare screen for the Pi's kiosk,
// on LiveLink to the Box server that served it. In box mode the real stations tap: the keyboard taps nothing.
import "./fonts.css";
import "./tokens.css";
import "./shell/shell.css";
import "./views/views.css";
import { registerParts } from "./parts/register.ts";
import { createSound } from "./shell/sound.ts";
import { startApp } from "./shell/app.ts";
import { routes } from "./views/routes.ts";
import { LINK_PATH } from "../core/wire.ts";
import { connectLive } from "./link/live.ts";
import { createSimLink } from "./link/sim.ts";
import { bindTapKeys } from "./demo/keys.ts";
import { mountDesk } from "./demo/desk.ts";
import { showIntroOnce } from "./demo/intro.ts";

registerParts();
const sound = createSound();

if (import.meta.env.VITE_EGB_MODE === "box") {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const link = await connectLive({ url: `${scheme}//${location.host}${LINK_PATH}` });
  startApp(document.body, { link, sound, routes });
} else {
  const sim = createSimLink();
  bindTapKeys(sim);
  const desk = mountDesk(document.body, sim, sound);
  startApp(document.body, { link: sim, sound, routes, deskHeight: (w: number, h: number) => desk.height(w, h) });
  showIntroOnce(document.body);
}
