// The boot: one thing at a time, nothing overlapping. The core lights where it stands; the board powers on outward
// from it (a dark cover with a hole at the core, scaled up: transform only, see shell.css); the ports come up, then the clock and
// gauge. Then the Box is ready and attract takes over. Any touch skips to the end state.
import type { MachineView } from "./machine.ts";
import type { Sound } from "../views/view.ts";
import type { Layout } from "./layout.ts";
import { calm, el, play, wait } from "./dom.ts";

export async function boot(machine: MachineView, layout: Layout, sound: Sound): Promise<void> {
  const { board, core, ports, clock, gauge } = machine.parts;
  const rise = [ports[0], ports[1], clock, gauge];
  const cover = el("div", "boot-cover");
  const { x, y } = layout.core.centre;
  cover.style.setProperty("--cx", `${x}px`);
  cover.style.setProperty("--cy", `${y}px`);
  board.after(cover);
  core.setAttribute("dark", "");
  for (const part of rise) part.style.opacity = "0";

  let skipped = calm();
  const skip = (): void => {
    skipped = true;
  };
  window.addEventListener("pointerdown", skip, { once: true });
  const step = async (run: () => Promise<void>): Promise<void> => {
    if (!skipped) await run();
  };

  await step(() => wait(300));
  await step(async () => {
    sound.play("boot");
    await core.ignite();
  });
  core.removeAttribute("dark");
  await step(() =>
    play(cover, [{ transform: "scale(0.5)" }, { transform: "scale(3)" }], { duration: 1100, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" }),
  );
  cover.remove();
  for (const part of rise) {
    await step(() => play(part, [{ opacity: 0, transform: "translateY(-10px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }));
    part.style.opacity = "";
  }
  window.removeEventListener("pointerdown", skip);
}
