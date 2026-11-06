// The classic ethereum-blockies identicon: the 8 × 8 mirrored face wallets have drawn for an address since 2016, so a
// badge shows the same face here as everywhere else. Same seed (the lower-cased address), the same xorshift and the
// same draw order as the original: three colours (foreground, background, spot), then the left half of each row,
// mirrored. Pure, so it is tested without a DOM.

export interface Blockie {
  readonly color: string;
  readonly bg: string;
  readonly spot: string;
  /** 64 cells, row by row: 0 background, 1 colour, 2 spot. */
  readonly cells: readonly number[];
}

export function blockie(address: string): Blockie {
  const seed = [0, 0, 0, 0];
  const text = address.toLowerCase();
  // The original keeps each sum as a plain number; the next shift truncates it to 32 bits.
  for (let i = 0; i < text.length; i++) {
    const k = i % 4;
    const s = seed[k] ?? 0;
    seed[k] = (s << 5) - s + text.charCodeAt(i);
  }
  const rand = (): number => {
    const [s0 = 0, s1 = 0, s2 = 0, s3 = 0] = seed;
    const t = s0 ^ (s0 << 11);
    const next = s3 ^ (s3 >> 19) ^ t ^ (t >> 8);
    seed[0] = s1;
    seed[1] = s2;
    seed[2] = s3;
    seed[3] = next;
    return (next >>> 0) / ((1 << 31) >>> 0);
  };
  const colour = (): string => {
    const h = Math.floor(rand() * 360);
    const s = rand() * 60 + 40;
    const l = (rand() + rand() + rand() + rand()) * 25;
    return `hsl(${h} ${round(s)}% ${round(l)}%)`;
  };
  const color = colour();
  const bg = colour();
  const spot = colour();
  const cells: number[] = [];
  for (let y = 0; y < 8; y++) {
    const half: number[] = [];
    for (let x = 0; x < 4; x++) half.push(Math.floor(rand() * 2.3));
    cells.push(...half, ...half.slice().reverse());
  }
  return { color, bg, spot, cells };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** The blockie in its own colours, `size` px square, crisp at any scale. */
export function blockieSvg(address: string, size: number): string {
  const b = blockie(address);
  let rects = "";
  b.cells.forEach((c, i) => {
    if (c) rects += `<rect x="${i % 8}" y="${Math.floor(i / 8)}" width="1" height="1" fill="${c === 1 ? b.color : b.spot}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><rect width="8" height="8" fill="${b.bg}"/>${rects}</svg>`;
}

/**
 * The blockie as an LED matrix, `size` px square: one rounded LED per cell, classed `c0` (off), `c1` (colour) or `c2`
 * (spot) for the caller to light in its own colours (a port lights them in its seat's neon).
 */
export function blockieLedSvg(address: string, size: number): string {
  const b = blockie(address);
  let leds = "";
  b.cells.forEach((c, i) => {
    leds += `<rect class="c${c}" x="${(i % 8) + 0.08}" y="${Math.floor(i / 8) + 0.08}" width=".84" height=".84" rx=".14"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 8 8" aria-hidden="true">${leds}</svg>`;
}
