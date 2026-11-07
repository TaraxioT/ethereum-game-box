// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";

import {IPermit2} from "./IPermit2.sol";
import {IPositionManager} from "./IPositionManager.sol";

/// @notice Opens a v4 pool at a set price and gives it its first, full-range liquidity as a `PositionManager` position,
///         owned by `owner`. Runs from whoever calls it (a broadcast, or a prank in a test), who pays both tokens.
/// @dev Safe to run again: it skips `initialize` once the pool is open, and the deposit once the pool has liquidity.
///      Anyone can open a v4 pool, so if it was opened at another price it refuses to deposit, rather than add
///      liquidity at a price someone else picked.
library PoolSeed {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    /// @dev `PositionManager`'s action codes (v4-periphery `Actions`).
    uint8 internal constant MINT_POSITION = 0x02;
    uint8 internal constant SETTLE_PAIR = 0x0d;

    /// @param manager The v4 pool manager.
    /// @param positions The v4 `PositionManager`.
    /// @param permit2 The `Permit2` that `positions` pulls through.
    /// @param key The pool.
    /// @param sqrtPriceX96 The price to open it at.
    /// @param tickRange The position spans `[-tickRange, tickRange]`, a multiple of the pool's tick spacing.
    /// @param amount0 The most of `currency0` to deposit.
    /// @param amount1 The most of `currency1` to deposit.
    /// @param owner Who owns the position.
    struct Seed {
        IPoolManager manager;
        IPositionManager positions;
        IPermit2 permit2;
        PoolKey key;
        uint160 sqrtPriceX96;
        int24 tickRange;
        uint256 amount0;
        uint256 amount1;
        address owner;
    }

    /// @return tokenId The new position's id, or zero if the pool already had liquidity.
    function seed(Seed memory s) internal returns (uint256 tokenId) {
        PoolId id = s.key.toId();
        (uint160 price,,,) = s.manager.getSlot0(id);
        if (price == 0) {
            s.manager.initialize(s.key, s.sqrtPriceX96);
            price = s.sqrtPriceX96;
        }
        if (s.manager.getLiquidity(id) > 0) return 0;
        require(price == s.sqrtPriceX96, "PoolSeed: pool opened at another price");

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            price,
            TickMath.getSqrtPriceAtTick(-s.tickRange),
            TickMath.getSqrtPriceAtTick(s.tickRange),
            s.amount0,
            s.amount1
        );
        _allow(s, s.key.currency0, s.amount0);
        _allow(s, s.key.currency1, s.amount1);

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            s.key, -s.tickRange, s.tickRange, uint256(liquidity), uint128(s.amount0), uint128(s.amount1), s.owner, ""
        );
        params[1] = abi.encode(s.key.currency0, s.key.currency1);
        tokenId = s.positions.nextTokenId();
        s.positions
            .modifyLiquidities(
                abi.encode(abi.encodePacked(MINT_POSITION, SETTLE_PAIR), params), block.timestamp + 1 hours
            );
    }

    /// @dev Lets `positions` pull `amount` of `currency` from the caller, through Permit2.
    function _allow(Seed memory s, Currency currency, uint256 amount) private {
        address token = Currency.unwrap(currency);
        IERC20(token).forceApprove(address(s.permit2), amount);
        s.permit2.approve(token, address(s.positions), uint160(amount), uint48(block.timestamp + 1 hours));
    }
}
