// Rez and derez: the launcher's only way in and out. Rez draws a line of light across the middle of a node, then
// opens the node out of it and lets the line go, with one flicker at the end. Derez folds the node back into a line
// that shrinks and goes out. Transform and opacity only, through `play()`, so reduced motion turns both into the
// usual short fade to the end state. The line is a sibling laid over the node: a child would fold and fade with it.
import { calm, play } from "./dom.ts";

export const REZ_MS = 380;
const LINE_MS = 120;
export const FLICKER_MS = 90;
export const DEREZ_MS = 300;
const FOLD_MS = 220;
const FLAT = "scaleY(0.02)";
const EASE_REZ = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_DEREZ = "cubic-bezier(0.7, 0, 0.84, 0)";

export interface Timeline {
  readonly frames: Keyframe[];
  readonly duration: number;
}

/** The node's rez: flat and dark while the line draws, opening on the rez ease, then (with `flicker`) one dip. */
export function rezNode(flicker: boolean): Timeline {
  const duration = REZ_MS + (flicker ? FLICKER_MS : 0);
  const at = (ms: number): number => ms / duration;
  const frames: Keyframe[] = [
    { transform: FLAT, opacity: 0, offset: 0 },
    { transform: FLAT, opacity: 0, offset: at(LINE_MS), easing: EASE_REZ },
    { transform: "none", opacity: 1, offset: at(REZ_MS) },
  ];
  if (flicker) frames.push({ transform: "none", opacity: 0.55, offset: at(REZ_MS + FLICKER_MS / 2) }, { transform: "none", opacity: 1, offset: 1 });
  return { frames, duration };
}

/** The rez line: it grows from the centre over the first 120 ms, then fades while the node opens. */
export function rezLine(): Timeline {
  return {
    frames: [
      { transform: "scaleX(0)", opacity: 1, offset: 0, easing: EASE_REZ },
      { transform: "scaleX(1)", opacity: 1, offset: LINE_MS / REZ_MS },
      { transform: "scaleX(1)", opacity: 0, offset: 1 },
    ],
    duration: REZ_MS,
  };
}

/** The node's derez: it folds flat on the derez ease, then goes out as the line takes over. */
export function derezNode(duration = DEREZ_MS): Timeline {
  const fold = FOLD_MS / DEREZ_MS;
  return {
    frames: [
      { transform: "none", opacity: 1, offset: 0, easing: EASE_DEREZ },
      { transform: FLAT, opacity: 1, offset: fold },
      { transform: FLAT, opacity: 0, offset: fold + 0.01 },
      { transform: FLAT, opacity: 0, offset: 1 },
    ],
    duration,
  };
}

/** The derez line: it shows as the node goes flat, then shrinks to nothing and goes out. */
export function derezLine(duration = DEREZ_MS): Timeline {
  const fold = FOLD_MS / DEREZ_MS;
  return {
    frames: [
      { transform: "scaleX(1)", opacity: 0, offset: 0 },
      { transform: "scaleX(1)", opacity: 0, offset: fold - 0.01 },
      { transform: "scaleX(1)", opacity: 1, offset: fold },
      { transform: "scaleX(0)", opacity: 0, offset: 1 },
    ],
    duration,
  };
}

/** One flicker: a single dip that never goes below 0.4. */
export const FLICKER: Keyframe[] = [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }];

/** Flicker safety: at most `limit` flickers in any `windowMs`. `take(now)` spends one if there is one to spend. */
export function flickerBudget(limit = 3, windowMs = 1000): { take(now: number): boolean } {
  const spent: number[] = [];
  return {
    take(now) {
      while (spent.length && now - (spent[0] ?? 0) >= windowMs) spent.shift();
      if (spent.length >= limit) return false;
      spent.push(now);
      return true;
    },
  };
}

const budget = flickerBudget();

/** Whether a flicker may play now (never under reduced motion; never more than three a second on screen). */
export function mayFlicker(): boolean {
  return !calm() && budget.take(performance.now());
}

/** One flicker on a node, if the budget allows. */
export function flicker(node: Element, delay = 0): void {
  if (mayFlicker()) void play(node, FLICKER, { duration: FLICKER_MS, delay, easing: "linear" });
}

/** A derez leaves its node flat and dark; the next rez clears that. */
const folded = new WeakMap<Element, Animation>();

function line(node: HTMLElement): HTMLElement | null {
  const parent = node.parentElement;
  if (!parent || !node.offsetWidth) return null;
  const bar = document.createElement("i");
  bar.className = "rez-line";
  Object.assign(bar.style, {
    position: "absolute",
    left: `${node.offsetLeft}px`,
    top: `${node.offsetTop + node.offsetHeight / 2 - 1}px`,
    width: `${node.offsetWidth}px`,
    height: "2px",
    background: "var(--sys-hot)",
    boxShadow: "0 0 6px var(--sys-bloom), 0 0 14px var(--sys-bloom)",
    pointerEvents: "none",
    opacity: "0",
    zIndex: "1",
  });
  node.after(bar);
  return bar;
}

/** Rezzes a node in (after `delay` ms); resolves when it stands. Hidden until it starts. */
export async function rez(node: HTMLElement, options: { delay?: number } = {}): Promise<void> {
  const delay = options.delay ?? 0;
  folded.get(node)?.cancel();
  folded.delete(node);
  if (calm()) {
    await play(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay, fill: "backwards" });
    return;
  }
  const bar = line(node);
  const body = rezNode(mayFlicker());
  const light = rezLine();
  await Promise.all([
    play(node, body.frames, { duration: body.duration, delay, fill: "backwards" }),
    bar ? play(bar, light.frames, { duration: light.duration, delay, fill: "backwards" }) : Promise.resolve(),
  ]);
  bar?.remove();
}

/** Derezzes a node out; resolves once it is gone. It stays out until it is rezzed again or removed. */
export async function derez(node: HTMLElement, options: { duration?: number } = {}): Promise<void> {
  folded.get(node)?.cancel();
  if (calm()) {
    const fade = node.animate([{ opacity: 0 }], { duration: 160, fill: "forwards" });
    folded.set(node, fade);
    await fade.finished.catch(() => undefined);
    return;
  }
  const bar = line(node);
  const body = derezNode(options.duration);
  const light = derezLine(options.duration);
  const fold = node.animate(body.frames, { duration: body.duration, fill: "forwards" });
  folded.set(node, fold);
  await Promise.all([fold.finished.catch(() => undefined), bar ? play(bar, light.frames, { duration: light.duration }) : Promise.resolve()]);
  bar?.remove();
}
