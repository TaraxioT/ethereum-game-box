// Packets: light running along the board's copper, on a canvas laid over the cached board. A packet is a short comet
// riding a named trace (a transaction from a port into the core, a payout back out, a cartridge's feed); the canvas
// only draws while one is in flight, starting and stopping its own animation frames. One trace can also be lit (the
// focused cartridge's feed), a static overlay redrawn only when it changes.
import type { Layout, Point } from "./layout.ts";
import { lengths, slice } from "./route.ts";
import { tracesFor, type Trace, type TraceName } from "./traces.ts";
import { bend, canvasSize, pastel } from "./board.ts";
import { calm } from "./dom.ts";

export interface RunOptions {
  /** The packet's colour (default: its trace's). */
  readonly colour?: string;
  /** Run from the collar back out to the trace's start (a payout). */
  readonly reverse?: boolean;
  /** How long the run takes (default 760 ms). */
  readonly ms?: number;
}

export interface Packets {
  readonly canvas: HTMLCanvasElement;
  /** Runs a packet along the trace; resolves when it lands. */
  run(trace: TraceName, options?: RunOptions): Promise<void>;
  /** Lights one trace (and the lines in its bundle) brighter; null clears it. */
  light(trace: TraceName | null): void;
  /** Matches a new on-screen scale (same layout). */
  resize(scale: number): void;
}

const RUN_MS = 760;

interface Path {
  readonly pts: readonly Point[];
  readonly cum: readonly number[];
  readonly len: number;
}

interface Flight {
  readonly path: Path;
  readonly t0: number;
  readonly ms: number;
  readonly colour: string;
  readonly hot: string;
  readonly width: number;
  readonly sprite: HTMLCanvasElement;
  /** Drawn at its end once; resolved and removed on the next frame. */
  ended: boolean;
  readonly done: () => void;
}

export function createPackets(layout: Layout, scale: number): Packets {
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  const traces = tracesFor(layout);
  const paths = new Map<string, Path>();
  const sprites = new Map<string, HTMLCanvasElement>();
  const flights: Flight[] = [];
  let lit: TraceName | null = null;
  let raf = 0;

  function size(s: number): void {
    const { w, h, ratio } = canvasSize(layout, s, window.devicePixelRatio || 1);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    g?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function pathOf(name: TraceName, reverse: boolean): Path {
    const key = `${name}:${reverse ? "out" : "in"}`;
    let p = paths.get(key);
    if (!p) {
      const pts = reverse ? [...traces.named[name].points].reverse() : traces.named[name].points;
      const cum = lengths(pts);
      p = { pts, cum, len: cum[cum.length - 1] ?? 0 };
      paths.set(key, p);
    }
    return p;
  }

  /** The packet's head: a soft dot, white at its heart, drawn once per colour. */
  function spriteOf(colour: string): HTMLCanvasElement {
    let s = sprites.get(colour);
    if (s) return s;
    s = document.createElement("canvas");
    s.width = s.height = 64;
    const c = s.getContext("2d");
    if (c) {
      const r = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, "#ffffff");
      r.addColorStop(0.22, pastel(colour, 0.5));
      r.addColorStop(0.5, `${hex(colour)}55`);
      r.addColorStop(1, `${hex(colour)}00`);
      c.fillStyle = r;
      c.fillRect(0, 0, 64, 64);
    }
    sprites.set(colour, s);
    return s;
  }

  function stroke(pts: readonly Point[], colour: string, width: number, a: number): void {
    if (!g || pts.length < 2) return;
    const p = new Path2D();
    bend(p, pts, 6);
    g.globalAlpha = a;
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.stroke(p);
  }

  function drawLit(): void {
    if (!lit) return;
    for (const t of traces.all.filter((x: Trace) => x.bundle === lit)) {
      stroke(t.points, t.colour, t.width + 5, 0.28);
      stroke(t.points, pastel(t.colour, 0.45), t.width * 0.9, 1);
      stroke(t.points, "#ffffff", Math.max(1, t.width * 0.35), 0.85);
    }
  }

  /** A comet: a stretch of the trace heating toward a small hot head, every corner followed. */
  function drawFlight(f: Flight, now: number): void {
    if (!g) return;
    const t = f.ended || f.ms <= 0 ? 1 : Math.min(1, (now - f.t0) / f.ms);
    const head = ease(t) * f.path.len;
    const tail = Math.min(110, f.path.len * 0.4);
    const at = (k: number): Point[] => slice(f.path.pts, f.path.cum, head - tail * k, head);
    const w = f.width;
    stroke(at(0.6), f.colour, w * 3, 0.16);
    stroke(at(1), f.colour, w * 1.2, 0.3);
    stroke(at(0.55), f.colour, w * 1.3, 0.7);
    stroke(at(0.35), f.hot, w, 0.95);
    stroke(at(0.14), "#ffffff", w * 0.55, 1);
    const tip = at(0)[0]!;
    const d = w * 5.5;
    g.globalAlpha = 1;
    g.drawImage(f.sprite, tip.x - d / 2, tip.y - d / 2, d, d);
    if (t >= 1) f.ended = true;
  }

  function redraw(now: number): void {
    if (!g) return;
    g.clearRect(0, 0, layout.width, layout.height);
    g.lineJoin = "round";
    g.lineCap = "round";
    drawLit();
    for (const f of flights) drawFlight(f, now);
    g.globalAlpha = 1;
  }

  function frame(now: number): void {
    raf = 0;
    // A packet drawn at its end last frame has landed: resolve it and draw the board without it.
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]!;
      if (!f.ended) continue;
      flights.splice(i, 1);
      f.done();
    }
    redraw(now);
    if (flights.length) raf = requestAnimationFrame(frame);
  }

  function wake(): void {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  size(scale);

  return {
    canvas,

    run(trace, options = {}) {
      // A hidden page draws no frames: nobody would see the packet, so it lands at once.
      if (document.visibilityState === "hidden") return Promise.resolve();
      const path = pathOf(trace, options.reverse ?? false);
      const colour = options.colour ?? traces.named[trace].colour;
      return new Promise<void>((done) => {
        flights.push({
          path,
          t0: performance.now(),
          ms: calm() ? 0 : (options.ms ?? RUN_MS),
          colour,
          hot: pastel(colour, 0.55),
          width: traces.named[trace].width,
          sprite: spriteOf(colour),
          ended: false,
          done,
        });
        wake();
      });
    },

    light(trace) {
      if (trace === lit) return;
      lit = trace;
      if (!raf) redraw(performance.now());
    },

    resize(next) {
      size(next);
      if (!raf) redraw(performance.now());
    },
  };
}

/** Eased in and out: the packet sets off, runs, and settles into the collar. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** A `#rrggbb` colour for appending an alpha pair; any other form falls back to white. */
function hex(colour: string): string {
  return /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#ffffff";
}
