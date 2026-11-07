# Uniswap usage

## Submission description

Ethereum Game Box uses Uniswap in two places.

**A v4 hook on Sepolia.** GBX is the token operators stake to license a Box. It trades against test USDC in a
Uniswap v4 pool whose hook, `GameBoxHook`, sets the fee on every swap:

- 1% by default;
- 0.25% when the swap carries a `TapSwap` signed by a licensed Box's P-256 hardware key (checked with `P256VERIFY`
  against the Box's ENS record);
- 0% for fee-exempt routers.

The hook also writes a TWAP oracle on every swap. `GameBoxLobby` is our own v4 router. One badge tap buys GBX at
the tap fee, and the GBX goes to the badge, or to the Box's stake once the Box is bonded. The relayer simulates
each buy and sends it with 2% slippage protection.

**Live Uniswap prices in a game.** Stock Duel Uniswap is a card game played with tokenized stocks. Each card's
stats (price, momentum, volatility, depth) are read every five minutes from the stock's Uniswap v3 or v4 pool
against USDG on Robinhood Chain mainnet. The read uses `slot0` on v3 and `StateView` on v4, in one Multicall3 call.
The original Stock Duel keeps a frozen deck, so the two can be compared side by side.

What we hit along the way is in [FEEDBACK.md](FEEDBACK.md).

## Where Uniswap is used

| Use | What the code does | GitHub code |
| --- | --- | --- |
| v4 hook permissions | Validates `afterInitialize` and `beforeSwap` against the mined address in the constructor. | [GameBoxHook.sol:59-86](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/contracts/src/hook/GameBoxHook.sol#L59-L86) |
| Dynamic fee per swap | `beforeSwap` writes the oracle, picks 1%, 0.25% or 0%, and returns it with `OVERRIDE_FEE_FLAG`. | [GameBoxHook.sol:101-117](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/contracts/src/hook/GameBoxHook.sol#L101-L117) · [fees:32-38](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/contracts/src/hook/GameBoxHook.sol#L32-L38) |
| Box-signed tap fee | Decodes `hookData`, checks the Box's license and key in `GameBoxNames`, burns the nonce, and verifies the P-256 signature over an EIP-712 `TapSwap`. | [GameBoxHook.sol:156-202](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/contracts/src/hook/GameBoxHook.sol#L156-L202) |
| One pool only | `afterInitialize` accepts only the hook's own GBX/USDC key, once, and starts the oracle. The key uses `DYNAMIC_FEE_FLAG`. | [GameBoxHook.sol:88-99](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/contracts/src/hook/GameBoxHook.sol#L88-L99) · [poolKey:143-154](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/contracts/src/hook/GameBoxHook.sol#L143-L154) |
| TWAP oracle | A 512-slot ring of tick observations, written in `beforeSwap`, read as a mean tick over a window. | [PriceOracle.sol:37-112](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/contracts/src/hook/PriceOracle.sol#L37-L112) |
| Hook address mining | Finds a CREATE2 salt whose address carries the hook's permission bits, then deploys and records the pool key. | [HookMiner.sol:19-32](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/contracts/script/HookMiner.sol#L19-L32) · [DeployHook.s.sol](contracts/script/DeployHook.s.sol) |
| Own v4 router | `GameBoxLobby.buy` unlocks the `PoolManager`, swaps with the Box's signature as `hookData`, mints the owed USDC to the `PoolManager` (`sync`/`settle`), takes the GBX, and stakes it for a bonded Box. | [GameBoxLobby.sol:50-100](contracts/src/hook/GameBoxLobby.sol#L50-L100) |
| Seeding through PositionManager | Initializes the pool, refuses a pool opened at another price, sizes liquidity with `LiquidityAmounts`, approves through Permit2, and mints a position with `modifyLiquidities`. | [PoolSeed.sol:52-90](contracts/script/uniswap/PoolSeed.sol#L52-L90) · [SeedPool.s.sol](contracts/script/SeedPool.s.sol) |
| Signed swap off chain | The `TapSwap` EIP-712 types the Box signs, and the relayer's simulate-then-send buy with 2% slippage. | [tapSwap.ts:1-20](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/packages/shared/src/swap/tapSwap.ts#L1-L20) · [buy.ts:42-71](apps/relayer/src/requests/buy.ts#L42-L71) |
| v3 and v4 pool reads | One Multicall3 call at a fixed block reads v3 `slot0`/`liquidity` by address and v4 `StateView.getSlot0`/`getLiquidity` by pool id. | [reads.ts:44-81](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/packages/shared/src/market/reads.ts#L44-L81) |
| Price and depth from a pool | Turns `sqrtPriceX96` into a USD price (with the ERC-8056 `uiMultiplier`) and liquidity into the USD needed to move the price ±2%. | [stats.ts:34-64](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/packages/shared/src/market/stats.ts#L34-L64) |
| Pool discovery | Asks the v3 factory for every fee tier, and computes hookless v4 pool ids over 9 fees × 6 tick spacings. | [discover.ts:18-67](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/packages/shared/scripts/market/discover.ts#L18-L67) |
| Live deck in the game | The Box refreshes the market every five minutes. Stock Duel Uniswap alone deals from it. | [market.ts:26-56](apps/box/src/chain/market.ts#L26-L56) · [catalogue.ts:56](apps/box/src/core/catalogue.ts#L56) · [core.ts:736](apps/box/src/core/core.ts#L736) |

## Explore it

- [GameBoxHook on Sepolia](https://sepolia.etherscan.io/address/0xF4BbB7CCF834183d143b3c77C2C96331bb51D080).
- [The v4 PoolManager on Sepolia](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543).
- [GBX/USDC pool key and hook address](deployments/sepolia.json) (`pools.GBX_USDC`).
- [Robinhood Chain stock pools](https://github.com/TaraxioT/ethereum-game-box/blob/edb81c5163d7d70e3f0426af9a441def29f11947/deployments/robinhood.json): v3 addresses and v4 ids, against USDG.
- Read the live stats yourself: set `ROBINHOOD_RPC_URL` in `.env`, then run `pnpm run market:read`.
- The hook, seed and lobby are explained in [contracts/README.md](contracts/README.md#swap-hook). Forge tests:
  `pnpm contracts:test`.

`GameBoxLobby` and the pool seed are written and tested with forge, but not yet deployed or run on Sepolia.

Links with a commit hash are permalinks pinned to `edb81c5`. Relative links point at code that landed after it.
