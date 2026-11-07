# Uniswap feedback

What we ran into while building Ethereum Game Box with Uniswap v4, Permit2 and Uniswap v3/v4 pool reads. There is
one row per problem: what we tried, what happened, and what would have helped. [uniswap-usage.md](uniswap-usage.md)
says where each piece lives in the code.

We built two things:

- **`GameBoxHook` on Sepolia.** A v4 hook on the GBX/USDC pool with a dynamic fee. A swap signed by a Game Box's
  P-256 key pays 0.25% instead of 1%. A TWAP oracle is written on every swap.
- **Stock Duel Uniswap.** A card game whose stock stats are read live from Uniswap v3 and v4 pools on Robinhood
  Chain mainnet.

We did not get to the Continuous Clearing Auction.

## v4 hook and pool (Sepolia)

| Step | Area | Problem | What would have helped |
|---|---|---|---|
| 1. Hook skeleton | v4-core | Implementing `IHooks` directly needed a stub for every callback we don't use. We wrote 9 functions that only revert. `BaseHook` lives in v4-periphery, which we didn't otherwise need. | A minimal `BaseHook` in v4-core, or a hooks template that only asks for the callbacks a hook's flags enable. |
| 2. Hook address | v4-core | The permissions live in the address bits, so the hook has to be deployed with a mined CREATE2 salt. We wrote our own `HookMiner` for the forge script. | A `HookMiner` (or `forge` cheatcode) in v4-core's test utils, with an example deploy script. |
| 3. Dynamic fee | v4-core | A per-swap fee needs `DYNAMIC_FEE_FLAG` in the `PoolKey` and `OVERRIDE_FEE_FLAG` set on the fee that `beforeSwap` returns. We learned both by reading `LPFeeLibrary` and `Hooks`. | One docs page on "a fee per swap from a hook" that shows both flags together, and a revert or event when a dynamic pool's hook returns a fee without the override flag. |
| 4. Who is swapping | v4-core | `beforeSwap` sees the router as `sender`, not the user. To give a discount to swaps a Box signed, the signature had to bind the router address, and our lobby contract became its own router (`unlock` → `swap` → `settle`/`take`). | Guidance on passing a verified user identity through `hookData`, with a reference "hook-aware router" pattern. |
| 5. Pool initialization | v4-core | Anyone can call `initialize` on a key at any price before we do. Our seed script refuses to deposit into a pool opened at another price, and the hook's `afterInitialize` accepts only its own key, once. | A docs note on front-run initialization, and a recommended guard for hooks bound to a single pool. |
| 6. Price oracle | v4-core | v4 has no built-in oracle like v3's `observe`, so we ported the observation ring buffer into our own `PriceOracle` library and write it in `beforeSwap`. | A maintained oracle hook or library in v4-periphery that other hooks can embed. |
| 7. Seeding liquidity | Test routers | We first seeded through `PoolModifyLiquidityTest`. That position belongs to the router, so anyone could remove it. We moved to `PositionManager`. | A clear warning on the test routers that positions they create are not owned by the caller. |
| 8. PositionManager calls | v4-periphery | We only depended on v4-core, so we wrote `IPositionManager` and `IPermit2` ourselves and hard-coded the action bytes (`MINT_POSITION = 0x02`, `SETTLE_PAIR = 0x0d`). The `modifyLiquidities` payload (actions plus one encoded params entry each) had to be built by hand. | A tiny interfaces-only package (actions, `IPositionManager`, `IPermit2`), so a script can call the deployed periphery without pulling the whole repo. |
| 9. Liquidity maths | v4-core | `LiquidityAmounts` is imported from `v4-core/test/utils`, a test folder, to turn token amounts into liquidity. | `LiquidityAmounts` in `src/libraries`. |
| 10. Permit2 approvals | Permit2 | Seeding takes two approvals per token (ERC-20 → Permit2, then Permit2 → PositionManager with an expiry). | A one-call "approve for PositionManager" helper or a worked forge example. |

## Reading pools (Robinhood Chain mainnet)

| Step | Area | Problem | What would have helped |
|---|---|---|---|
| 11. Finding v4 pools | v4-core | There is no on-chain index of v4 pools. We brute-force pool ids (9 fees × 6 tick spacings, hookless) and check each id's liquidity through `StateView`. | A registry or `PoolManager` view that lists the initialized pools for a currency pair, or an indexer endpoint per chain. |
| 12. Two read paths | v3 and v4 | v3 reads `slot0()` and `liquidity()` on a pool address. v4 reads `StateView.getSlot0(id)` and `getLiquidity(id)`. One multicall carries both shapes. | A shared "pool state" view, or a lens that reads either version by key. |
| 13. Depth | v4 | v4 pools hold no balance of their own (the `PoolManager` holds them all), so token balances can't measure depth. We compute the USD needed to move the price ±2% from liquidity and `sqrtPriceX96`. | A documented helper for "depth within x%" from a v4 pool's liquidity. |
| 14. StateView address | Deployments | We had to find `StateView` and the v3 factory on Robinhood Chain by hand. | A per-chain deployments JSON that lists every v3/v4 contract, including on new L2s. |

## What worked well

- `Hooks.validateHookPermissions` in the constructor caught a wrong address at deploy time.
- `unlock` / `unlockCallback` with `sync`/`settle` made it easy to mint the owed test USDC straight to the
  `PoolManager` inside the swap.
- Multicall3 over `StateView` read 20 pools at one block in a single call.
