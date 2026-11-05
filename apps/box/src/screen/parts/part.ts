// What every part shares: a shadow root holding the part's own stylesheet over the shared materials, and motion that
// respects reduced motion. Parts animate only transform and opacity; under reduced motion they jump to end states.

/** Materials more than one part is built from, and the reduced-motion rule (the page's own rule stops at the shadow
 * boundary, so every shadow root carries it). */
const BASE = `
*, *::before, *::after { box-sizing: border-box; }
:host { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

/* An LCD set in a bevelled gunmetal frame, lit from the top left: a bright top edge, a dark bottom edge, the glass
   sunk into it with an inner shadow and a sheen across its top half. --lcd-glass is the glass's colour. */
.lcd-frame {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, #8f86bf 0%, #5a5188 16%, #3c3468 55%, #2b2449 100%);
  box-shadow:
    inset 0 1.5px 0 rgb(255 255 255 / 0.36), inset 1.5px 0 0 rgb(255 255 255 / 0.08), inset 0 -2px 0 rgb(0 0 0 / 0.45),
    0 0 0 1.5px #0b0718, 0 8px 16px rgb(3 1 10 / 0.55);
}
.lcd-glass {
  position: absolute; overflow: hidden;
  background: linear-gradient(180deg, color-mix(in srgb, var(--lcd-glass) 80%, #fff 4%), var(--lcd-glass) 55%, color-mix(in srgb, var(--lcd-glass) 70%, #000));
  box-shadow: inset 0 3px 7px rgb(0 0 0 / 0.72), inset 0 0 0 1px rgb(0 0 0 / 0.6), 0 1px 0 rgb(255 255 255 / 0.14), 0 -1px 0 rgb(0 0 0 / 0.4);
}
.lcd-glass::after {
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 46%; pointer-events: none;
  background: linear-gradient(180deg, rgb(255 255 255 / 0.09), rgb(255 255 255 / 0.02));
}

/* A slotted screw head, domed and lit from the top left; --turn sets where its slot points. */
.screw {
  position: absolute; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, var(--screw-hi, #f1eefb) 0, var(--screw, #aaa5c4) 32%, var(--screw-lo, #5d5878) 72%, var(--screw-rim, #2f2b45) 100%);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.45), 0 1px 0 1px rgb(255 255 255 / 0.12);
}
.screw::after {
  content: ""; position: absolute; left: 16%; right: 16%; top: 44%; height: 12%; border-radius: 1px;
  background: rgb(20 14 30 / 0.8); box-shadow: 0 1px 0 rgb(255 255 255 / 0.28); transform: rotate(var(--turn, 30deg));
}

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

/** Gives a part its shadow root: the shared materials, its own sheet, its markup. */
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

export function calm(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A transform/opacity animation, or null under reduced motion (the caller's end state stands). */
export function motion(node: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  return calm() ? null : node.animate(frames, options);
}

/** Resolves when every animation has finished or been cancelled. */
export function settled(animations: readonly (Animation | null)[]): Promise<void> {
  return Promise.all(animations.map((a) => a?.finished.catch(() => undefined))).then(() => undefined);
}
