// Small DOM helpers shared by the shell and the views.
import type { Rect } from "./layout.ts";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Positions an element absolutely on the stage, in stage pixels. */
export function place(node: HTMLElement, r: Rect): void {
  node.style.position = "absolute";
  node.style.left = `${r.x}px`;
  node.style.top = `${r.y}px`;
  node.style.width = `${r.w}px`;
  node.style.height = `${r.h}px`;
}

/** Runs a transform/opacity animation and resolves when it ends. Under reduced motion it is a short fade to the end
 * state instead of a move. */
export function play(node: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (calm()) {
    const last = frames[frames.length - 1];
    if (!last) return Promise.resolve();
    const end = { ...last, ...(last.opacity === undefined ? {} : { opacity: last.opacity }) };
    return node.animate([end], { duration: 160, fill: options.fill ?? "none" }).finished.then(() => undefined, () => undefined);
  }
  return node.animate(frames, options).finished.then(() => undefined, () => undefined);
}

export function calm(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, calm() ? 0 : ms));
}

/** Shrinks a node with a transform until it fits `width` stage pixels (text that would run into its neighbours). */
export function fitWidth(node: HTMLElement, width: number): void {
  node.style.transform = "";
  const natural = node.scrollWidth;
  if (natural > width) node.style.transform = `scale(${width / natural})`;
}

/** Sets a line of text's font size to the largest up to `max` px at which it fits `width` stage pixels. */
export function fitFont(node: HTMLElement, width: number, max: number): void {
  node.style.fontSize = `${max}px`;
  const natural = node.scrollWidth;
  if (natural > width) node.style.fontSize = `${Math.floor((max * width) / natural)}px`;
}

/** Resolves once the launcher's faces have loaded: text fitted to a width before then is measured in a fallback. */
export function facesReady(): Promise<void> {
  const faces = ['700 16px "Syncopate"', '600 16px "Oxanium Variable"', '700 16px "JetBrains Mono"'];
  return Promise.all(faces.map((f) => document.fonts.load(f))).then(
    () => undefined,
    () => undefined,
  );
}
