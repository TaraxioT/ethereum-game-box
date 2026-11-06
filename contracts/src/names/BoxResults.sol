// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IDuelPot} from "../game/IDuelPot.sol";
import {BoxCheck} from "./BoxCheck.sol";
import {IBoxResults} from "./IBoxResults.sol";
import {IChampionships} from "./IChampionships.sol";
import {IGameBoxNames} from "./IGameBoxNames.sol";
import {IPlayerStats} from "./IPlayerStats.sol";
import {NameLib} from "./NameLib.sol";

/// @title BoxResults
/// @notice The referee for now: settles match results signed by a registered, live, active Box (see `IBoxResults`).
contract BoxResults is IBoxResults, EIP712 {
    /// @inheritdoc IBoxResults
    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "Result(string box,string game,uint256 round,address winner,address loser,bool draw,uint256 deadline)"
    );
    /// @inheritdoc IBoxResults
    uint256 public constant SCORE_GAS = 3_000_000;

    /// @inheritdoc IBoxResults
    IGameBoxNames public immutable NAMES;
    /// @inheritdoc IBoxResults
    IPlayerStats public immutable STATS;
    /// @inheritdoc IBoxResults
    IDuelPot public immutable POT;
    /// @inheritdoc IBoxResults
    IChampionships public immutable CUPS;

    mapping(uint256 boxId => mapping(uint256 round => bool)) private _used;

    /// @param names The registrar Boxes and players are read from, and titles crowned through.
    /// @param stats The stats writer.
    /// @param pot The USDC pots.
    /// @param cups The championships.
    constructor(IGameBoxNames names, IPlayerStats stats, IDuelPot pot, IChampionships cups)
        EIP712("Game Box Results", "1")
    {
        NAMES = names;
        STATS = stats;
        POT = pot;
        CUPS = cups;
    }

    /// @inheritdoc IBoxResults
    function submit(Result calldata result, bytes32 r, bytes32 s) external {
        BoxCheck.before(result.deadline);
        (bytes32 qx, bytes32 qy) = BoxCheck.liveKey(NAMES, result.box);
        uint256 boxId = NameLib.id(result.box);
        if (_used[boxId][result.round]) revert RoundUsed(result.box, result.round);
        if (result.winner == result.loser) revert SamePlayer(result.winner);
        if (bytes(NAMES.labelOf(result.winner)).length == 0) revert NotAPlayer(result.winner);
        if (bytes(NAMES.labelOf(result.loser)).length == 0) revert NotAPlayer(result.loser);
        BoxCheck.verify(resultDigest(result), r, s, qx, qy);

        _used[boxId][result.round] = true;
        if (!result.draw) NAMES.crown(result.game, result.winner, result.round);
        STATS.record(result.game, result.winner, result.loser, result.draw);
        if (POT.getPot(result.box, result.round).state == IDuelPot.State.Open) {
            POT.settle(result.box, result.game, result.round, result.winner, result.loser, result.draw);
        }
        _score(result);
        emit ResultSubmitted(result.box, result.game, result.round, result.winner, result.loser, result.draw);
    }

    /// @inheritdoc IBoxResults
    function resultDigest(Result calldata result) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESULT_TYPEHASH,
                    keccak256(bytes(result.box)),
                    keccak256(bytes(result.game)),
                    result.round,
                    result.winner,
                    result.loser,
                    result.draw,
                    result.deadline
                )
            )
        );
    }

    /// @inheritdoc IBoxResults
    function roundUsed(string calldata box, uint256 round) external view returns (bool) {
        return _used[NameLib.id(box)][round];
    }

    /// @dev Scores the game's open championship with a gas cap, and lets the result stand if it fails. It refuses to
    ///      start the call without gas for the full cap (a call gets at most 63/64 of what is left), so a sender can't
    ///      force a skip by sending too little.
    function _score(Result calldata result) private {
        if (gasleft() < SCORE_GAS + SCORE_GAS / 63 + 10_000) revert InsufficientGas();
        try CUPS.score{gas: SCORE_GAS}(result.game, result.winner, result.loser, result.draw) {}
        catch {
            emit ScoreSkipped(result.box, result.round);
        }
    }
}
