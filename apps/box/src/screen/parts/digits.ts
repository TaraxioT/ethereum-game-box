// A row of digits that changes one character at a time: each character is its own span, and when the value changes
// the characters that differ (lined up from the right, as numbers are) flicker in left to right, 60 ms apart. The
// port's balance and the clock's block number use it.
import { calm } from "../shell/dom.ts";
import { mayFlicker } from "../shell/rez.ts";

const STEP_MS = 60;

/** Which characters of `next` differ from `prev`, the two lined up from the right. */
export function changedDigits(prev: string, next: string): boolean[] {
  const shift = next.length - prev.length;
  return [...next].map((ch, i) => prev[i - shift] !== ch);
}

/** Writes `text` into `host`; with `animate`, the changed characters flicker in. */
export function setDigits(host: HTMLElement, text: string, animate: boolean): void {
  const prev = host.textContent ?? "";
  if (prev === text) return;
  const changed = changedDigits(prev, text);
  const spans = [...text].map((ch) => {
    const s = document.createElement("span");
    s.textContent = ch;
    return s;
  });
  host.replaceChildren(...spans);
  if (!animate || !prev || calm()) return;
  // One flicker from the budget covers the whole run; without one the digits only fade in.
  const frames: Keyframe[] = mayFlicker()
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0.5, offset: 0.7 }, { opacity: 1 }]
    : [{ opacity: 0 }, { opacity: 1 }];
  let k = 0;
  spans.forEach((s, i) => {
    if (changed[i]) s.animate(frames, { duration: 160, delay: k++ * STEP_MS, easing: "linear", fill: "backwards" });
  });
}
