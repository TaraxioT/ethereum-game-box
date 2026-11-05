// What every part shares: a shadow root holding the part's own stylesheet over a small shared base, and motion that
// respects reduced motion. Parts animate only transform and opacity; under reduced motion they jump to end states.
import { calm } from "../shell/dom.ts";

/** What every shadow root shares: box sizing, and the reduced-motion rule (the page's own rule stops at the shadow
 * boundary, so every shadow root carries it). */
const BASE = `
*, *::before, *::after { box-sizing: border-box; }
:host { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition-duration: 160ms !important; transition-delay: 0s !important; }
}
`;

let base: CSSStyleSheet | null = null;

export function sheet(css: string): CSSStyleSheet {
  const s = new CSSStyleSheet();
  s.replaceSync(css);
  return s;
}

/** Gives a part its shadow root: the shared base, its own sheet, its markup. */
export function shadow(host: HTMLElement, styles: CSSStyleSheet, html: string, init: Omit<ShadowRootInit, "mode"> = {}): ShadowRoot {
  const root = host.attachShadow({ mode: "open", ...init });
  base ??= sheet(BASE);
  root.adoptedStyleSheets = [base, styles];
  root.innerHTML = html;
  return root;
}

/** The one element a part's markup is sure to hold. */
export function pick<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`part markup lacks ${selector}`);
  return found;
}

/** A transform/opacity animation, or null under reduced motion (the caller's end state stands). */
export function motion(node: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  return calm() ? null : node.animate(frames, options);
}

/** Resolves when every animation has finished or been cancelled. */
export function settled(animations: readonly (Animation | null)[]): Promise<void> {
  return Promise.all(animations.map((a) => a?.finished.catch(() => undefined))).then(() => undefined);
}
