// The app: the screen area (the window, less the desk in Demo mode), the stage scaled into it, the machine on the
// stage and the router in the machine's view layer. It feeds every Box state change to both, rebuilds the stage when
// the window turns between landscape and portrait, and runs the boot.
import type { BoxLink } from "../../core/types.ts";
import type { Sound, ViewContext } from "../views/view.ts";
import { layoutFor, orientationFor, type Layout } from "./layout.ts";
import { applyFit, createStage, fit } from "./stage.ts";
import { createMachine, type MachineView } from "./machine.ts";
import { createRouter, type Router, type Routes } from "./router.ts";
import { boot } from "./boot.ts";
import { calm, el } from "./dom.ts";

export interface AppOptions {
  readonly link: BoxLink;
  readonly sound: Sound;
  readonly routes: Routes;
  /** The height the desk takes at the bottom of the window (Demo mode), for a window size. */
  readonly deskHeight?: (viewW: number, viewH: number) => number;
}

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

  function measure(): { w: number; h: number } {
    const w = window.innerWidth;
    const h = window.innerHeight - (options.deskHeight?.(w, window.innerHeight) ?? 0);
    area.style.height = `${h}px`;
    return { w, h };
  }

  function build(next: Layout, s: number): void {
    router?.dispose();
    machine?.dispose();
    stage?.remove();
    layout = next;
    scale = s;
    stage = createStage(next);
    machine = createMachine(next, s);
    stage.append(machine.root);
    area.append(stage);
    const ctx: ViewContext = { link, machine, sound, layout: next, calm: calm() };
    router = createRouter(ctx, machine.viewLayer, routes, (pose) => machine?.pose(pose));
    const state = link.state();
    machine.update(state, { type: "init" });
    if (state.phase !== "boot") router.update(state, { type: "init" });
  }

  function resize(): void {
    const { w, h } = measure();
    const next = layoutFor(orientationFor(w, h));
    const f = fit(next, w, h);
    if (next !== layout) build(next, f.scale);
    else if (Math.abs(f.scale - scale) / scale > 0.04) {
      scale = f.scale;
      machine?.rescale(f.scale);
    }
    if (stage) applyFit(stage, f);
  }

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
    if (event.type === "cue") sound.play(event.cue);
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
