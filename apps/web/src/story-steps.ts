// The five steps of the Story, about two minutes at the ENS booth. Each shows a page and points at the part that
// proves it; the steps that write do it for real on Sepolia, with a fresh test badge and fresh labels, so the story
// runs again and again. Reset only resets the walkthrough: the chain keeps everything.
import { formatUsdc, fullName, titleName } from "@egb/shared/names";

import { claim, freshLabel, reportWin, tokenGone, topUp } from "./actions.ts";
import { dir, go, render, setFocus, state } from "./app.ts";
import { newTestBadge } from "./badge.ts";
import { client } from "./chain.ts";
import { AGENT_LABEL, DEMO_BOX_LABEL, STORY_GAME } from "./config.ts";
import { boxLicensed } from "./model.ts";
import { locate } from "./registry.ts";
import type { Step } from "./story.ts";
import { readBalance } from "./usdc.ts";

/** A line the current step adds under its caption once its writes are done, by step id. */
export const outcomes = new Map<string, string>();

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
    caption: "gamebox.eth's subregistry is a UserRegistry we deployed, and every Box, player, game, title and championship is a name in it or under it, each with its own resolver.",
    show: () => show("#/", "registry"),
  },
  {
    id: "claim",
    title: "Claim a name",
    brief: "A forever name with no parent control",
    caption: "A fresh test badge, made in this browser, signs ClaimName and the relayer sends it: no ETH needed. The name never expires, its registry is emancipated, and the badge holds every role on its own resolver.",
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
    id: "topup",
    title: "Top up",
    brief: "Top up by name",
    caption: "In the lobby, the new name tops up 100 test USDC to play for. The relayer resolves the name through ENS and mints to the badge: no ETH and no wallet.",
    show: () => (state.story.label ? show(`#/lobby/${fullName(state.story.label)}`, "topup") : show("#/lobby", "topup")),
    async act() {
      const { label } = needClaim();
      const name = fullName(label);
      await show(`#/lobby/${name}`, "topup");
      await topUp(name);
      const balance = await readBalance(client, state.badge!.address);
      outcomes.set("topup", `${name} now holds ${formatUsdc(balance)} USDC.`);
      await render(true);
      setFocus("balance");
    },
  },
  {
    id: "title",
    title: "Title",
    brief: "Non-transferable names",
    caption: `The demo Box (${DEMO_BOX_LABEL}) reports two ${STORY_GAME} wins. The title moves to each new winner by re-registration, so the old token is gone; then the holder tries to transfer it, and it reverts TransferDisallowed.`,
    show: () => show(`#/name/${titleName(STORY_GAME)}`, "transfer"),
    async act() {
      const { label } = needClaim();
      if (!(await boxLicensed(client, DEMO_BOX_LABEL))) {
        throw new Error(`${fullName(DEMO_BOX_LABEL)} isn't licensed, and BoxResults takes results only from a licensed Box.`);
      }
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
      await show("#/champions", `title-${STORY_GAME}`);
      await reportWin(STORY_GAME, judge, opponent);
      await render(true);
      const before = (await locate(client, titleName(STORY_GAME))).tokenId;
      await reportWin(STORY_GAME, opponent, judge);
      const gone = await tokenGone(STORY_GAME, before);
      outcomes.set(
        "title",
        gone ? `The title moved to ${fullName(opponent.label)}, and ${fullName(label)}'s token is gone.` : "The title stayed put: check the strip for the results.",
      );
      await show(`#/name/${titleName(STORY_GAME)}`, "transfer");
      // The public RPCs answer from nodes up to a block apart: read the title again a block later.
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      await render(true);
      setFocus("transfer");
    },
  },
  {
    id: "championship",
    title: "Championship",
    brief: "Live records, then frozen",
    caption: `The same two results scored the open ${STORY_GAME} championship: its standings, leader and addr records moved. Below it, a closed one: the winner holds its name with no expiry, its records are frozen, and every write reverts, ours included.`,
    show: () => show("#/championships", "cups"),
  },
];
