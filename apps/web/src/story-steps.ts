// The seven steps of the Story, about two minutes at the ENS booth. Each shows a page and points at the part that
// proves the brief's words; the steps that write do it for real on Sepolia, on fresh labels, so the story runs again
// and again. Reset only resets the walkthrough: the chain keeps everything.
import { fullName, popupLabel, titleName } from "@egb/shared/names";

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

/** The story's pop-up Box: the one this run opened while it is live, or a new one. */
async function ensureStoryPopup(): Promise<string> {
  const current = state.story.popup;
  if (current) {
    const where = await locate(client, fullName(current));
    if (where.status === "registered") return current;
  }
  const label = freshLabel("demo").replace("demo-", "story");
  await openPopup(label);
  state.story.popup = popupLabel(label);
  return state.story.popup;
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
    brief: "Edit only certain text records",
    caption: "mumbai-01: status is the registrar's alone, the demo Box writes lastSeen (ticking) and game, and the operator writes its four keys from the operator site with a passkey. A pop-up opens for this story; change location on the operator site and watch it land on mumbai-01 and its pop-up in the same block.",
    show: () => show(`#/name/${fullName(DEMO_BOX_LABEL)}`, "operator-watch"),
    async act() {
      await ensureStoryPopup();
      await show(`#/name/${fullName(DEMO_BOX_LABEL)}`, "operator-watch");
    },
  },
  {
    id: "aliasing",
    title: "Aliasing and expiry",
    brief: "Record aliasing · Expiring names · Wildcard",
    caption: "The pop-up has no record of its own: it is linked to mumbai-01's record, so it serves exactly its records (record aliasing). Its 10-minute licence counts down while the story runs; then it has no address, and gamebox.eth's default record answers by wildcard.",
    show: () => (state.story.popup ? show(`#/name/${fullName(state.story.popup)}`, "answer") : show("#/boxes", "popup")),
    async act() {
      const popup = await ensureStoryPopup();
      await show(`#/name/${fullName(popup)}`, "answer");
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
