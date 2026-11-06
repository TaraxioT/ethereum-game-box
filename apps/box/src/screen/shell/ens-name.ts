// An ENS name shown whole, never shortened: one line in a box. A name that fits sits still; one wider than its box
// scrolls past as a ticker (shell.css, `.ens-name.marquee`): the name, a gap, the name again, moving left at an even
// pace, so every letter of it comes by and a long name reads like a sign. Every screen that names a player, a title or
// a cup uses it, and so does any line that carries one (`champion.quickdraw.gamebox.eth → nova.gamebox.eth`).
import { el } from "./dom.ts";

/** How fast a scrolling name moves, in stage px a second. */
const PACE = 64;
/** The gap between a scrolling name and its repeat, in ems. */
const GAP_EM = 2.5;

export interface EnsNameOptions {
  /** Light the name's first label (`nova` of `nova.gamebox.eth`) apart from the rest (`.ens-name-label`). */
  readonly split?: boolean;
}

/** Each box is measured again when it or its text changes size (a font loading, a panel laid out). */
let sizes: ResizeObserver | null = null;
const observe = (box: HTMLElement): void => {
  sizes ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const owner = (entry.target as HTMLElement).closest<HTMLElement>(".ens-name");
      if (owner) fit(owner);
    }
  });
  sizes.observe(box);
  const text = box.querySelector(".ens-name-text");
  if (text) sizes.observe(text);
};

/** A box holding `name`, with any extra classes. */
export function ensName(name: string, className = "", options: EnsNameOptions = {}): HTMLElement {
  const box = el("span", `ens-name ${className}`.trim());
  if (options.split) box.dataset.split = "";
  const track = el("span", "ens-name-track");
  const echo = el("span", "ens-name-text ens-name-echo");
  echo.setAttribute("aria-hidden", "true");
  track.append(el("span", "ens-name-text"), echo);
  box.append(track);
  setEns(box, name);
  observe(box);
  return box;
}

/** Puts `name` in an `ensName` box; the same name leaves it, and its scroll, alone. */
export function setEns(box: HTMLElement, name: string): void {
  if (box.title === name && box.dataset.set !== undefined) return;
  box.dataset.set = "";
  box.title = name;
  for (const text of box.querySelectorAll<HTMLElement>(".ens-name-text")) text.replaceChildren(...parts(name, box.dataset.split !== undefined));
  fit(box);
}

/** `nova` lit and `.gamebox.eth` plain, or the whole name as it is. */
function parts(name: string, split: boolean): (string | HTMLElement)[] {
  const dot = name.indexOf(".");
  if (!split || dot <= 0) return [name];
  return [el("span", "ens-name-label", name.slice(0, dot)), el("span", "ens-name-rest", name.slice(dot))];
}

/** Scrolls the name when it is wider than its box, at `PACE` whatever its length; stills it when it fits. */
function fit(box: HTMLElement): void {
  const text = box.querySelector<HTMLElement>(".ens-name-text");
  if (!text || !box.isConnected) return;
  const width = text.offsetWidth;
  const over = box.clientWidth > 0 && width > box.clientWidth + 1;
  const gap = over ? GAP_EM * parseFloat(getComputedStyle(box).fontSize) : 0;
  const run = width + gap;
  const key = over ? `${Math.round(run)}` : "";
  if (box.dataset.run === key) return;
  box.dataset.run = key;
  box.classList.toggle("marquee", over);
  box.style.setProperty("--ens-gap", `${gap}px`);
  box.style.setProperty("--ens-run", `${run}px`);
  box.style.setProperty("--ens-s", `${(run / PACE).toFixed(2)}s`);
}
