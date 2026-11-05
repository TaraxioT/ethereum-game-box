// The one-time Demo intro: a panel centred over the screen that rezzes in once the boot has finished. How to tap
// without hardware (a player's frame, or their half of the screen in a game; A and L), and where the opponent switch
// and the power cut are. OK or Escape puts it away for good (localStorage `gamebox-intro=2`). The parts must be
// registered first.
import "./demo.css";
import type { BoxLink } from "../link/types.ts";
import { el } from "../shell/dom.ts";
import { derez, rez } from "../shell/rez.ts";

const SEEN_KEY = "gamebox-intro";
/** Bumped when the ways to tap change, so returning visitors see the new ones once. */
const SEEN = "2";

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === SEEN;
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(SEEN_KEY, SEEN);
  } catch {
    // Storage blocked: the intro shows again next visit.
  }
}

/** Shows the intro once the Box has booted, unless it was dismissed before. */
export function showIntroOnce(host: HTMLElement, link: BoxLink): void {
  if (seen()) return;
  if (link.state().phase !== "boot") return show(host);
  const stop = link.subscribe((state) => {
    if (state.phase === "boot") return;
    stop();
    show(host);
  });
}

function show(host: HTMLElement): void {
  const backdrop = el("div", "demo-intro");
  const panel = document.createElement("egb-panel");
  panel.className = "demo-intro-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "demo-intro-title");
  const title = el("h2", "demo-intro-title", "TWO WAYS TO TAP");
  title.id = "demo-intro-title";
  const ok = document.createElement("egb-key");
  ok.className = "demo-intro-ok";
  ok.textContent = "OK";
  panel.append(
    el("div", "demo-intro-kicker", "DEMO"),
    title,
    el("p", "demo-intro-line", "TOUCH A PLAYER'S FRAME, OR THEIR HALF OF THE SCREEN IN A GAME"),
    el("p", "demo-intro-line", "PRESS A FOR PLAYER 1, L FOR PLAYER 2"),
    el("i", "demo-intro-rule"),
    el("p", "demo-intro-note", "VS BOT, HOT SEAT AND CUT POWER ARE IN THE DEMO TAG"),
    ok,
  );
  backdrop.append(panel);
  host.append(backdrop);
  void rez(panel);
  ok.focus({ preventScroll: true });

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    remember();
    void derez(panel).then(() => backdrop.remove());
  };
  ok.addEventListener("click", close);
  // Its keys and touches are its own: Enter on OK must not also start the Box, nor a touch tap a seat.
  backdrop.addEventListener("pointerdown", (e) => e.stopPropagation());
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  });
}
