// The boot: one step at a time, nothing overlapping, about 4 s. The void; the horizon rezzes out from under the core;
// the core ignites; the Grid powers on outward from it (a void cover with a hole at the core, scaled up: transform
// only, see shell.css); a white packet runs out of the core along every named trace; the ports, the clock and the
// gas bar rez in turn. Then the Box is ready and attract takes over. Any touch skips to the end state.
import type { MachineView } from "./machine.ts";
import type { Sound } from "../views/view.ts";
import type { Layout } from "./layout.ts";
import { TRACE_NAMES } from "./traces.ts";
import { GRID } from "./grid.ts";
import { calm, el, play, wait } from "./dom.ts";
import { rez } from "./rez.ts";

const PART_GAP_MS = 120;

export async function boot(machine: MachineView, layout: Layout, sound: Sound): Promise<void> {
  const { grid, packets, core, ports, clock, gauge } = machine.parts;
  const parts = [ports[0], ports[1], clock, gauge];
  const { x, y } = layout.core.centre;
  const cover = el("div", "boot-cover");
  cover.style.setProperty("--cx", `${x}px`);
  cover.style.setProperty("--cy", `${y}px`);
  const horizon = el("div", "boot-horizon");
  horizon.style.top = `${layout.horizon - 1}px`;
  horizon.style.transformOrigin = `${x}px 50%`;
  grid.after(cover, horizon);
  core.setAttribute("dark", "");
  // The overlay's pose transitions would fight the rez for the parts' opacity: off until they stand.
  for (const part of parts) {
    part.style.transition = "none";
    part.style.opacity = "0";
  }

  let skipped = calm();
  const skip = (): void => {
    skipped = true;
  };
  window.addEventListener("pointerdown", skip, { once: true });
  const step = async (run: () => Promise<unknown>): Promise<void> => {
    if (!skipped) await run();
  };

  await step(() => wait(300));
  await step(() => {
    sound.play("boot");
    return play(horizon, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 500, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
  });
  await step(() => core.ignite());
  core.removeAttribute("dark");
  await step(() => play(cover, [{ transform: "scale(0.5)" }, { transform: "scale(3)" }], { duration: 900, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" }));
  cover.remove();
  horizon.remove();
  await step(() => Promise.all(TRACE_NAMES.map((name) => packets.run(name, { colour: GRID.hot, reverse: true, ms: 500 }))));
  for (const part of parts) part.style.opacity = "";
  await step(() => Promise.all(parts.map((part, i) => rez(part, { delay: i * PART_GAP_MS }))));
  for (const part of parts) part.style.transition = "";
  window.removeEventListener("pointerdown", skip);
}
