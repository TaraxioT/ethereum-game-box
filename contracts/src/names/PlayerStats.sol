// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IGameBoxNames} from "./IGameBoxNames.sol";
import {IPermissionedResolver, IRegistry} from "./IENSv2.sol";
import {IPlayerStats} from "./IPlayerStats.sol";
import {NameLib} from "./NameLib.sol";

/// @title PlayerStats
/// @notice Counts results per player, over every game and game by game, writes each player's `stats` text record and
///         `gamebox.eth`'s `leaderboard` (see `IPlayerStats`).
contract PlayerStats is IPlayerStats {
    using Strings for uint256;

    /// @notice The gas a `stats` write may use. A player's resolver is the badge's to upgrade, so the write runs with
    ///         this cap and its failure is caught: no resolver can block the opponent's result.
    uint256 public constant STATS_WRITE_GAS = 400_000;
    /// @notice The gas the `leaderboard` write may use: its first write stores the whole array.
    uint256 public constant LEADERBOARD_WRITE_GAS = 1_000_000;
    /// @inheritdoc IPlayerStats
    uint256 public constant TOP = 10;

    /// @inheritdoc IPlayerStats
    IGameBoxNames public immutable NAMES;

    mapping(address player => mapping(uint256 gameId => Record)) private _records;
    mapping(address player => string[] games) private _played;
    mapping(address player => Totals) private _totals;
    address[] private _top;
    uint64 private _seq;

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
        // Three capped writes follow: refuse to start unless each can get its full allowance, so a caller can't force
        // a skip by sending too little gas (a call gets at most 63/64 of what is left).
        uint256 writes = 2 * STATS_WRITE_GAS + LEADERBOARD_WRITE_GAS;
        if (gasleft() < writes + writes / 63 + 200_000) revert InsufficientGas();

        uint256 gameId = NameLib.id(game);
        Record storage w = _entry(winner, game, gameId);
        Record storage l = _entry(loser, game, gameId);
        Totals storage tw = _totals[winner];
        Totals storage tl = _totals[loser];
        if (tw.reached == 0) tw.reached = ++_seq;
        if (tl.reached == 0) tl.reached = ++_seq;
        if (draw) {
            ++w.draws;
            ++l.draws;
            ++tw.draws;
            ++tl.draws;
            tw.streak = 0;
        } else {
            ++w.wins;
            ++l.losses;
            ++tw.wins;
            ++tl.losses;
            if (++tw.streak > tw.best) tw.best = tw.streak;
            tw.reached = ++_seq;
        }
        tl.streak = 0;
        _rank(winner);
        _rank(loser);
        emit ResultRecorded(game, winner, loser, draw);
        _writeStats(winner, winnerLabel);
        _writeStats(loser, loserLabel);
        _writeLeaderboard();
    }

    /// @inheritdoc IPlayerStats
    function statsOf(address player, string calldata game) external view returns (Record memory) {
        return _records[player][NameLib.id(game)];
    }

    /// @inheritdoc IPlayerStats
    function totalsOf(address player) external view returns (Totals memory) {
        return _totals[player];
    }

    /// @inheritdoc IPlayerStats
    function leaders() external view returns (address[] memory) {
        return _top;
    }

    /// @inheritdoc IPlayerStats
    function statsText(address player) public view returns (string memory text) {
        string[] storage games = _played[player];
        text = string.concat("{", _totalsText(_totals[player]), ',"games":{');
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
        text = string.concat(text, "}}");
    }

    /// @inheritdoc IPlayerStats
    function leaderboardText() public view returns (string memory text) {
        text = "[";
        for (uint256 i; i < _top.length; ++i) {
            address player = _top[i];
            text = string.concat(
                text, i == 0 ? '{"name":"' : ',{"name":"', NAMES.nameOf(player), '",', _totalsText(_totals[player]), "}"
            );
        }
        text = string.concat(text, "]");
    }

    function _entry(address player, string calldata game, uint256 gameId) private returns (Record storage r) {
        r = _records[player][gameId];
        if (r.wins == 0 && r.losses == 0 && r.draws == 0) _played[player].push(game);
    }

    /// @dev `"played":…,"wins":…,"losses":…,"draws":…,"streak":…,"best":…`, the totals' fields without braces.
    function _totalsText(Totals storage t) private view returns (string memory) {
        return string.concat(
            '"played":',
            (uint256(t.wins) + t.losses + t.draws).toString(),
            ',"wins":',
            uint256(t.wins).toString(),
            ',"losses":',
            uint256(t.losses).toString(),
            ',"draws":',
            uint256(t.draws).toString(),
            ',"streak":',
            uint256(t.streak).toString(),
            ',"best":',
            uint256(t.best).toString()
        );
    }

    /// @dev Keeps `_top` the best `TOP` players in rank order. Wins only ever rise, so only `player` can move, and only
    ///      up: it enters at the bottom (if there is room or it beats the last) and bubbles up.
    function _rank(address player) private {
        uint256 n = _top.length;
        uint256 i;
        while (i < n && _top[i] != player) ++i;
        if (i == n) {
            if (n < TOP) {
                _top.push(player);
            } else if (_above(player, _top[n - 1])) {
                i = n - 1;
                _top[i] = player;
            } else {
                return;
            }
        }
        while (i > 0 && _above(_top[i], _top[i - 1])) {
            (_top[i - 1], _top[i]) = (_top[i], _top[i - 1]);
            --i;
        }
    }

    /// @dev Whether `a` ranks above `b`: more wins, then reached that many first.
    function _above(address a, address b) private view returns (bool) {
        Totals storage x = _totals[a];
        Totals storage y = _totals[b];
        if (x.wins != y.wins) return x.wins > y.wins;
        return x.reached < y.reached;
    }

    /// @dev Writes `stats` on the player's current resolver, and skips the player if it fails.
    function _writeStats(address player, string memory label) private {
        string memory value = statsText(player);
        address resolver = NAMES.REGISTRY().getResolver(label);
        bytes memory data = abi.encodeCall(IPermissionedResolver.setText, (NameLib.dnsName(label), "stats", value));
        if (_call(resolver, STATS_WRITE_GAS, data)) emit StatsWritten(player, value);
        else emit StatsSkipped(player);
    }

    /// @dev Writes `leaderboard` on `gamebox.eth`'s resolver (looked up in its canonical parent each time), and skips
    ///      it if that fails.
    function _writeLeaderboard() private {
        string memory value = leaderboardText();
        (IRegistry parent, string memory label) = NAMES.REGISTRY().getParent();
        address resolver = parent.getResolver(label);
        bytes memory data = abi.encodeCall(IPermissionedResolver.setText, (NameLib.PARENT_DNS, "leaderboard", value));
        if (_call(resolver, LEADERBOARD_WRITE_GAS, data)) emit LeaderboardWritten(value);
        else emit LeaderboardSkipped();
    }

    /// @dev Calls `target` with at most `cap` gas, and says whether it succeeded (a target with no code never does).
    function _call(address target, uint256 cap, bytes memory data) private returns (bool ok) {
        if (target.code.length == 0) return false;
        assembly ("memory-safe") {
            ok := call(cap, target, 0, add(data, 32), mload(data), 0, 0)
        }
    }
}
