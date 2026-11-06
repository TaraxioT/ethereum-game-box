// The seven steps of the Story, about two minutes at the ENS booth. Each shows a page and points at the part that
// proves the brief's words; the steps that write do it for real on Sepolia, on fresh labels, so the story runs again
// and again. Reset only resets the walkthrough: the chain keeps everything.
import { fullName, titleName } from "@egb/shared/names";

import { claim, freshLabel, openPopup, reportWin, revokeStats, tokenGone } from "./actions.ts";
import { dir, go, render, setFocus, state } from "./app.ts";
import { newTestBadge } from "./badge.ts";
import { client } from "./chain.ts";
import { AGENT_LABEL, DEMO_BOX_LABEL, LIVE_TITLE_GAME } from "./config.ts";
import { locate } from "./registry.ts";
import type { Step } from "./story.ts";

/** A line the current step adds under its caption once its writes are done. */
export const outcome = { text: null as string | null };

async function show(hash: string, focus: string | null): Promise<void> {
  await go(hash);
  setFocus(focus);
}

function needClaim(): { label: string } {
  const label = state.story.label;
  if (!label || !state.badge) throw new Error("This step needs the claim from step 2: press Back, then Next.");
  return { label };
}

export const STEPS: Step[] = [
  {
    id: "tree",
    title: "The tree",
    brief: "Your own subname registry",
    caption: "gamebox.eth's subregistry is a UserRegistry we deployed. GameBoxNames holds only REGISTRAR, RENEW and SET_PARENT in it: your own subname registry.",
    show: () => show("#/", "registry"),
  },
  {
    id: "claim",
    title: "Claim",
    brief: "A forever name with no parent control",
    caption: "A fresh test badge signs ClaimName and the relayer sends it, no ETH needed. The name never expires, its registry is emancipated, and the badge holds every resolver role: a forever name with no parent control.",
    show: () => (state.story.label ? show(`#/name/${fullName(state.story.label)}`, "roles") : show("#/players", "claim")),
    async act() {
      const badge = newTestBadge();
      state.badge = badge;
      const label = freshLabel("judge");
      await claim(badge, label);
      state.story.label = label;
      await show(`#/name/${fullName(label)}`, "roles");
    },
  },
  {
    id: "scoped",
    title: "Scoped writes",
    brief: "Edit only certain text records",
    caption: "In the Try grid, PlayerStats may write stats and nothing else. The badge revokes that (a small drip pays its gas first), and the cell turns red: edit only certain text records.",
    show: () => (state.story.label ? show(`#/name/${fullName(state.story.label)}`, "try") : show("#/players", "claim")),
    async act() {
      const { label } = needClaim();
      // Let the first Try finish, so the grid has an answer to change.
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      await revokeStats(state.badge!, label);
      await render(true);
      setFocus("try");
    },
  },
  {
    id: "licence",
    title: "A Box licence",
    brief: "Scoped keys for operator and Box",
    caption: "mumbai-01: the operator writes its four keys, the demo Box writes lastSeen (ticking) and game, and status is written by the registrar alone.",
    show: () => show(`#/name/${fullName(DEMO_BOX_LABEL)}`, "try"),
  },
  {
    id: "expiry",
    title: "Expiry",
    brief: "Expiring names",
    caption: "Open a pop-up Box: its licence is 10 minutes. It counts down here while the rest of the story runs, and once it lapses it no longer resolves: expiring names.",
    show: () => show("#/boxes", state.story.popup ? "story-popup" : "popup"),
    async act() {
      const label = freshLabel("demo").replace("demo-", "story");
      await openPopup(label);
      state.story.popup = `popup-${label}`;
      await render(true);
      setFocus("story-popup");
    },
  },
  {
    id: "title",
    title: "Title",
    brief: "Non-transferable names",
    caption: "Two Quick Draw wins: the title moves to the new winner, and the old token is gone. Then the holder tries to transfer it, and it reverts TransferDisallowed: non-transferable names.",
    show: () => show(`#/name/${titleName(LIVE_TITLE_GAME)}`, "transfer"),
    async act() {
      const { label } = needClaim();
      let d = await dir();
      let opponent = [...d.players.values()].reverse().find((p) => p.label !== label && p.label !== AGENT_LABEL);
      if (!opponent) {
        // No one else to play: a second test badge claims a rival (it isn't kept as the visitor's badge).
        const rival = freshLabel("rival");
        await claim(newTestBadge(false), rival);
        d = await dir();
        opponent = d.players.get(rival);
      }
      const judge = d.players.get(label);
      if (!judge || !opponent) throw new Error("The story needs two player names on chain.");
      state.story.opponent = opponent.label;
      await show("#/champions", `title-${LIVE_TITLE_GAME}`);
      await reportWin(LIVE_TITLE_GAME, judge, opponent);
      await render(true);
      const before = (await locate(client, titleName(LIVE_TITLE_GAME))).tokenId;
      await reportWin(LIVE_TITLE_GAME, opponent, judge);
      const gone = await tokenGone(LIVE_TITLE_GAME, before);
      outcome.text = gone
        ? `The title moved to ${fullName(opponent.label)}; ${fullName(label)}'s token is gone.`
        : "The title stayed put: check the strip for the results.";
      await show(`#/name/${titleName(LIVE_TITLE_GAME)}`, "transfer");
    },
  },
  {
    id: "agent",
    title: "The agent",
    brief: "Agents as namespaces",
    caption: "bot.gamebox.eth, the practice opponent, has its own name, its own ENSIP-26 records and its own permissions: agents as namespaces.",
    show: () => show("#/agent", "agent"),
  },
];
