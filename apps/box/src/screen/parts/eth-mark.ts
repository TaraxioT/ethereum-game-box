// The Ethereum mark: the real six-facet logo, front on, on its own 256 × 417 grid. The upper body's four facets meet
// at its centre point, the chevron's two under it. Devcon lavender and pink on the left, periwinkle on the right, the
// lower facets darker; a light inside it, brightest where the facets meet, and a hairline of light along its ridges.
// With `backlight`, a soft light sits behind it, as when it glows inside the core's glass.

interface Facet {
  readonly points: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly stops: readonly [string, string];
}

const FACETS: readonly Facet[] = [
  // upper left: lavender, lit
  { points: "128,0 0,212.3 128,154.2", from: [90, 24], to: [60, 200], stops: ["#cdb8ff", "#f4dcff"] },
  // upper right: periwinkle
  { points: "128,0 256,212.3 128,154.2", from: [166, 24], to: [150, 196], stops: ["#8f9cff", "#c3cbff"] },
  // lower left: pink, darker
  { points: "0,212.3 128,288 128,154.2", from: [30, 196], to: [124, 282], stops: ["#f0b4e2", "#a985ee"] },
  // lower right: periwinkle, darker
  { points: "256,212.3 128,288 128,154.2", from: [226, 196], to: [132, 282], stops: ["#9a9cf8", "#6a6fe0"] },
  // chevron left: pink-lavender
  { points: "0,236.6 128,312.2 128,417", from: [30, 246], to: [122, 404], stops: ["#d6b0f4", "#9479e6"] },
  // chevron right: deep periwinkle
  { points: "256,236.6 128,312.2 128,417", from: [226, 246], to: [134, 404], stops: ["#8790f6", "#565bd2"] },
];

const OUTLINE = "M128 0 0 212.3 128 288 256 212.3Z M0 236.6 128 312.2 256 236.6 128 417Z";
const RIDGES = "M128 0V154.2M128 154.2 0 212.3M128 154.2 256 212.3M128 154.2V288M128 312.2V417";

/** Every mark's gradients get their own ids, so two marks on one page never borrow each other's. */
let next = 0;

export interface EthMarkOptions {
  /** A soft light behind the mark (it widens the viewBox to make room for it). */
  readonly backlight?: boolean;
}

/** The mark as an SVG string. Without a backlight its box is the mark's (plus a hairline's margin). */
export function ethMarkSvg(options: EthMarkOptions = {}): string {
  const id = `egb-eth-${next++}`;
  const view = options.backlight ? "-70 -50 396 517" : "-4 -4 264 425";
  const grads = FACETS.map(
    (f, i) =>
      `<linearGradient id="${id}-${i}" gradientUnits="userSpaceOnUse" x1="${f.from[0]}" y1="${f.from[1]}" x2="${f.to[0]}" y2="${f.to[1]}"><stop offset="0" stop-color="${f.stops[0]}"/><stop offset="1" stop-color="${f.stops[1]}"/></linearGradient>`,
  ).join("");
  const back = options.backlight
    ? `<radialGradient id="${id}-back" gradientUnits="userSpaceOnUse" cx="128" cy="200" r="250"><stop offset="0" stop-color="#d9c6ff" stop-opacity=".55"/><stop offset=".45" stop-color="#a98bff" stop-opacity=".2"/><stop offset="1" stop-color="#7a5cf0" stop-opacity="0"/></radialGradient>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" aria-hidden="true">
  <defs>${grads}${back}
    <radialGradient id="${id}-in" gradientUnits="userSpaceOnUse" cx="128" cy="196" r="170"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset=".55" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  ${options.backlight ? `<ellipse cx="128" cy="208" rx="196" ry="256" fill="url(#${id}-back)"/>` : ""}
  ${FACETS.map((f, i) => `<polygon points="${f.points}" fill="url(#${id}-${i})"/>`).join("")}
  <path d="${OUTLINE}" fill="url(#${id}-in)"/>
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="${OUTLINE}" stroke="rgb(250 244 255 / 0.45)" stroke-width="2.2"/>
    <path d="${RIDGES}" stroke="rgb(255 255 255 / 0.32)" stroke-width="1.5"/>
  </g>
</svg>`;
}
