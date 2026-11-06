// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {P256} from "../box/P256.sol";
import {IBoxResults} from "./IBoxResults.sol";
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
    IGameBoxNames public immutable NAMES;
    /// @inheritdoc IBoxResults
    IPlayerStats public immutable STATS;

    mapping(uint256 boxId => mapping(uint256 round => bool)) private _used;

    /// @param names The registrar Boxes and players are read from, and titles crowned through.
    /// @param stats The stats writer.
    constructor(IGameBoxNames names, IPlayerStats stats) EIP712("Game Box Results", "1") {
        NAMES = names;
        STATS = stats;
    }

    /// @inheritdoc IBoxResults
    function submit(Result calldata result, bytes32 r, bytes32 s) external {
        if (block.timestamp > result.deadline) revert DeadlineExpired(result.deadline);
        IGameBoxNames.Box memory box = NAMES.getBox(result.box);
        if (box.status == IGameBoxNames.BoxStatus.None) revert UnknownBox(result.box);
        if (block.timestamp >= box.expiry) revert BoxExpired(result.box);
        if (box.status != IGameBoxNames.BoxStatus.Active) revert BoxNotActive(result.box);
        uint256 boxId = NameLib.id(result.box);
        if (_used[boxId][result.round]) revert RoundUsed(result.box, result.round);
        if (result.winner == result.loser) revert SamePlayer(result.winner);
        if (bytes(NAMES.labelOf(result.winner)).length == 0) revert NotAPlayer(result.winner);
        if (bytes(NAMES.labelOf(result.loser)).length == 0) revert NotAPlayer(result.loser);
        if (!P256.verify(resultDigest(result), r, s, box.qx, box.qy)) revert InvalidSignature();

        _used[boxId][result.round] = true;
        if (!result.draw) NAMES.crown(result.game, result.winner, result.round);
        STATS.record(result.game, result.winner, result.loser, result.draw);
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
}
