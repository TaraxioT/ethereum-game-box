// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

import {IGameBoxNames} from "./IGameBoxNames.sol";
import {IPlayerStats} from "./IPlayerStats.sol";

/// @title IBoxResults
/// @notice The referee for now: it takes a match result signed by a Box's P-256 key, as registered in `GameBoxNames`,
///         then crowns the winner and records both players' stats. A draw records stats only.
/// @dev The signed message is EIP-712 `Result(string box,string game,uint256 round,address winner,address loser,
///      bool draw,uint256 deadline)`, domain `Game Box Results`, version `1`, chain id and this contract. The Box
///      signs the raw 32-byte digest (ECDSA P-256 with no prehash: the precompile gets the digest itself as `h`), and
///      the signature must have a low `s`. Anyone may submit a signed result; the relayer does.
interface IBoxResults is IERC5267 {
    /// @notice A finished match, as the Box signs it.
    /// @param box The Box's label (`mumbai-01`, not the full name).
    /// @param game The game's label.
    /// @param round The Box's round number. Each `(box, round)` counts once.
    /// @param winner The winner's badge (for a draw, either player).
    /// @param loser The loser's badge (for a draw, the other player).
    /// @param draw Whether the match was drawn.
    /// @param deadline The last timestamp the result may be submitted at.
    struct Result {
        string box;
        string game;
        uint256 round;
        address winner;
        address loser;
        bool draw;
        uint256 deadline;
    }

    /// @notice A result was accepted.
    event ResultSubmitted(
        string box, string game, uint256 indexed round, address indexed winner, address indexed loser, bool draw
    );

    /// @notice No Box was ever registered under the label.
    error UnknownBox(string box);
    /// @notice The Box's licence (its name) has expired.
    error BoxExpired(string box);
    /// @notice The Box's `status` is not `active`.
    error BoxNotActive(string box);
    /// @notice This `(box, round)` was already submitted.
    error RoundUsed(string box, uint256 round);
    /// @notice The deadline has passed.
    error DeadlineExpired(uint256 deadline);
    /// @notice The winner or the loser holds no player name.
    error NotAPlayer(address account);
    /// @notice The winner and the loser are the same account.
    error SamePlayer(address account);
    /// @notice The P-256 signature does not verify against the Box's key, or its `s` is high.
    error InvalidSignature();

    /// @notice Checks a Box-signed result and settles it: `crown` (unless a draw) and `PlayerStats.record`.
    /// @param result The result.
    /// @param r The P-256 signature's `r`.
    /// @param s The P-256 signature's `s` (low).
    function submit(Result calldata result, bytes32 r, bytes32 s) external;

    /// @notice The EIP-712 digest a Box signs for `result`.
    /// @param result The result.
    /// @return The digest.
    function resultDigest(Result calldata result) external view returns (bytes32);

    /// @notice Whether `(box, round)` was already submitted.
    /// @param box The Box's label.
    /// @param round The round.
    /// @return True once a result for it was accepted.
    function roundUsed(string calldata box, uint256 round) external view returns (bool);

    /// @notice The EIP-712 type hash of `Result`.
    function RESULT_TYPEHASH() external view returns (bytes32);
    /// @notice The registrar this referee reads Boxes and players from and crowns through.
    function NAMES() external view returns (IGameBoxNames);
    /// @notice The stats writer this referee records results with.
    function STATS() external view returns (IPlayerStats);
}
