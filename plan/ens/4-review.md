# Prompt 4: an independent review of the names build

Paste everything below the line into a fresh Claude Code session in `~/Workspace/ethereum-game-box`, once prompts
1–3 have opened their PRs.

---

You are reviewing the Game Box's ENS names build before it merges. It comes as three PRs, on branches
`names-contracts`, `names-relayer` and `names-site`. Read `CLAUDE.md` and `plan/ens/README.md` (the design and the ENS
brief), then the code and the tests. Don't read the PR descriptions until you have formed your own view: judge the
code, not its summary. Review only; change nothing. Use Opus at high for any subagent.

Check, and report each finding with a file, a line and a concrete failure (the input or the state that goes wrong):

1. **Contracts.**
   - Can anyone, through any sequence of calls, take, re-point, transfer or write to a name they don't own?
   - Can a revoked player block a result?
   - Can a result be replayed, or signed by a Box whose name has expired or is suspended?
   - Is `isEmancipated()` true on `gamebox.eth`'s registry?
   - Does `GameBoxNames` keep any role on a player resolver?
   - Is any role bit or resource computed differently from the ENSv2 source on `deploy/mainnet-v2-20261002`?
   - Do the P-256 checks fail closed?
   - Does an expired pop-up ever keep serving `mumbai-01`'s records?
   - Can the wildcard default ever answer for a registered name?
   - Can `LINK` on a Box resolver be used to point one Box at another Box's record?
   - Is the canonical parent locked on every registry we created?
   - Does `handOverRegistrar` leave `GameBoxNames` with nothing?
   - Does Box key rotation fully cut the old account and the old key off?
2. **Live deployment.**
   - Run `pnpm names:check` and `pnpm names:verify` yourself.
   - Read the roles on chain for one Box name, one player name and each title.
   - Confirm that every deployed contract shows verified on Etherscan (the v2 API's `getsourcecode`), and list any
     that doesn't.
3. **Relayer and demo Box.**
   - Is any gas spent before the checks pass?
   - Can the allowlist be bypassed with a different selector, target or ABI encoding?
   - Do the rate limits hold across Durable Object instances?
   - Do secrets or the RPC URL ever reach a response or a log?
   - Is the nonce queue safe under parallel requests?
4. **Site.**
   - Does any value on screen come from anywhere other than chain or the relayer?
   - Does a name that has stopped resolving ever show a stale value?
   - Does the Try grid's decoding match real reverts?
   - Does the story run twice in a row on the live site?
   - Is the layout usable at phone width?
5. **The ENS brief.**
   - For each row of the brief's table in `plan/ens/README.md`, open the live site and say whether a judge would see
     it within the story, and what's missing.
   - Is anything hard-coded that the brief would call fake?
6. **Repo rules from `CLAUDE.md`.**
   - No hard-coded addresses.
   - No dead code.
   - No copy-paste between packages.
   - Every folder's README is current.
   - The commit trailers are there.

End with the findings ranked by severity, and a short list of what must be fixed before merge and what can wait.
