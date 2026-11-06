// The Ethereum mark in wireframe: the real six-facet logo, front on, on its own 256 × 417 grid. Each facet is a
// near-black plane (the left ones a step lighter than the right, the chevron's a step darker than the body's) and
// every facet edge is a hot white line over a static bloom stroke. It gives no light of its own beyond its lines.

/** Each facet's points and its fill. */
const FACETS: readonly (readonly [string, string])[] = [
  ["128,0 0,212.3 128,154.2", "#0d2433"],
  ["128,0 256,212.3 128,154.2", "#071a26"],
  ["0,212.3 128,288 128,154.2", "#0d2433"],
  ["256,212.3 128,288 128,154.2", "#071a26"],
  ["0,236.6 128,312.2 128,417", "#091c28"],
  ["256,236.6 128,312.2 128,417", "#04121b"],
];

const EDGES = "M128 0 0 212.3 128 288 256 212.3Z M0 236.6 128 312.2 256 236.6 128 417Z M128 0V288M128 154.2 0 212.3M128 154.2 256 212.3M128 312.2V417";

/** The mark as an SVG string, its box the mark's plus room for the bloom. Strokes keep their px width at any size. */
export function ethMarkSvg(): string {
  const stroke = (colour: string, width: number): string =>
    `<path d="${EDGES}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 272 433" aria-hidden="true">
  ${FACETS.map(([points, fill]) => `<polygon points="${points}" fill="${fill}"/>`).join("")}
  ${stroke("rgb(74 168 232 / 0.55)", 4)}${stroke("#ffffff", 1.5)}
</svg>`;
}
