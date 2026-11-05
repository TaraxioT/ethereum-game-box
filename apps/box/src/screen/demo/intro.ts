// The one-time brass instruction plate (an <egb-plate> with a brass <egb-key>): how to tap without hardware, the
// opponent switch and the power cut. OK puts it away for good (localStorage `gamebox-intro=1`). The parts must be
// registered first.
import "./demo.css";
import { calm, el } from "../shell/dom.ts";

const SEEN_KEY = "gamebox-intro";

const WAYS: readonly string[] = [
  "Drag a badge onto a puck",
  "Click or touch a puck",
  "Press A for Player 1",
  "Press L for Player 2",
];

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage blocked: the plate shows again next visit.
  }
}

/** Shows the plate over everything unless it was dismissed before. */
export function showIntroOnce(host: HTMLElement): void {
  if (seen()) return;
  const backdrop = el("div", "dk-intro");
  const plate = document.createElement("egb-panel");
  plate.className = "dk-intro-plate";
  plate.setAttribute("role", "dialog");
  plate.setAttribute("aria-modal", "true");
  plate.setAttribute("aria-labelledby", "dk-intro-title");
  const kicker = el("div", "dk-intro-kicker", "Demo");
  const title = el("h2", "dk-intro-title", "Four ways to tap");
  title.id = "dk-intro-title";
  const list = el("ol", "dk-intro-ways");
  WAYS.forEach((way, i) => {
    const item = el("li", "dk-intro-way");
    item.append(el("span", "dk-intro-num", String(i + 1)), el("span", "dk-intro-text", way));
    list.append(item);
  });
  const rule = el("div", "dk-intro-rule");
  const notes = el("div", "dk-intro-notes");
  notes.append(
    el("p", "dk-intro-note", "VS BOT or HOT SEAT: play the bot, or a friend on the same desk"),
    el("p", "dk-intro-note", "CUT POWER to see a refund"),
  );
  const ok = document.createElement("egb-key");
  ok.className = "dk-intro-ok";
  ok.textContent = "OK";
  plate.append(kicker, title, list, rule, notes, ok);
  backdrop.append(plate);
  host.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("dk-intro-in"));
  ok.focus({ preventScroll: true });

  const close = (): void => {
    remember();
    ok.removeEventListener("click", close);
    backdrop.removeEventListener("keydown", onKey);
    backdrop.classList.remove("dk-intro-in");
    setTimeout(() => backdrop.remove(), calm() ? 0 : 320);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  ok.addEventListener("click", close);
  backdrop.addEventListener("keydown", onKey);
}
