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

/** Runs a transform/opacity animation and resolves when it ends (at once under reduced motion). */
export function play(node: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (calm()) {
    const last = frames[frames.length - 1];
    if (last) node.animate([last], { duration: 1, fill: options.fill ?? "none" });
    return Promise.resolve();
  }
  return node.animate(frames, options).finished.then(() => undefined, () => undefined);
}

export function calm(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, calm() ? 0 : ms));
}
