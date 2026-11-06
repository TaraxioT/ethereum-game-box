// The names site: mounts the Sepolia tag, the router and its pages, the Story rail and the transaction strip.
import "./site.css";

import { mountRouter, parseRoute, registerPage, render, state } from "./app.ts";
import { watchHead } from "./chain.ts";
import { agentPage } from "./pages/agent.ts";
import { boxesPage } from "./pages/boxes.ts";
import { championsPage } from "./pages/champions.ts";
import { championshipsPage } from "./pages/championships.ts";
import { inspectorPage } from "./pages/inspector.ts";
import { lobbyPage } from "./pages/lobby.ts";
import { playersPage } from "./pages/players.ts";
import { treePage } from "./pages/tree.ts";
import { Story } from "./story.ts";
import { STEPS, outcomes } from "./story-steps.ts";
import { mountChainTag, mountTxStrip } from "./ui/chrome.ts";
import { registerLive } from "./ui/live.ts";
import { mountRail } from "./ui/rail.ts";

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  return el;
};

registerLive();
watchHead();
mountChainTag(byId("chain"));
mountTxStrip(byId("txs"));

registerPage("", treePage);
registerPage("lobby", lobbyPage);
registerPage("championships", championshipsPage);
registerPage("boxes", boxesPage);
registerPage("players", playersPage);
registerPage("champions", championsPage);
registerPage("agent", agentPage);
registerPage("name", inspectorPage);

let draw: (view: Story["current"]) => void = () => {};
const story = new Story(
  STEPS,
  (view) => draw(view),
  () => {
    state.story = { label: null };
    outcomes.clear();
  },
);
draw = mountRail(byId("rail"), story);
draw(story.current);
mountRouter(byId("page"));

// Pages that change by themselves (heartbeats, titles, standings, balances, pop-ups) are read again every minute, in place.
// Not while someone is typing in a form.
setInterval(() => {
  const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement;
  if (!typing && ["boxes", "champions", "championships", "lobby", ""].includes(parseRoute(location.hash).page)) void render(true);
}, 60_000);
