// Slide to confirm: a thumb dragged the whole length of its track does something that can't be taken back with one
// tap (unstaking the Box). Let go short of the end and it springs home. Only its transform moves.
import { el } from "../shell/dom.ts";

/** How far along the track counts as all the way. */
const ENOUGH = 0.94;

export interface Slide {
  readonly node: HTMLElement;
  /** Home again, and live. */
  reset(): void;
  /** Held at the end, while what it started runs. */
  hold(word: string): void;
}

export function slideToConfirm(word: string, onConfirm: () => void): Slide {
  const node = el("div", "slide");
  const fill = el("i", "slide-fill");
  const label = el("span", "slide-label", word);
  const thumb = el("span", "slide-thumb");
  thumb.append(el("i", "slide-chevron"), el("i", "slide-chevron"));
  thumb.setAttribute("role", "slider");
  thumb.setAttribute("aria-label", word);
  thumb.setAttribute("aria-valuemin", "0");
  thumb.setAttribute("aria-valuemax", "100");
  node.append(fill, label, thumb);

  let start: { pointer: number; x: number } | null = null;
  let room = 0;

  const place = (x: number): void => {
    const at = room ? x / room : 0;
    thumb.style.transform = `translateX(${x}px)`;
    fill.style.transform = `scaleX(${(x + thumb.offsetWidth) / node.clientWidth})`;
    label.style.opacity = String(Math.max(0, 1 - at * 1.6));
    thumb.setAttribute("aria-valuenow", String(Math.round(at * 100)));
  };

  thumb.addEventListener("pointerdown", (e) => {
    if (node.dataset.state) return;
    room = node.clientWidth - thumb.offsetWidth - 2 * thumb.offsetLeft;
    start = { pointer: e.pointerId, x: e.clientX };
    thumb.setPointerCapture(e.pointerId);
    node.classList.add("dragging");
  });
  thumb.addEventListener("pointermove", (e) => {
    if (start?.pointer !== e.pointerId) return;
    place(Math.min(room, Math.max(0, e.clientX - start.x)));
  });
  const release = (e: PointerEvent): void => {
    if (start?.pointer !== e.pointerId) return;
    const far = Math.min(room, Math.max(0, e.clientX - start.x));
    start = null;
    node.classList.remove("dragging");
    if (room && far / room >= ENOUGH) {
      place(room);
      onConfirm();
    } else place(0);
  };
  thumb.addEventListener("pointerup", release);
  thumb.addEventListener("pointercancel", release);

  return {
    node,
    reset() {
      delete node.dataset.state;
      label.textContent = word;
      place(0);
    },
    hold(text) {
      node.dataset.state = "held";
      label.textContent = text;
      label.style.opacity = "1";
    },
  };
}
