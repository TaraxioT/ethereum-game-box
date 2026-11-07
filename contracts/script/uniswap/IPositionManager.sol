// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The part of Uniswap v4's `PositionManager` (v4-periphery) the pool seed uses: one batch of actions, and
///         the id the next position will get. Positions are ERC-721s.
interface IPositionManager {
    /// @param unlockData `abi.encode(bytes actions, bytes[] params)`, one action per byte.
    /// @param deadline The latest timestamp the batch may run at.
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;

    /// @notice The token id the next minted position gets.
    function nextTokenId() external view returns (uint256);

    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice The liquidity of position `tokenId`.
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
}
