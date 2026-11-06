// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title IPlayerStats
/// @notice The only `stats` writer the player resolvers know about, and the only `leaderboard` writer on
///         `gamebox.eth`. It counts each player's results on chain, in every game together and game by game, and
///         writes them to the player's own name. It takes results only from an account with `GameBoxNames`'
///         `REFEREE_ROLE`. A player who revoked its role on `stats` is skipped with `StatsSkipped`: its counts still
///         move, its record isn't written, and its opponent's result always settles. The leaderboard is written the
///         same way: a refused write is skipped with `LeaderboardSkipped` and never blocks a result.
/// @dev `stats` is JSON: the totals over every game, then each game the player has played, in the order first played:
///      `{"played":3,"wins":2,"losses":1,"draws":0,"streak":1,"best":1,"games":{"stockduel":{"wins":2,"losses":1,"draws":0}}}`.
///      `streak` is the player's run of wins right now, in any game: a loss or a draw ends it. `best` is the longest.
///      `leaderboard` is a JSON array of the top `TOP` players in rank order (most wins, then who reached that many
///      first): `[{"name":"alice.gamebox.eth","played":3,"wins":2,"losses":1,"draws":0,"streak":1,"best":1}]`.
interface IPlayerStats {
    /// @notice A player's record in one game.
    struct Record {
        uint64 wins;
        uint64 losses;
        uint64 draws;
    }

    /// @notice A player's record over every game.
    /// @param wins Wins.
    /// @param losses Losses.
    /// @param draws Draws.
    /// @param streak Wins in a row, up to now: a loss or a draw sets it to 0.
    /// @param best The longest `streak` the player ever had.
    /// @param reached The order in which the player reached `wins` (lower is earlier): the leaderboard's tiebreak.
    struct Totals {
        uint32 wins;
        uint32 losses;
        uint32 draws;
        uint32 streak;
        uint32 best;
        uint64 reached;
    }

    /// @notice A result was counted.
    event ResultRecorded(string game, address indexed winner, address indexed loser, bool draw);
    /// @notice A player's `stats` record was written.
    event StatsWritten(address indexed player, string value);
    /// @notice A player's `stats` record could not be written (its role was revoked, or its resolver refused), so it
    ///         was skipped.
    event StatsSkipped(address indexed player);
    /// @notice `gamebox.eth`'s `leaderboard` record was written.
    event LeaderboardWritten(string value);
    /// @notice `gamebox.eth`'s `leaderboard` record could not be written (no role on its resolver), so it was skipped.
    event LeaderboardSkipped();

    /// @notice The caller does not hold `GameBoxNames`' `REFEREE_ROLE`.
    error NotReferee(address caller);
    /// @notice The game is not registered in `GameBoxNames`.
    error UnknownGame(string game);
    /// @notice The account holds no player name.
    error NotAPlayer(address account);
    /// @notice The winner and the loser are the same account.
    error SamePlayer(address account);
    /// @notice Too little gas is left to give a write its full allowance, so a skip could be forced.
    error InsufficientGas();

    /// @notice Counts a result, writes both players' `stats` and rewrites `gamebox.eth`'s `leaderboard`. Needs
    ///         `GameBoxNames`' `REFEREE_ROLE`.
    /// @param game The game's label.
    /// @param winner The winner's badge (for a draw, either player).
    /// @param loser The loser's badge (for a draw, the other player).
    /// @param draw Whether the match was drawn.
    function record(string calldata game, address winner, address loser, bool draw) external;

    /// @notice A player's record in one game.
    function statsOf(address player, string calldata game) external view returns (Record memory);

    /// @notice A player's record over every game.
    function totalsOf(address player) external view returns (Totals memory);

    /// @notice The `stats` text the player's record holds (or would hold, if it was skipped).
    function statsText(address player) external view returns (string memory);

    /// @notice The top players, in rank order (at most `TOP`).
    function leaders() external view returns (address[] memory);

    /// @notice The `leaderboard` text `gamebox.eth` holds (or would hold, if it was skipped).
    function leaderboardText() external view returns (string memory);

    /// @notice The registrar whose referees and players this contract trusts.
    function NAMES() external view returns (IGameBoxNames);

    /// @notice How many players the leaderboard lists: 10.
    function TOP() external view returns (uint256);
}
