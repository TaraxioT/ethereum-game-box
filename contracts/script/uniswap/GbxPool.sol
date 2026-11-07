// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice The GBX/USDC pool's opening: its price, its range and the first deposit.
library GbxPool {
    /// @dev About 0.10 USDC per GBX when GBX is `currency0`, a multiple of the tick spacing (60):
    ///      1.0001^-299340 × 1e18 / 1e6 ≈ 0.1002. Negate it when USDC is `currency0`.
    int24 internal constant PRICE_TICK = -299_340;
    /// @dev The widest range on a tick spacing of 60.
    int24 internal constant FULL_RANGE_TICK = 887_220;
    /// @dev The first deposit: 1,000,000 GBX against 100,000 USDC, both sides at the opening price.
    uint256 internal constant SEED_GBX = 1_000_000 ether;
    uint256 internal constant SEED_USDC = 100_000e6;

    /// @notice The opening price, given the pool's token order.
    function sqrtPriceX96(bool gbxIsToken0) internal pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(gbxIsToken0 ? PRICE_TICK : -PRICE_TICK);
    }
}
