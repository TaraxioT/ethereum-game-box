// An ENS name shown whole, never shortened: one line in a box that scrolls sideways. A name wider than its box drifts
// to its end and back (shell.css, `.ens-name`), and a finger can swipe it too. Every screen that names a player, a
// title or a cup uses it.
import { el } from "./dom.ts";

/** A box holding `name`, with any extra classes. */
export function ensName(name: string, className = ""): HTMLElement {
  const box = el("span", `ens-name ${className}`.trim());
  box.append(el("span", "ens-name-text"));
  setEns(box, name);
  return box;
}

/** Puts `name` in an `ensName` box; the same name leaves it, and its drift, alone. */
export function setEns(box: HTMLElement, name: string): void {
  const text = box.firstElementChild as HTMLElement;
  if (text.textContent === name) return;
  text.textContent = name;
  box.title = name;
}
