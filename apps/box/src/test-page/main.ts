// The test page (/test): four tabs to check the Box on the Pi. Stations, Badges and Box poll the server twice a
// second; Builder follows the game builder's event stream. Plain DOM, served by the Box server; every write goes to a
// route that needs this machine's origin (and the builder's, the launcher token).
import "../screen/fonts.css";
import "../screen/tokens.css";
import "./test-page.css";
import type { BoxReply, TapsReply } from "./wire.ts";
import { get, h } from "./dom.ts";
import { stationsTab } from "./stations.ts";
import { badgesTab } from "./badges.ts";
import { boxTab } from "./box.ts";
import { builderTab } from "./builder.ts";

const POLL_MS = 500;

const stations = stationsTab();
const badges = badgesTab();
const box = boxTab();
const builder = builderTab();
const tabs = { Stations: stations.el, Badges: badges.el, Box: box.el, Builder: builder.el } as const;
type Name = keyof typeof tabs;

const nav = h("nav", "tabs");
const problem = h("p", "status bad");
problem.hidden = true;
const main = h("main", "", ...Object.values(tabs));
document.body.append(h("header", "", h("h1", "", "Game Box", h("span", "", " test")), nav), problem, main);

function open(name: Name): void {
  for (const [tab, el] of Object.entries(tabs)) el.hidden = tab !== name;
  for (const b of nav.children) b.classList.toggle("on", b.textContent === name);
  location.hash = name.toLowerCase();
}
for (const name of Object.keys(tabs) as Name[]) {
  const b = h("button", "", name);
  b.type = "button";
  b.addEventListener("click", () => open(name));
  nav.append(b);
}
const fromHash = (Object.keys(tabs) as Name[]).find((name) => name.toLowerCase() === location.hash.slice(1));
open(fromHash ?? "Stations");

async function poll(): Promise<void> {
  try {
    const [taps, state] = await Promise.all([get<TapsReply>("/api/taps"), get<BoxReply>("/api/box")]);
    problem.hidden = true;
    stations.update(taps);
    badges.update(taps);
    box.update(state);
  } catch (error) {
    problem.hidden = false;
    problem.textContent = `The Box server isn't answering: ${error instanceof Error ? error.message : String(error)}`;
  }
  setTimeout(() => void poll(), POLL_MS);
}
void poll();
