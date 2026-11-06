// Packets: light running along the Grid's traces, on a canvas laid over the cached Grid. A packet is a hot head
// riding a trace (a transaction from a port into the core, a payout back out, a cartridge's feed) and the trail it
// leaves: the path behind it stays lit in its colour and fades out over half a second. The canvas only draws while
// something is in flight, starting and stopping its own animation frames. One trace can also be lit (the focused
// cartridge's feed), a static layer redrawn only when it changes; `flare()` flashes every trace once (a launch); and
// in attract a lone packet now and then runs in along a side bundle.
import type { Layout } from "./layout.ts";
import { lengths, pointAtLength, slice } from "./route.ts";
import { TRACE_NAMES, tracesFor, type Trace, type TraceName } from "./traces.ts";
import { GRID, bend, canvasSize, drawTraces, glowOf } from "./grid.ts";
import { calm } from "./dom.ts";

export interface RunOptions {
  /** The packet's colour (default: its trace's). */
  readonly colour?: string;
  /** Run from the core back out to the trace's start (a payout). */
  readonly reverse?: boolean;
  /** How long the head's run takes (default 760 ms). */
  readonly ms?: number;
}

export interface Packets {
  readonly canvas: HTMLCanvasElement;
  /** Runs a packet along the trace; resolves when its head lands (its trail fades after). */
  run(trace: TraceName, options?: RunOptions): Promise<void>;
  /** Lights one trace (and the lines in its bundle) at full intensity; null clears it. */
  light(trace: TraceName | null): void;
  /** Every trace flares at full intensity and fades out over 300 ms. */
  flare(): void;
  /** Attract's ambience: a lone packet along a side-bundle line every 7 s ± 2 s, until turned off. */
  ambient(on: boolean): void;
  /** Matches a new on-screen scale (same layout). */
  resize(scale: number): void;
}

const RUN_MS = 760;
const TRAIL_MS = 500;
/** The trail is drawn in this many bands of age, each at one alpha. */
const BANDS = 10;
const FLARE_MS = 300;

interface Path {
  readonly pts: readonly { x: number; y: number }[];
  readonly cum: readonly number[];
  readonly len: number;
}

interface Flight {
  readonly path: Path;
  readonly t0: number;
  readonly ms: number;
  readonly colour: string;
  readonly ambient: boolean;
  landed: boolean;
  readonly land: () => void;
}

export function createPackets(layout: Layout, scale: number): Packets {
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  const traces = tracesFor(layout);
  const sides = traces.all.filter((t) => !(TRACE_NAMES as readonly string[]).includes(t.bundle));
  const paths = new Map<string, Path>();
  const heads = new Map<string, HTMLCanvasElement>();
  const flights: Flight[] = [];
  let ratio = 1;
  let lit: TraceName | null = null;
  let litLayer: HTMLCanvasElement | null = null;
  let fullLayer: HTMLCanvasElement | null = null;
  let flareAt: number | null = null;
  let ambience: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;

  function size(s: number): void {
    const next = canvasSize(layout, s, window.devicePixelRatio || 1);
    ratio = next.ratio;
    if (canvas.width !== next.w || canvas.height !== next.h) {
      canvas.width = next.w;
      canvas.height = next.h;
    }
    g?.setTransform(ratio, 0, 0, ratio, 0, 0);
    litLayer = null;
    fullLayer = null;
  }

  /** Some traces drawn at full intensity on a layer the size of the canvas, drawn once. */
  function layer(lines: readonly Trace[]): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const c = out.getContext("2d");
    if (c) {
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawTraces(c, lines, 1, ratio);
    }
    return out;
  }

  function pathOf(trace: Trace, reverse: boolean): Path {
    const key = `${traces.all.indexOf(trace)}:${reverse ? "out" : "in"}`;
    let p = paths.get(key);
    if (!p) {
      const pts = reverse ? [...trace.points].reverse() : trace.points;
      const cum = lengths(pts);
      p = { pts, cum, len: cum[cum.length - 1] ?? 0 };
      paths.set(key, p);
    }
    return p;
  }

  /** The head: a 14 × 3 px hot bar with a 10 px bloom in the packet's colour, drawn once per colour at 2×. */
  function headOf(colour: string): HTMLCanvasElement {
    let s = heads.get(colour);
    if (s) return s;
    s = document.createElement("canvas");
    s.width = 80;
    s.height = 48;
    const c = s.getContext("2d");
    if (c) {
      c.scale(2, 2);
      c.shadowColor = glowOf(colour);
      c.shadowBlur = 20;
      c.fillStyle = GRID.hot;
      c.beginPath();
      c.roundRect(13, 10.5, 14, 3, 1.5);
      c.fill();
      c.fill();
    }
    heads.set(colour, s);
    return s;
  }

  /** The trail: in bands by age, each band the stretch of path the head crossed then, at its alpha. */
  function drawTrail(f: Flight, e: number): void {
    if (!g) return;
    const at = (age: number): number => f.path.len * ease(Math.min(1, Math.max(0, (e - age) / f.ms)));
    for (let b = 0; b < BANDS; b++) {
      const young = (b * TRAIL_MS) / BANDS;
      const old = ((b + 1) * TRAIL_MS) / BANDS;
      const to = at(young);
      const from = at(old);
      if (to - from < 0.5) continue;
      const a = 1 - (b + 0.5) / BANDS;
      const p = new Path2D();
      bend(p, slice(f.path.pts, f.path.cum, from, to), 6);
      g.globalAlpha = a * 0.3;
      g.strokeStyle = f.colour;
      g.lineWidth = 6;
      g.stroke(p);
      g.globalAlpha = a;
      g.lineWidth = 2;
      g.stroke(p);
    }
  }

  function drawHead(f: Flight, e: number): void {
    if (!g || e >= f.ms) return;
    const s = pointAtLength(f.path.pts, f.path.cum, f.path.len * ease(e / f.ms));
    g.save();
    g.globalAlpha = 1;
    g.translate(s.x, s.y);
    g.rotate(s.angle);
    g.drawImage(headOf(f.colour), -20, -12, 40, 24);
    g.restore();
  }

  function redraw(now: number): void {
    if (!g) return;
    g.clearRect(0, 0, layout.width, layout.height);
    g.globalAlpha = 1;
    if (lit) {
      litLayer ??= layer(traces.all.filter((t) => t.bundle === lit));
      g.drawImage(litLayer, 0, 0, layout.width, layout.height);
    }
    if (flareAt !== null) {
      const t = (now - flareAt) / FLARE_MS;
      if (t >= 1) flareAt = null;
      else {
        fullLayer ??= layer(traces.all);
        g.globalAlpha = 1 - t;
        g.drawImage(fullLayer, 0, 0, layout.width, layout.height);
      }
    }
    g.lineJoin = "round";
    g.lineCap = "round";
    for (const f of flights) {
      const e = now - f.t0;
      drawTrail(f, e);
      drawHead(f, e);
    }
    g.globalAlpha = 1;
  }

  function frame(now: number): void {
    raf = 0;
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]!;
      const e = now - f.t0;
      if (!f.landed && e >= f.ms) {
        f.landed = true;
        f.land();
      }
      if (e >= f.ms + TRAIL_MS) flights.splice(i, 1);
    }
    redraw(now);
    if (flights.length || flareAt !== null) raf = requestAnimationFrame(frame);
  }

  function wake(): void {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function launch(path: Path, colour: string, ms: number, ambient: boolean): Promise<void> {
    // A hidden page draws no frames, and reduced motion shows no run: the packet lands at once.
    if (document.visibilityState === "hidden" || calm()) return Promise.resolve();
    return new Promise<void>((land) => {
      flights.push({ path, t0: performance.now(), ms, colour, ambient, landed: false, land });
      wake();
    });
  }

  function idle(): void {
    if (!raf) redraw(performance.now());
  }

  function nextAmbient(): void {
    ambience = setTimeout(() => {
      const line = sides[Math.floor(Math.random() * sides.length)];
      if (line) void launch(pathOf(line, false), GRID.sys, RUN_MS * 1.6, true);
      nextAmbient();
    }, 5000 + Math.random() * 4000);
  }

  size(scale);

  return {
    canvas,

    run(trace, options = {}) {
      const t = traces.named[trace];
      return launch(pathOf(t, options.reverse ?? false), options.colour ?? t.colour, options.ms ?? RUN_MS, false);
    },

    light(trace) {
      if (trace === lit) return;
      lit = trace;
      litLayer = null;
      idle();
    },

    flare() {
      if (calm() || document.visibilityState === "hidden") return;
      flareAt = performance.now();
      wake();
    },

    ambient(on) {
      clearTimeout(ambience);
      ambience = undefined;
      if (on && !calm() && sides.length) nextAmbient();
      if (!on) {
        for (let i = flights.length - 1; i >= 0; i--) if (flights[i]!.ambient) flights.splice(i, 1);
        idle();
      }
    },

    resize(next) {
      size(next);
      idle();
    },
  };
}

/** Eased in and out: the packet sets off, runs, and settles into the core. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
