// The app: the screen area (the whole window), the stage scaled into it, the machine on the stage and the router in
// the machine's view layer. It feeds every Box state change to both, rebuilds the stage when the window turns
// between landscape and portrait, and runs the boot. In Demo mode the screen also stands in for the tap stations:
// touching a player's frame taps that seat, and so does touching their half of the screen in a game.
import type { Badge, BoxLink, Seat } from "../../core/types.ts";
import type { Sound, ViewContext } from "../views/view.ts";
import { layoutForArea, type Layout } from "./layout.ts";
import { applyFit, createStage, fit, type Fit } from "./stage.ts";
import { createMachine, type MachineView } from "./machine.ts";
import { createRouter, type Router, type Routes } from "./router.ts";
import { boot } from "./boot.ts";
import { calm, el, play } from "./dom.ts";
import { musicFor, soundsFor } from "../sound/event-sounds.ts";
import { bindBoardHold } from "../sound/board.ts";

export interface AppOptions {
  readonly link: BoxLink;
  readonly sound: Sound;
  readonly routes: Routes;
  /** Demo mode: taps a seat from the screen. Box mode has none: the real stations are the only taps. */
  readonly onSeatTap?: (seat: Seat) => void;
  /** Demo mode: whether a badge is the bot's (its port wears a BOT tag). */
  readonly isBot?: (badge: Badge) => boolean;
}

/** In a game, a touch below the overlay (stage px) taps the seat whose half it lands in. */
const OVERLAY_FOOT = { landscape: 130, portrait: 150 } as const;

export function startApp(host: HTMLElement, options: AppOptions): void {
  const { link, sound, routes } = options;
  const app = el("div", "app");
  const area = el("div", "screen-area");
  app.append(area);
  host.prepend(app);

  let layout: Layout | null = null;
  let stage: HTMLElement | null = null;
  let machine: MachineView | null = null;
  let router: Router | null = null;
  let scale = 0;
  let placed: Fit = { scale: 1, x: 0, y: 0 };

  function build(next: Layout, s: number): void {
    router?.dispose();
    machine?.dispose();
    stage?.remove();
    layout = next;
    scale = s;
    stage = createStage(next);
    machine = createMachine(next, s, options.isBot ? { isBot: options.isBot } : {});
    if (options.onSeatTap) machine.parts.ports.forEach((port, i) => port.setAttribute("key", i === 0 ? "A" : "L"));
    stage.append(machine.root);
    area.append(stage);
    const ctx: ViewContext = { link, machine, sound, layout: next, calm: calm() };
    router = createRouter(ctx, machine.viewLayer, routes, (pose) => machine?.pose(pose));
    const state = link.state();
    machine.update(state, { type: "init" });
    if (state.phase !== "boot") router.update(state, { type: "init" });
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const next = layoutForArea(w, h);
    placed = fit(next, w, h);
    if (next !== layout) build(next, placed.scale);
    else if (Math.abs(placed.scale - scale) / scale > 0.04) {
      scale = placed.scale;
      machine?.rescale(placed.scale);
    }
    if (stage) applyFit(stage, placed);
  }

  /** A touch that taps a seat: on a player's frame (`data-seat`), or below the overlay in a game. */
  function seatTap(e: PointerEvent): void {
    const tap = options.onSeatTap;
    if (!tap || !layout || !machine || !stage || link.state().phase === "boot") return;
    const frame = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-seat]") : null;
    let seat: Seat | null = frame ? (Number(frame.dataset.seat) as Seat) : null;
    const pose = machine.root.dataset.pose;
    if (seat === null && (pose === "game" || pose === "full")) {
      const box = area.getBoundingClientRect();
      const x = (e.clientX - box.left - placed.x) / placed.scale;
      const y = (e.clientY - box.top - placed.y) / placed.scale;
      if (y > OVERLAY_FOOT[layout.orientation]) {
        seat = x < layout.width / 2 ? 0 : 1;
        ripple(stage, seat, x, y);
      }
    }
    if (seat === null) return;
    // The tap is the seat's alone: it doesn't also start attract or press what lies under it.
    e.stopPropagation();
    tap(seat);
  }
  area.addEventListener("pointerdown", seatTap, { capture: true });
  // A developer's way to the sound board: hold the block clock.
  bindBoardHold(area);

  let pending: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(pending);
    pending = setTimeout(resize, 120);
  });
  resize();

  /** This screen has shown its boot sequence (or came up on a Box already past it). */
  let booted = link.state().phase !== "boot";

  link.subscribe((state, event) => {
    machine?.update(state, event);
    for (const heard of soundsFor(state, event)) sound.play(heard.name, { seat: heard.seat });
    sound.music(musicFor(state.phase));
    if (state.phase !== "boot") router?.update(state, event);
    // A Box server that restarted under a screen that has already booted starts in boot again: carry it on.
    else if (booted && event.type === "init") link.send({ type: "booted" });
  });

  if (!booted && machine && layout) {
    void boot(machine, layout, sound).then(() => {
      booted = true;
      link.send({ type: "booted" });
    });
  }
}

/** A ring of the seat's light swelling out from the touch and fading: the half-screen tap landed. */
function ripple(stage: HTMLElement, seat: Seat, x: number, y: number): void {
  const ring = el("i", `tap-ripple seat-${seat}`);
  ring.style.left = `${x - 60}px`;
  ring.style.top = `${y - 60}px`;
  stage.append(ring);
  void play(ring, [{ transform: "scale(0.2)", opacity: 0.9 }, { transform: "scale(1.6)", opacity: 0 }], { duration: 360, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" }).then(() => ring.remove());
}
