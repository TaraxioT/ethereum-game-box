// The EXIT tag: on the kiosk's own page only (the one the Box gave its launcher token), fixed to the window's
// bottom-left corner above the stage. A tap arms it (TAP AGAIN TO EXIT, in alert red, for a few seconds); a second tap
// asks the Box to close the kiosk's browser (POST /api/box/exit), so the Pi's desktop shows. The Box keeps running.
// None of its pointer or key events reach the stage.
import "./kiosk.css";
import { framed } from "../parts/frame.ts";
import { el } from "../shell/dom.ts";
import { BuilderError, hasLauncherToken, postJson } from "../views/builder-link.ts";

const CHAMFER = 10;
/** How long a first tap stays armed. */
const ARMED_MS = 4_000;
/** How long a refusal stays on the tag. */
const REFUSED_MS = 4_000;

type Step = "idle" | "armed" | "closing" | "refused";

const WORDS: Record<Step, string> = {
  idle: "EXIT",
  armed: "TAP AGAIN TO EXIT",
  closing: "CLOSING",
  refused: "CAN'T EXIT",
};

export function mountExitTag(host: HTMLElement): void {
  if (!hasLauncherToken()) return;
  const tag = framed(el("button", "exit-tag"), CHAMFER);
  tag.type = "button";
  tag.setAttribute("aria-label", "Exit the Box's screen");
  const word = el("span", "exit-word");
  tag.append(el("i", "exit-icon"), word);
  host.append(tag);

  let step: Step = "idle";
  let timer: ReturnType<typeof setTimeout> | undefined;

  function set(next: Step, why = ""): void {
    step = next;
    clearTimeout(timer);
    tag.dataset.step = next;
    word.textContent = WORDS[next];
    tag.title = why;
    if (next === "armed") timer = setTimeout(() => set("idle"), ARMED_MS);
    if (next === "refused") timer = setTimeout(() => set("idle"), REFUSED_MS);
  }

  tag.addEventListener("click", () => {
    if (step === "idle" || step === "refused") return set("armed");
    if (step !== "armed") return;
    set("closing");
    postJson("/api/box/exit").catch((error: unknown) => {
      // The browser closing under the request is the exit working, not a refusal.
      if (error instanceof BuilderError && error.status === 0) return;
      set("refused", error instanceof Error ? error.message : String(error));
    });
  });
  for (const type of ["pointerdown", "keydown"] as const) tag.addEventListener(type, (e) => e.stopPropagation());
  tag.addEventListener("keydown", (e) => {
    if (e.key === "Escape") set("idle");
  });
  set("idle");
}
