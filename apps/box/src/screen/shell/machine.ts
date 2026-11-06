// The machine: the Box's own objects that stay on screen across views — the Grid, the packets on its traces, the
// core, the two ports, the block readout and gas bar, and the transaction strip. Views ask it for moments (a packet, a
// swell, a coin turn); the app feeds it the Box's state and events.
import type { Badge, BoxEvent, BoxState, Seat, Tx } from "../../core/types.ts";
import type { Machine, Pose } from "../views/view.ts";
import type { Layout } from "./layout.ts";
import type { EgbCore } from "../parts/core.ts";
import type { EgbPort } from "../parts/port.ts";
import type { EgbClock } from "../parts/clock.ts";
import type { EgbGauge } from "../parts/gauge.ts";
import type { EgbTxbar } from "../parts/txbar.ts";
import { drawGrid } from "./grid.ts";
import { createPackets, type Packets } from "./packets.ts";
import { LIGHT, type SlotTrace } from "./traces.ts";
import { el, place } from "./dom.ts";


export interface MachineView extends Machine {
  readonly root: HTMLElement;
  /** The layer views mount into, between the core and the overlay parts. */
  readonly viewLayer: HTMLElement;
  update(state: BoxState, event: BoxEvent): void;
  /** Redraw the Grid for a new on-screen scale (same layout). */
  rescale(scale: number): void;
  /** For the boot sequence. */
  readonly parts: {
    readonly grid: HTMLElement;
    readonly packets: Packets;
    readonly core: EgbCore;
    readonly ports: readonly [EgbPort, EgbPort];
    readonly clock: EgbClock;
    readonly gauge: EgbGauge;
  };
  dispose(): void;
}

export interface MachineOptions {
  /** Whether a badge is the bot's: its port wears a BOT tag (Demo mode). */
  readonly isBot?: (badge: Badge) => boolean;
}

export function createMachine(layout: Layout, scale: number, options: MachineOptions = {}): MachineView {
  const root = el("div", "machine");
  const grid = el("div", "grid");
  let gridCanvas = drawGrid(layout, scale);
  sizeCanvas(gridCanvas, layout);
  grid.append(gridCanvas);

  const packets: Packets = createPackets(layout, scale);
  sizeCanvas(packets.canvas, layout);
  grid.append(packets.canvas);

  const dimmer = el("div", "grid-dimmer");

  const core = document.createElement("egb-core") as EgbCore;
  const c = layout.core;
  core.setAttribute("glass", String(c.glass));
  core.setAttribute("collar", String(c.collar));
  const coreHost = el("div", "core-host");
  place(coreHost, { x: c.centre.x - c.collar - 24, y: c.centre.y - c.collar - 24, w: (c.collar + 24) * 2, h: (c.collar + 24) * 2 });
  coreHost.append(core);

  const viewLayer = el("div", "view-layer");

  const overlay = el("div", "overlay");
  const ports = layout.ports.map((p, i) => {
    const port = document.createElement("egb-port") as EgbPort;
    port.setAttribute("seat", String(i));
    port.dataset.seat = String(i);
    place(port, p.module);
    overlay.append(port);
    return port;
  }) as unknown as [EgbPort, EgbPort];

  const clock = document.createElement("egb-clock") as EgbClock;
  place(clock, layout.clock);
  const gauge = document.createElement("egb-gauge") as EgbGauge;
  place(gauge, layout.gas);
  const stakeChip = document.createElement("egb-panel");
  stakeChip.className = "stake-chip";
  const txbar = document.createElement("egb-txbar") as EgbTxbar;
  place(txbar, layout.txbar);
  overlay.append(clock, gauge, stakeChip, txbar);

  root.append(grid, dimmer, coreHost, viewLayer, overlay);

  let pose: Pose = "home";
  let lit: number | null = null;
  const shown = new Map<number, Tx["step"]>();
  let hideTx: ReturnType<typeof setTimeout> | undefined;

  // A packet on a port's trace is that player's colour.
  const seatColour = [LIGHT.p1, LIGHT.p2] as const;

  /** Runs a packet along a port's trace (into the core, or out of it for a payout); resolves when it lands. */
  function packet(from: "port" | "core", seat: Seat | null): Promise<void> {
    if (pose === "game") return Promise.resolve();
    const seats: Seat[] = seat === null ? [0, 1] : [seat];
    return Promise.all(seats.map((s) => packets.run(`port${s}`, { colour: seatColour[s], reverse: from === "core" }))).then(
      () => undefined,
    );
  }

  function onTx(tx: Tx): void {
    const before = shown.get(tx.id);
    if (before === tx.step) return;
    shown.set(tx.id, tx.step);
    txbar.show(tx);
    clearTimeout(hideTx);
    if (tx.step === "sent" && tx.direction === "in") void packet("port", tx.seat).then(() => core.swell());
    if (tx.step === "in-block") core.swell();
    if (tx.step === "in-block" && tx.direction === "out") void packet("core", tx.seat);
    if (tx.step === "paid") hideTx = setTimeout(() => txbar.hide(), 3200);
  }

  const machine: MachineView = {
    root,
    viewLayer,
    parts: { grid, packets, core, ports, clock, gauge },

    pose(next) {
      pose = next;
      root.dataset.pose = next;
      for (const p of ports) p.toggleAttribute("compact", next === "game");
      if (next !== "home") machine.feed(null);
    },

    // A game loads: the core turns once and every powered trace flares with it.
    coin() {
      core.coin();
      packets.flare();
    },

    run: (trace, options) => packets.run(trace, options),

    swell: () => core.swell(),

    feed(slot) {
      if (slot === lit) return;
      lit = slot;
      packets.light(slot === null ? null : (`slot${slot}` as SlotTrace));
      if (slot !== null) void packets.run(`slot${slot}` as SlotTrace).then(() => core.swell());
    },


    update(state, event) {
      // Attract's only idle motion besides TAP TO START: it stops the moment the phase moves on.
      if (event.type === "init" || event.type === "phase") packets.ambient(state.phase === "attract");
      if (event.type === "init" || event.type === "seat") {
        state.seats.forEach((s, i) => {
          ports[i]?.set(s);
          ports[i]?.toggleAttribute("bot", Boolean(s.badge && options.isBot?.(s.badge)));
        });
      }
      if (event.type === "init" || event.type === "block") clock.block = state.chain.block;
      if (event.type === "init" || event.type === "gas") gauge.gwei = state.chain.gasGwei;
      if (event.type === "block" && pose !== "game") core.swell();
      if (event.type === "tap") {
        if (event.accepted) ports[event.seat].pulse();
        else ports[event.seat].refuse();
      }
      if (event.type === "tx") {
        onTx(event.tx);
        // Balances move when the money does: the port reads the ledger as the tx lands.
        state.seats.forEach((s, i) => ports[i]?.set(s));
      }
      // Written only when it changes: rewriting the same text on every event repainted the chip and the wide tiles
      // under it on each block, gas reading and transaction step.
      const m = state.match;
      const stake = m ? `${m.stake * 2} EGB AT STAKE` : "";
      if (stakeChip.textContent !== stake) stakeChip.textContent = stake;
      if (stakeChip.hidden !== !m) stakeChip.hidden = !m;
    },

    rescale(next) {
      gridCanvas.replaceWith((gridCanvas = drawGrid(layout, next)));
      sizeCanvas(gridCanvas, layout);
      packets.resize(next);
    },

    dispose() {
      clearTimeout(hideTx);
      packets.ambient(false);
      root.remove();
    },
  };
  machine.pose("home");
  return machine;
}

function sizeCanvas(canvas: HTMLCanvasElement, layout: Layout): void {
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
}
