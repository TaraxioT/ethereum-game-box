// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

import {IBoxSigned} from "../names/IBoxSigned.sol";
import {IGameBoxNames} from "../names/IGameBoxNames.sol";
import {IFakeUSDC} from "../token/IFakeUSDC.sol";

/// @title IDuelPot
/// @notice The USDC pot of one match. The Box vouches for both players with a signed `Stake`, and `open` pulls the
///         same `amount` from each (as `FakeUSDC`'s game spender, so the badges sign nothing). `BoxResults` settles
///         the pot with the match's result, in the same transaction that crowns and scores it: the winner gets both
///         stakes, and a draw refunds both. A pot nobody settles can be refunded by anyone an hour after it opened.
/// @dev The signed message is EIP-712 `Stake(string box,string game,uint256 round,address a,address b,uint256 amount,
///      uint256 deadline)`, domain `Game Box Stakes`, version `1`, chain id and this contract, signed with the Box's
///      P-256 key (`GameBoxNames.boxKey`) over the raw digest, low `s`. The round number is the shared key: a match's
///      `Stake` and its `Result` carry the same `(box, round)`. Anyone may submit a signed stake; the relayer does.
interface IDuelPot is IBoxSigned, IERC5267 {
    /// @notice What a Box signs to open a pot.
    /// @param box The Box's label (`mumbai-01`).
    /// @param game The game's label (`stockduel`).
    /// @param round The Box's round number: the same as the match's `Result`.
    /// @param a One player's badge.
    /// @param b The other player's badge.
    /// @param amount Each player's stake, in USDC base units (6 decimals).
    /// @param deadline The last timestamp the stake may be opened at.
    struct Stake {
        string box;
        string game;
        uint256 round;
        address a;
        address b;
        uint256 amount;
        uint256 deadline;
    }

    /// @notice A pot's state. `None` means `(box, round)` never had a pot.
    enum State {
        None,
        Open,
        Settled,
        Refunded
    }

    /// @notice A pot.
    /// @param a One player's badge.
    /// @param b The other player's badge.
    /// @param amount Each player's stake; the pot holds twice this while open.
    /// @param opened When it opened (unix seconds).
    /// @param state Its state.
    /// @param game The keccak256 of the game's label.
    struct Pot {
        address a;
        address b;
        uint256 amount;
        uint64 opened;
        State state;
        bytes32 game;
    }

    /// @notice A pot opened: `amount` was pulled from each player.
    event PotOpened(
        string box, string game, uint256 indexed round, address indexed a, address indexed b, uint256 amount
    );
    /// @notice A pot was settled by a result: `winner` got `2 * amount`, or on a draw both got `amount` back.
    event PotSettled(string box, uint256 indexed round, address indexed winner, bool draw, uint256 amount);
    /// @notice An unsettled pot was refunded an hour after it opened: both players got `amount` back.
    event PotRefunded(string box, uint256 indexed round, uint256 amount);

    /// @notice The two players are the same badge.
    error SamePlayer(address player);
    /// @notice A stake of zero.
    error ZeroAmount();
    /// @notice `(box, round)` already had a pot.
    error PotExists(string box, uint256 round);
    /// @notice `(box, round)` has no open pot.
    error PotNotOpen(string box, uint256 round);
    /// @notice The result's game or players are not the pot's.
    error PotMismatch(string box, uint256 round);
    /// @notice A refund before `opened + REFUND_DELAY`.
    error TooEarly(uint256 refundableAt);
    /// @notice The caller does not hold `GameBoxNames`' `REFEREE_ROLE`.
    error NotReferee(address caller);

    /// @notice Checks a Box-signed stake and opens its pot: pulls `amount` from `a` and from `b`. It refuses an expired
    ///         deadline, an unknown, expired or not `Active` Box, a bad signature, `a == b`, a zero amount and a
    ///         `(box, round)` that had a pot before. A player without the balance makes it revert.
    /// @param stake The stake.
    /// @param r The P-256 signature's `r`.
    /// @param s The P-256 signature's `s` (low).
    function open(Stake calldata stake, bytes32 r, bytes32 s) external;

    /// @notice Settles an open pot with its match's result: pays `winner` both stakes, or on a draw refunds both.
    ///         `{winner, loser}` must be the pot's players and `game` its game (`PotMismatch`). Needs `GameBoxNames`'
    ///         `REFEREE_ROLE`: `BoxResults` calls it inside `submit`.
    /// @param box The Box's label.
    /// @param game The game's label.
    /// @param round The round.
    /// @param winner The winner (for a draw, either player).
    /// @param loser The loser (for a draw, the other player).
    /// @param draw Whether the match was drawn.
    function settle(string calldata box, string calldata game, uint256 round, address winner, address loser, bool draw)
        external;

    /// @notice Refunds both players of an open pot nobody settled. Open to anyone from `opened + REFUND_DELAY`.
    /// @param box The Box's label.
    /// @param round The round.
    function refund(string calldata box, uint256 round) external;

    /// @notice The pot of `(box, round)`; `state` is `None` if it never had one.
    function getPot(string calldata box, uint256 round) external view returns (Pot memory);

    /// @notice The EIP-712 digest a Box signs for `stake`.
    function stakeDigest(Stake calldata stake) external view returns (bytes32);

    /// @notice The EIP-712 type hash of `Stake`.
    function STAKE_TYPEHASH() external view returns (bytes32);
    /// @notice How long after `open` anyone may refund an unsettled pot: one hour.
    function REFUND_DELAY() external view returns (uint64);
    /// @notice The registrar Boxes and referees are read from.
    function NAMES() external view returns (IGameBoxNames);
    /// @notice The stake token.
    function USDC() external view returns (IFakeUSDC);
}
