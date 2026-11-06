// CSS's cubic-bezier() timing function as a plain function of progress, for the few moves a part drives frame by
// frame itself (the gauge's needle) instead of handing them to the compositor.

/** The easing `cubic-bezier(x1, y1, x2, y2)`: progress 0–1 in, eased progress out. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  // The curve's x and y as polynomials in its own parameter s, and x's slope.
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const x = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  const y = (s: number): number => ((ay * s + by) * s + cy) * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton's method finds the s whose x is t; bisection takes over where the slope is too flat to trust.
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = x(s) - t;
      if (Math.abs(err) < 1e-6) return y(s);
      const slope = dx(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= err / slope;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40 && hi - lo > 1e-7; i++) {
      if (x(s) < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return y(s);
  };
}
