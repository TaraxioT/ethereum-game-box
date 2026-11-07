// What the demo says about itself: that it is the browser demo, there for checking the project, while the real Box
// runs on hardware; and the links to the project's other pages. The DEMO tag's panel shows both, the intro the note.
import { NAMES_SITE_PAGES, PROJECT_SITES, type Site } from "@egb/shared/web";
import { el } from "../shell/dom.ts";

export const ABOUT_KICKER = "DEMO FOR VERIFICATION";
/** The real Box, in a line. */
export const REAL_BOX = "THE REAL GAME BOX RUNS ON A RASPBERRY PI, WITH NFC BADGES, TAP STATIONS AND A HARDWARE KEY, AND SETTLES ON SEPOLIA";
/** This demo, in a line. */
export const THIS_DEMO = "THIS IS ITS SCREEN AND CORE IN YOUR BROWSER, SIMULATED: NO BADGES, NO KEY, NOTHING ON CHAIN";

function linkGrid(title: string, sites: readonly Site[]): HTMLElement {
  const group = el("div", "demo-links");
  const list = el("ul", "demo-link-grid");
  list.setAttribute("aria-label", title);
  for (const site of sites) {
    const a = el("a", "demo-link", site.label.toUpperCase());
    a.href = site.url;
    a.target = "_blank";
    a.rel = "noopener";
    const item = el("li");
    item.append(a);
    list.append(item);
  }
  group.append(el("div", "demo-links-title", title), list);
  return group;
}

/** The note and the links, for the DEMO tag's panel. */
export function aboutSection(): HTMLElement {
  const section = el("section", "demo-about");
  section.setAttribute("aria-label", "About this demo");
  section.append(
    el("div", "demo-about-kicker", ABOUT_KICKER),
    el("p", "demo-about-line", REAL_BOX),
    el("p", "demo-about-line", THIS_DEMO),
    linkGrid("NAMES SITE · LIVE ON SEPOLIA", NAMES_SITE_PAGES),
    linkGrid("PROJECT", PROJECT_SITES),
  );
  return section;
}
