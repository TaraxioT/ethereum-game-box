// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title IPlayerStats
/// @notice The only `stats` writer the player resolvers know about. It counts wins, losses and draws per player and
///         game on chain, and writes each player's `stats` text record. It takes results only from an account with
///         `GameBoxNames`' `REFEREE_ROLE`. A player who revoked its role on `stats` is skipped with `StatsSkipped`:
///         its counts still move, its record isn't written, and its opponent's result always settles.
/// @dev `stats` is JSON with one entry per game the player has played, in the order first played, e.g.
///      `{"stockduel":{"wins":2,"losses":1,"draws":0}}`.
interface IPlayerStats {
    /// @notice A player's record in one game.
    struct Record {
        uint64 wins;
        uint64 losses;
        uint64 draws;
    }

    /// @notice A result was counted.
    event ResultRecorded(string game, address indexed winner, address indexed loser, bool draw);
    /// @notice A player's `stats` record was written.
    event StatsWritten(address indexed player, string value);
    /// @notice A player's `stats` record could not be written (its role was revoked, or its resolver refused), so it
    ///         was skipped.
    event StatsSkipped(address indexed player);

    /// @notice The caller does not hold `GameBoxNames`' `REFEREE_ROLE`.
    error NotReferee(address caller);
    /// @notice The game is not registered in `GameBoxNames`.
    error UnknownGame(string game);
    /// @notice The account holds no player name.
    error NotAPlayer(address account);
    /// @notice The winner and the loser are the same account.
    error SamePlayer(address account);

    /// @notice Counts a result and writes both players' `stats`. Needs `GameBoxNames`' `REFEREE_ROLE`.
    /// @param game The game's label.
    /// @param winner The winner's badge (for a draw, either player).
    /// @param loser The loser's badge (for a draw, the other player).
    /// @param draw Whether the match was drawn.
    function record(string calldata game, address winner, address loser, bool draw) external;

    /// @notice A player's record in one game.
    /// @param player The player's badge.
    /// @param game The game's label.
    /// @return The record.
    function statsOf(address player, string calldata game) external view returns (Record memory);

    /// @notice The `stats` text the player's record holds (or would hold, if it was skipped).
    /// @param player The player's badge.
    /// @return The JSON text.
    function statsText(address player) external view returns (string memory);

    /// @notice The registrar whose referees and players this contract trusts.
    function NAMES() external view returns (IGameBoxNames);
}
