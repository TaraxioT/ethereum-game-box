// A demo build opened from a Box server: the Box serves its kiosk's build, never the demo, so this page says so in
// place of starting a simulated Box on the real one.
import "./demo.css";
import { el } from "../shell/dom.ts";

export function mountWrongBuild(host: HTMLElement): void {
  const box = el("div", "demo-wrong-build");
  box.setAttribute("role", "alert");
  box.append(
    el("h1", "demo-wrong-build-title", "THIS IS THE BROWSER DEMO'S BUILD"),
    el("p", "demo-wrong-build-line", "THE DEMO RUNS ONLY IN A BROWSER, AWAY FROM THE BOX. BUILD THE KIOSK'S SCREEN:"),
    el("code", "demo-wrong-build-code", "pnpm --filter @egb/box build:box"),
  );
  host.append(box);
}
