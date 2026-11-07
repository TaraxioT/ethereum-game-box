// The machine: the Box's own objects that stay on screen across views — the Grid, the packets on its traces, the
// core, a port for each seat on show, the block readout and gas bar, and the transaction strip. Views ask it for moments (a packet, a
// swell, a coin turn); the app feeds it the Box's state and events.
import { SEATS, sideOf } from "@egb/sdk";
import type { Badge, BoxEvent, BoxState, Phase, Seat, Tx } from "../../core/types.ts";
import { playerSeats } from "../../core/seats.ts";
import type { Machine, Pose } from "../views/view.ts";
import { portBoxes, type Layout } from "./layout.ts";
import type { EgbCore } from "../parts/core.ts";
import type { EgbPort } from "../parts/port.ts";
import type { EgbClock } from "../parts/clock.ts";
import type { EgbGauge } from "../parts/gauge.ts";
import type { EgbTxbar } from "../parts/txbar.ts";
import { drawGrid } from "./grid.ts";
import { createPackets, type Packets } from "./packets.ts";
import { LIGHT, type SlotTrace } from "./traces.ts";
import { el, place } from "./dom.ts";
import { createEnsTags } from "./ens-tags.ts";


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
    readonly ports: readonly [EgbPort, EgbPort, EgbPort, EgbPort];
    readonly clock: EgbClock;
    readonly gauge: EgbGauge;
  };
  dispose(): void;
}

/** From here on, a match has its players: a seat left empty sits it out, and its port goes. */
const MATCH_PHASES: ReadonlySet<Phase> = new Set(["stake", "playing", "judging", "result", "refund"]);

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
  const ports = SEATS.map((seat) => {
    const port = document.createElement("egb-port") as EgbPort;
    port.setAttribute("seat", String(seat));
    port.dataset.seat = String(seat);
    overlay.append(port);
    return port;
  }) as unknown as [EgbPort, EgbPort, EgbPort, EgbPort];

  const clock = document.createElement("egb-clock") as EgbClock;
  place(clock, layout.clock);
  const gauge = document.createElement("egb-gauge") as EgbGauge;
  place(gauge, layout.gas);
  const stakeChip = document.createElement("egb-panel");
  stakeChip.className = "stake-chip";
  const txbar = document.createElement("egb-txbar") as EgbTxbar;
  place(txbar, layout.txbar);
  const ensTags = createEnsTags(layout);
  overlay.append(clock, gauge, stakeChip, txbar, ...ensTags.els);

  root.append(grid, dimmer, coreHost, viewLayer, overlay);

  let pose: Pose = "home";
  /** How many seats have a port on show. */
  let seats = 0;
  /** Who a transaction with no seat of its own moves money for. */
  let players: readonly Seat[] = [];
  let lit: number | null = null;
  const shown = new Map<number, Tx["step"]>();
  let hideTx: ReturnType<typeof setTimeout> | undefined;

  // A packet on a port's trace is that player's colour. Players 3 and 4 ride their side's trace.
  const seatColour = [LIGHT.p1, LIGHT.p2, LIGHT.p3, LIGHT.p4] as const;

  /** A port for each seat on show: past two they share each corner, and are small enough not to shrink in a game. */
  function showPorts(state: BoxState): void {
    const count = state.seats.length;
    if (count !== seats) {
      seats = count;
      const boxes = portBoxes(layout, count);
      ports.forEach((port, i) => {
        const box = boxes[i];
        if (box) place(port, box);
        port.toggleAttribute("compact", pose === "game" && count <= 2);
      });
    }
    ports.forEach((port, i) => {
      const seat = state.seats[i];
      const shown = seat !== undefined && (seat.badge !== null || !MATCH_PHASES.has(state.phase));
      if (port.hidden === shown) port.hidden = !shown;
    });
  }

  /** Inside a game the Grid and the core are hidden: nothing is sent along them. */
  const inGame = (): boolean => pose === "game" || pose === "full";

  /** Runs a packet along a port's trace (into the core, or out of it for a payout); resolves when it lands. */
  function packet(from: "port" | "core", seat: Seat | null): Promise<void> {
    if (inGame()) return Promise.resolve();
    const moving = seat === null ? players : [seat];
    return Promise.all(moving.map((s) => packets.run(`port${sideOf(s)}`, { colour: seatColour[s], reverse: from === "core" }))).then(
      () => undefined,
    );
  }

  function onTx(tx: Tx): void {
    const before = shown.get(tx.id);
    if (before === tx.step) return;
    shown.set(tx.id, tx.step);
    // An open has two stakes at least, even once its seats have gone.
    txbar.show(tx, Math.max(players.length, 2));
    clearTimeout(hideTx);
    // A lobby's top-up, buy or name belongs to no seat: it lights the core, and runs no packet to a port.
    const seated = tx.kind !== "topup" && tx.kind !== "buy" && tx.kind !== "claim";
    if (tx.step === "sent" && tx.direction === "in" && seated) void packet("port", tx.seat).then(() => core.swell());
    if (tx.step === "in-block") core.swell();
    if (tx.step === "in-block" && tx.direction === "out" && seated) void packet("core", tx.seat);
    if (tx.step === "paid" || tx.step === "failed") hideTx = setTimeout(() => txbar.hide(), 3200);
  }

  const machine: MachineView = {
    root,
    viewLayer,
    parts: { grid, packets, core, ports, clock, gauge },

    pose(next) {
      pose = next;
      root.dataset.pose = next;
      for (const p of ports) p.toggleAttribute("compact", next === "game" && seats <= 2);
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
      players = playerSeats(state.seats);
      const opened = state.seats.length !== seats;
      showPorts(state);
      if (event.type === "init" || event.type === "seat" || opened) {
        state.seats.forEach((s, i) => {
          ports[i]?.set(s);
          ports[i]?.toggleAttribute("bot", Boolean(s.badge && options.isBot?.(s.badge)));
        });
      }
      if (event.type === "init" || event.type === "block") clock.block = state.chain.block;
      if (event.type === "init" || event.type === "gas") gauge.gwei = state.chain.gasGwei;
      if (event.type === "block" && !inGame()) core.swell();
      if (event.type === "tap") {
        if (event.accepted) ports[event.seat].pulse();
        else ports[event.seat].refuse();
      }
      ensTags.update(state, event, Date.now());
      if (event.type === "tx") {
        onTx(event.tx);
        // Balances move when the money does: the ports show each new read from chain.
        state.seats.forEach((s, i) => ports[i]?.set(s));
      }
      // Written only when it changes: rewriting the same text on every event repainted the chip and the wide tiles
      // under it on each block, gas reading and transaction step.
      const m = state.match;
      const mode = m?.playFor === "title" ? " + THE TITLE" : m?.playFor === "cup" ? " + THE CUP" : "";
      const stake = !m ? "" : m.stake > 0 ? `${m.stake * players.length} USDC AT STAKE${mode}` : "FREE PLAY";
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
