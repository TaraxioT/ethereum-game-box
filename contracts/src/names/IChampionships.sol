// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IFakeUSDC} from "../token/IFakeUSDC.sol";
import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title IChampionships
/// @notice Time-boxed championships, each a name in its game's registry: `<label>.<game>.gamebox.eth`, such as
///         `mumbai-cup.stockduel.gamebox.eth`. At most one is open per game.
///         - **Open** (admin): the name is registered to this contract until `ends + 1 day`, with its own
///           `PermissionedResolver` on which only this contract holds a role (`SET_TEXT`, `SET_ADDRESS` and their
///           admins on the root; nobody holds `UPGRADE`). It writes `ends`, `prize` and `standings` (`[]`), and takes
///           the prize in USDC from the opener.
///         - **Live**: every result `BoxResults` accepts for the game before `ends` scores it (win 3, draw 1, loss 0)
///           and rewrites `standings` (the top 5, JSON), `leader` and `addr` (the leader's badge).
///         - **Close** (anyone, after `ends`): the winner is the player with the most points, then the most wins, then
///           the one who reached that score first. The prize is paid to the winner, the name is unregistered and
///           registered again to the winner with no expiry and token roles 0 (non-transferable), the final
///           `standings`, `winner` and `addr` are written, and this contract revokes every role it holds on the
///           resolver. Nobody holds any role there after that, so the records can never change again. With no players,
///           the prize goes back to the opener, the name is unregistered and the roles are given up all the same.
/// @dev This contract holds `REGISTRAR`, `RENEW` and `UNREGISTER` on the root of every game's registry (granted by
///      `GameBoxNames.setChampionships` and `addGame`), because it needs them to open the next championship. No function
///      touches a closed one. Record values: `ends` is unix seconds, `prize` is USDC base units (6 decimals), `leader`
///      and `winner` are player names (`nova.gamebox.eth`), and `standings` is a JSON array in rank order of
///      `{"name":"nova.gamebox.eth","addr":"0x…","points":6,"wins":2,"draws":0,"losses":1}`.
interface IChampionships is IAccessControl {
    /// @notice A championship.
    /// @param game The game's label.
    /// @param label The championship's label: the name is `<label>.<game>.gamebox.eth`.
    /// @param resolver The name's own resolver.
    /// @param opener Who opened it and paid the prize.
    /// @param ends When scoring stops and `close` may run (unix seconds).
    /// @param prize The prize, in USDC base units.
    /// @param closed Whether it was closed.
    /// @param winner The winner's badge once closed, or zero (also when nobody played).
    struct Cup {
        string game;
        string label;
        address resolver;
        address opener;
        uint64 ends;
        uint256 prize;
        bool closed;
        address winner;
    }

    /// @notice A player's score in one championship.
    /// @param points Win 3, draw 1, loss 0.
    /// @param wins Wins.
    /// @param draws Draws.
    /// @param losses Losses.
    /// @param reached The order in which the player reached `points` (lower is earlier): the last tiebreak.
    struct Entry {
        uint32 points;
        uint32 wins;
        uint32 draws;
        uint32 losses;
        uint64 reached;
    }

    /// @notice A championship opened.
    event CupOpened(
        uint256 indexed id, string game, string label, address resolver, uint64 ends, uint256 prize, address opener
    );
    /// @notice A result scored in a championship.
    event CupScored(uint256 indexed id, address indexed winner, address indexed loser, bool draw, address leader);
    /// @notice A championship closed: `winner` holds the name for good and got `prize` (zero winner: nobody played,
    ///         and the prize went back to the opener).
    event CupClosed(uint256 indexed id, string game, string label, address indexed winner, uint256 prize);

    /// @notice The game is not registered in `GameBoxNames`.
    error UnknownGame(string game);
    /// @notice The label breaks the label rule, or is `champion` (the game's title).
    error InvalidLabel(string label);
    /// @notice The game has an open championship already.
    error CupAlreadyOpen(string game, uint256 id);
    /// @notice The game has no open championship.
    error NoOpenCup(string game);
    /// @notice `ends` is not in the future.
    error EndsInPast(uint64 ends);
    /// @notice `close` before `ends`.
    error NotOver(uint64 ends);
    /// @notice The caller does not hold `GameBoxNames`' `REFEREE_ROLE`.
    error NotReferee(address caller);

    /// @notice Opens a championship for `game`: registers `<label>.<game>.gamebox.eth` to this contract until
    ///         `ends + 1 day` with a new resolver, writes `ends`, `prize` and `standings` (`[]`), and takes `prize` USDC
    ///         from the caller (approve it first). Needs `DEFAULT_ADMIN_ROLE`. One open championship per game.
    /// @param game The game's label.
    /// @param label The championship's label (the label rule; not `champion`; not a name in the game's registry).
    /// @param ends When scoring stops (unix seconds, in the future).
    /// @param prize The prize, in USDC base units.
    /// @return id The championship's id.
    function open(string calldata game, string calldata label, uint64 ends, uint256 prize) external returns (uint256 id);

    /// @notice Scores a result in `game`'s open championship and rewrites `standings`, `leader` and `addr`. Does
    ///         nothing when no championship is open for the game or it has ended. Needs `GameBoxNames`'
    ///         `REFEREE_ROLE`: `BoxResults` calls it inside `submit`, in a `try` with a gas cap.
    /// @param game The game's label.
    /// @param winner The winner (for a draw, either player).
    /// @param loser The loser (for a draw, the other player).
    /// @param draw Whether the match was drawn.
    function score(string calldata game, address winner, address loser, bool draw) external;

    /// @notice Closes `game`'s open championship after `ends`: pays the prize, gives the name to the winner for good,
    ///         writes the final records and revokes every role this contract holds on the name's resolver. Open to
    ///         anyone.
    /// @param game The game's label.
    /// @return winner The winner's badge, or zero if nobody played.
    function close(string calldata game) external returns (address winner);

    /// @notice The id of `game`'s open championship, or 0.
    function openCup(string calldata game) external view returns (uint256);
    /// @notice Championship `id` (ids start at 1).
    function getCup(uint256 id) external view returns (Cup memory);
    /// @notice The top 5 of championship `id`, in rank order.
    function top(uint256 id) external view returns (address[] memory);
    /// @notice `player`'s score in championship `id`.
    function entryOf(uint256 id, address player) external view returns (Entry memory);
    /// @notice The `standings` JSON of championship `id`, as written to its name.
    function standingsText(uint256 id) external view returns (string memory);
    /// @notice How many championships were ever opened (the last id).
    function cupCount() external view returns (uint256);

    /// @notice The registrar whose game registries the championship names live in, and whose referees score.
    function NAMES() external view returns (IGameBoxNames);
    /// @notice The prize token.
    function USDC() external view returns (IFakeUSDC);
    /// @notice How long after `ends` the name stays registered to this contract if nobody closes it: one day.
    function GRACE() external view returns (uint64);
    /// @notice How many players `standings` lists: 5.
    function TOP() external view returns (uint256);
}
