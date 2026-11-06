// EXIT, fixed to the window's bottom-left corner while a match runs (from its first moment to its outcome). A first
// tap arms it for a few seconds and says what it does; a second calls the match off (`quit`): it ends as a draw, so
// both stakes go back. Its pointer and key events never reach the stage.
import type { BoxLink, BoxState } from "../../core/types.ts";
import type { Sound } from "../views/view.ts";
import { el } from "./dom.ts";

/** How long a first tap keeps EXIT armed. */
const ARMED_MS = 4_000;

const running = (state: BoxState): boolean => state.phase === "playing" && state.match !== null && state.match.outcome === null;

export function mountExitKey(host: HTMLElement, link: BoxLink, sound: Sound): void {
  const key = el("button", "exit-key");
  key.type = "button";
  const label = el("span", "exit-key-label", "EXIT");
  const hint = el("span", "exit-key-hint", "");
  key.append(label, hint);
  key.hidden = true;
  host.append(key);
  for (const type of ["pointerdown", "keydown"] as const) key.addEventListener(type, (e) => e.stopPropagation());

  let armed: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => {
    if (armed !== null) clearTimeout(armed);
    armed = null;
    key.classList.remove("armed");
    label.textContent = "EXIT";
    hint.textContent = "";
  };

  key.addEventListener("click", () => {
    if (armed === null) {
      sound.play("ui-select");
      key.classList.add("armed");
      label.textContent = "TAP AGAIN";
      hint.textContent = link.state().match?.stake ? "to call it off · both stakes go back" : "to call it off";
      armed = setTimeout(disarm, ARMED_MS);
      return;
    }
    sound.play("ui-back");
    disarm();
    link.send({ type: "quit" });
  });

  const show = (state: BoxState): void => {
    const on = running(state);
    if (!on) disarm();
    key.hidden = !on;
  };
  show(link.state());
  link.subscribe((state) => show(state));
}
