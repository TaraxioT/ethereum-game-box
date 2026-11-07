// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The part of Uniswap's `Permit2` the pool seed uses: an allowance for a spender, such as the v4
///         `PositionManager`, which pulls tokens through Permit2 rather than with `transferFrom`.
interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}
