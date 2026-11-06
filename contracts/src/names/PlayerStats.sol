// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IGameBoxNames} from "./IGameBoxNames.sol";
import {IPermissionedResolver} from "./IENSv2.sol";
import {IPlayerStats} from "./IPlayerStats.sol";
import {NameLib} from "./NameLib.sol";

/// @title PlayerStats
/// @notice Counts results per player and game, and writes each player's `stats` text record (see `IPlayerStats`).
contract PlayerStats is IPlayerStats {
    using Strings for uint256;

    /// @notice The gas a `stats` write may use. A player's resolver is the badge's to upgrade, so the write runs with
    ///         this cap and its failure is caught: no resolver can block the opponent's result.
    uint256 public constant STATS_WRITE_GAS = 400_000;

    /// @inheritdoc IPlayerStats
    IGameBoxNames public immutable NAMES;

    mapping(address player => mapping(uint256 gameId => Record)) private _records;
    mapping(address player => string[] games) private _played;

    /// @param names The registrar whose referees and players this contract trusts.
    constructor(IGameBoxNames names) {
        NAMES = names;
    }

    /// @inheritdoc IPlayerStats
    function record(string calldata game, address winner, address loser, bool draw) external {
        if (!NAMES.hasRole(NAMES.REFEREE_ROLE(), msg.sender)) revert NotReferee(msg.sender);
        if (NAMES.getGame(game).titleRegistry == address(0)) revert UnknownGame(game);
        if (winner == loser) revert SamePlayer(winner);
        string memory winnerLabel = NAMES.labelOf(winner);
        if (bytes(winnerLabel).length == 0) revert NotAPlayer(winner);
        string memory loserLabel = NAMES.labelOf(loser);
        if (bytes(loserLabel).length == 0) revert NotAPlayer(loser);

        uint256 gameId = NameLib.id(game);
        Record storage w = _entry(winner, game, gameId);
        Record storage l = _entry(loser, game, gameId);
        if (draw) {
            ++w.draws;
            ++l.draws;
        } else {
            ++w.wins;
            ++l.losses;
        }
        emit ResultRecorded(game, winner, loser, draw);
        _write(winner, winnerLabel);
        _write(loser, loserLabel);
    }

    /// @inheritdoc IPlayerStats
    function statsOf(address player, string calldata game) external view returns (Record memory) {
        return _records[player][NameLib.id(game)];
    }

    /// @inheritdoc IPlayerStats
    function statsText(address player) public view returns (string memory text) {
        string[] storage games = _played[player];
        text = "{";
        for (uint256 i; i < games.length; ++i) {
            Record storage r = _records[player][NameLib.id(games[i])];
            text = string.concat(
                text,
                i == 0 ? '"' : ',"',
                games[i],
                '":{"wins":',
                uint256(r.wins).toString(),
                ',"losses":',
                uint256(r.losses).toString(),
                ',"draws":',
                uint256(r.draws).toString(),
                "}"
            );
        }
        text = string.concat(text, "}");
    }

    function _entry(address player, string calldata game, uint256 gameId) private returns (Record storage r) {
        r = _records[player][gameId];
        if (r.wins == 0 && r.losses == 0 && r.draws == 0) _played[player].push(game);
    }

    /// @dev Writes `stats` on the player's current resolver with a gas cap, and skips the player if it fails.
    function _write(address player, string memory label) private {
        string memory value = statsText(player);
        address resolver = NAMES.REGISTRY().getResolver(label);
        bytes memory data = abi.encodeCall(IPermissionedResolver.setText, (NameLib.dnsName(label), "stats", value));
        // Refuse to start a write that can't get its full allowance, so a caller can't force a skip by sending too
        // little gas (a call gets at most 63/64 of what is left).
        if (gasleft() < STATS_WRITE_GAS + STATS_WRITE_GAS / 63 + 10_000) revert InsufficientGas();
        bool ok;
        if (resolver.code.length != 0) {
            assembly ("memory-safe") {
                ok := call(STATS_WRITE_GAS, resolver, 0, add(data, 32), mload(data), 0, 0)
            }
        }
        if (ok) emit StatsWritten(player, value);
        else emit StatsSkipped(player);
    }
}
