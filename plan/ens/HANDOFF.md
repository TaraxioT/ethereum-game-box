# Handoff: build the Game Box names on ENSv2

Paste everything below the line into a fresh Claude Code session in `~/Workspace/ethereum-game-box`.

---

You are running the build of the Game Box's ENS names on ENSv2 on Sepolia: real contracts, tests, a deploy verified
on Etherscan, a relayer, a software demo Box, and a live public site that showcases every ENSv2 feature the ENS
"Best Use of ENSv2" track asks for. The work is already specified in four prompts in `plan/ens/`. Your job is to run
them in the right order, keep them unblocked, and bring George one finished, reviewed result.

Read `CLAUDE.md`, then `plan/ens/README.md` (the shared design: roles, names, records, signed messages and Sepolia
facts), then `1-contracts.md`, `2-relayer.md`, `3-site.md` and `4-review.md`. The design is fixed. If something in it
can't work on the live ENSv2 deployment, stop and tell George what and why before anyone changes it.

## How to run it

You orchestrate, and subagents do the code and the test runs.

- **Agents.** Give every subagent `isolation: "worktree"`, the full text of its prompt (everything below the prompt's
  line) and the branch it names. Set the model and effort explicitly on every call: Opus at high for prompts 1, 2, 3
  and 4. Never use xhigh, low, or Sonnet below high.
- **The main checkout.** Another session has uncommitted work in it, so nobody edits it. Every change lands on the
  prompts' branches.
- **Files.** Each prompt owns its files as its text says: prompt 1 owns `contracts/`, `packages/shared/` and
  `deployments/`; prompt 2 owns `apps/relayer/` and `apps/demo-box/`; prompt 3 owns `apps/web/`. When one needs a
  change in another's files, it asks you, and you route the request to the owner.

## Order

1. **Pre-flight**, done by you with read-only checks. Report them to George in one short list:
   - `gamebox.eth` on Sepolia ENSv2 is owned by `sepolia-deployer` (`0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E`);
   - the balances of the deployer (it needs about 0.1 ETH) and of the relayer `sepolia-relayer`
     (`0x09a6f8C0194246c365bB42122E872626460F8a71`, which needs 0.2 ETH before prompt 2's live test);
   - `.env` exists with `ALCHEMY_API_KEY`, and `ETHERSCAN_API_KEY` is set;
   - `forge` and `wrangler` are installed and logged in (`wrangler whoami`).

   A missing item stops only the step that needs it, not the whole run.
2. **Prompt 1** starts. Once it has pushed its first commit (interfaces, `packages/shared/src/names/`, and the `ens`
   block of `deployments/sepolia.json`), check that commit yourself against `plan/ens/README.md`: the three
   EIP-712 types, the role names and the record keys.
3. **Prompts 2 and 3** start in parallel from that commit, while prompt 1 carries on with the implementation, tests,
   deploy and verification.
   - Pass the deployed addresses and the Worker URLs on as they land.
   - When prompt 3 shows its two design comps, put them in front of George and wait for his pick. Then send the pick
     back to that agent (`SendMessage`), so it keeps its context.
4. **When all three PRs are open**, prompt 4 reviews them, in a fresh agent given only the prompt and the branches,
   not your view of them. Fix what it marks "must fix before merge" through the agent that owns those files, then
   re-run the checks that finding touched.
5. **Report to George.** Before you report, run these checks yourself:
   - `pnpm typecheck`, `pnpm test` and `pnpm contracts:test` on each branch;
   - `pnpm names:check` and `pnpm names:verify` against the live deployment;
   - the site's live URL, at desktop and phone width in the built-in browser, with the whole story run once, muted.

## Rules for the whole run

- **Wallets.** Deploys use the `sepolia-deployer` keystore (`--account sepolia-deployer --password ''`). The relayer
  wallet holds gas only. Never print, log or commit a private key or an RPC URL with its key. Don't send ETH between
  wallets: funding is George's step. If a wallet runs low, stop that step and tell him how much it needs.
- **Gas.** Use a 1–2 gwei tip and the explicit gas limits from `plan/ens/README.md`. Keep a running total of the ETH
  spent.
- **`gamebox.eth`.** Don't revoke any role on it. Locking its subregistry is irreversible, and that decision is
  George's.
- **Commits and PRs.**
  - Commits are small and carry the team trailers from `CLAUDE.md`.
  - Each prompt ends in its own PR into `main`.
  - Open PRs, but merge nothing without George's yes.
- **Docs.** Docs and READMEs describe the project as it is. They never refer to earlier or outside work.

## Done when

George gets one message with:

- the live site URL;
- the three PR links;
- every deployed contract with its Etherscan link and verified status;
- the Sepolia gas measured per action and the total ETH spent;
- the review's findings, and what was fixed;
- anything left open, named as open.
