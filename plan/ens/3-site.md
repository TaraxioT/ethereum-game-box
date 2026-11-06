# Prompt 3: the names site

Paste everything below the line into a fresh Claude Code session in `~/Workspace/ethereum-game-box`.

---

You are building `apps/web`, the Game Box's public names site. It shows every ENSv2 feature the Game Box uses, live on
Sepolia: it reads names through the Universal Resolver with plain viem, and it writes them through the relayer.
Right now this site **is** the ENS demo: the "Best Use of ENSv2" judges get its link, and it has to make each ENSv2
feature obvious in a few minutes, without a Game Box in the room.

Read `CLAUDE.md`, `apps/web/README.md`, `packages/shared/README.md`, `plan/ens/README.md` (the design and the ENS
brief's table), `apps/box/src/screen/README.md` (the Box's look, the Grid) and `apps/box/src/screen/link/sim/badges.ts`
(the Demo's badges) first.

Prompt 1 builds the contracts on `names-contracts`, and prompt 2 builds the relayer and the demo Box on
`names-relayer`. Start from prompt 1's first commit, which holds the interfaces, `packages/shared/src/names/` and the
`ens` block of `deployments/sepolia.json`. Build against those, and switch to the live addresses and Worker URLs once
they are published. Use the shared modules for every digest, ABI, key and label rule; never write your own. If you
need something there, ask for it.

Work in a new git worktree on branch `names-site`, cut from `names-contracts`, and rebase as it moves. Don't touch the
main checkout, `contracts/`, `packages/shared/` or `apps/relayer/`. Commit small, with the team trailers, and push
after each green step.

## Stack

Vite and TypeScript, the same as `apps/box`, with small custom elements and no UI framework. Use viem (2.35.0 or
later) for every chain read. A `ResolverNotFound` revert means "doesn't resolve", the same as a null result. It is a static site with no backend and no database: names are listed from `GameBoxNames`' events (from the
deploy block, read in chunks), and every value comes from chain. The RPC is a public Sepolia endpoint, with a
fallback, so no API key ships in the bundle.

## Look and UX

You may change any UI and UX as the work needs. But the look comes **comp first**:

- Before building pages, make two comps of the home view and the inspector: still images or a static HTML page. Base
  both on the Box's Grid look (its palette, faces and light lines) and make them read as a site, with comfortable
  body text.
- Show them to George and wait for his pick. Don't build a look nobody has picked.
- Share the Grid's tokens and fonts by importing them from `@egb/box` through its `package.json` `exports`; never copy
  them. If that needs a change in `apps/box`, keep it to `exports` and say so in the PR.

## What the site has

- **Home: the tree.** `gamebox.eth`, then its own registry, then the Box, player, game and title names, each with
  its resolver. Every node opens in the inspector. Each brief phrase from `plan/ens/README.md` sits next to the part
  that shows it.
- **Boxes.** Each Box shows:
  - `status`;
  - its licence expiry, counting down live (pop-ups in minutes);
  - `lastSeen`, relative and refreshed;
  - its current `game`;
  - its operator's records.

  A lapsed pop-up shows as "expired: no longer resolves", backed by a real `getEnsAddress` that returns null. The
  "Open a pop-up Box" button calls the relayer's `/box/popup`.
- **Players.** Each player name shows its address, its `stats` and the title it holds. "Claim a name":
  - Pick a badge. Either connect an injected wallet (EIP-1193 `eth_signTypedData_v4`) or make a test badge: a key
    generated in the browser and kept in `localStorage`, labelled as a test badge.
  - Type a label, with `labelProblem` feedback as you type and a free/taken check. A free name already resolves:
    to `gamebox.eth`'s default record (wildcard). Show that, so the visitor sees the parent's resolver answering for
    a name that doesn't exist yet.
  - Sign `ClaimName`, then send it to the relayer's `/names/claim`. No ETH needed.
  - Then show a QR code of the name's page in the ENS app, if prompt 1 found that it shows our names, so the judge
    can check it on their phone. Otherwise show a QR of this site's page for the name.
  - Offer "Make it your primary name": the badge's own `setName` on the reverse registrar recorded in
    `packages/shared`. After it, `getEnsName(badge)` shows the name.
  - Afterwards, show the badge what it now controls, and let it revoke `PlayerStats`' `stats` role. That one is a
    direct transaction from the badge, so a test badge first gets a small drip from the relayer's `/names/drip`. Show
    the drip as its own step in the transaction strip.
- **Champions.** `champion.stockduel.gamebox.eth` and `champion.quickdraw.gamebox.eth` each show:
  - the holder, by name, from its address;
  - the streak, start, round and expiry, with Quick Draw's 15 minutes counting down;
  - a history of moves, from `Crowned` events;
  - "Report a match" (two player names and who won), which goes to the demo Box's `/result`. Label it for what it
    is: the demo Box, with a software key, reports this result. At the event, the Box signs only after a real match.
- **Agent.** `bot.gamebox.eth`: its ENSIP-26 records, what it may write, and what the game may write to it.
- **The inspector**, on any name:
  - its registry and resolver, with Etherscan links. Which resolver answered, and why: its own resolver; a linked
    record (pop-ups, showing the name it is linked to and the record id); or the parent's resolver by wildcard;
  - its expiry, and whether its registry is emancipated;
  - the role table: for each known account, which keys it may write. Read it with `roles`/`hasRoles` and decode it
    with the role names from the source;
  - **Try**: every known account tries every key with an `eth_call` from that account, and each cell shows allowed or
    the decoded revert. This grid is the Enhanced Access Control story, live, at no gas. Make it the best-looking
    thing on the site.
- **Transaction strip.** Every write shows `signed › sent › in block n › done`, from the relayer's `/tx/:id`, with
  the hash linked to Etherscan, and the decoded error name on a failure.
- **Sepolia tag.** Show the chain, the head block and the relayer's health, so a judge can see it's live.

## The story (about 2 minutes at the ENS booth)

A Story bar walks through the steps below. Each step has a one-line caption naming the brief's words, Next and Back,
and a Reset that only resets the walkthrough (the chain keeps its state). Visitors can also click around freely.
Every step does real reads and real writes, on fresh labels, so the story can run again and again.

1. **The tree.** Your own subname registry.
2. **Claim.** The judge claims their own name with a test badge. It never expires, the registry is emancipated, and
   the badge holds every resolver role: a forever name with no parent control.
3. **Scoped writes.** In the Try grid, `PlayerStats` can write `stats` and nothing else. The badge revokes it, and
   the cell turns red: edit only certain text records.
4. **A Box licence.** `mumbai-01`: the operator's keys, the demo Box's `lastSeen` ticking, and `status` written by the
   registrar alone.
5. **Aliasing and expiry.** Open a pop-up Box. It serves exactly `mumbai-01`'s records, because it is linked to the
   same record: record aliasing. Its 10-minute licence counts down, and the step says it will finish while the rest
   runs. Then the pop-up has no address, and it answers with `gamebox.eth`'s default record: expiring names, and
   wildcard resolution off the parent's resolver.
6. **Title.** Report two Quick Draw wins. The title moves to the new winner and the old token is gone. A transfer
   attempt (an `eth_call` from the holder) reverts `TransferDisallowed`: non-transferable names.
7. **The agent.** `bot.gamebox.eth`, the practice opponent, with its own name, records and permissions: agents as
   namespaces.

## Tests (Vitest)

- The ENS reads (`src/ens.ts`), against a mocked transport: a name that doesn't resolve reads as null, never as a
  stale value.
- The role table and Try-grid decoding, against recorded `eth_call` results.
- The claim flow's signature, which must equal the vector in `packages/shared`.
- The countdowns and the "expired" state, with fake timers.
- The story's step machine: Next, Back and Reset, and a step's write that fails.

## Deploy and check

- Deploy to a new Cloudflare Pages project, `gamebox-names`, on the account that hosts `ethereum-game-box.pages.dev`.
- In the built-in browser, at desktop and phone width, run the whole story against live Sepolia: claim a fresh name,
  revoke, open a pop-up, report two wins. Check the console for errors.
- Mute the page while testing.
- Take screenshots once, at the end, and put them in the PR.
- Add the live link to `plan/README.md`'s ENS section and to `apps/web/README.md`.

## Done when

- `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- The site is live at the Pages URL, and every story step ran there against Sepolia.
- The PR lists each transaction the run made, with Etherscan links.
