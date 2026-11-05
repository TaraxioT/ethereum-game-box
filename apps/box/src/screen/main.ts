// The screen's entry. One codebase, two builds: `VITE_EGB_MODE=demo` (the default) draws the missing hardware on a
// desk below the screen; `box` is the bare screen for the Pi's kiosk browser. Both run on the simulated Box until the
// Box server's link exists; in box mode the A and L keys stand in for the tap stations.
import "./fonts.css";
import "./tokens.css";
import "./shell/shell.css";
import "./views/views.css";
import { registerParts } from "./parts/register.ts";
import { createSimLink } from "./link/sim/engine.ts";
import { createSound } from "./shell/sound.ts";
import { startApp } from "./shell/app.ts";
import { routes } from "./views/routes.ts";
import { bindTapKeys } from "./demo/keys.ts";
import { mountDesk } from "./demo/desk.ts";
import { showIntroOnce } from "./demo/intro.ts";

const demo = (import.meta.env.VITE_EGB_MODE ?? "demo") === "demo";

registerParts();
const sim = createSimLink();
const sound = createSound();
bindTapKeys(sim);

const desk = demo ? mountDesk(document.body, sim, sound) : null;
startApp(document.body, { link: sim, sound, routes, ...(desk ? { deskHeight: (w: number, h: number) => desk.height(w, h) } : {}) });
if (demo) showIntroOnce(document.body);
