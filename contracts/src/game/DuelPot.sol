// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {BoxCheck} from "../names/BoxCheck.sol";
import {IGameBoxNames} from "../names/IGameBoxNames.sol";
import {NameLib} from "../names/NameLib.sol";
import {IFakeUSDC} from "../token/IFakeUSDC.sol";
import {IDuelPot} from "./IDuelPot.sol";

/// @title DuelPot
/// @notice One USDC pot per match, opened by a Box-signed `Stake` and settled by its `Result` (see `IDuelPot`).
contract DuelPot is IDuelPot, EIP712 {
    using SafeERC20 for IFakeUSDC;

    /// @inheritdoc IDuelPot
    bytes32 public constant STAKE_TYPEHASH =
        keccak256("Stake(string box,string game,uint256 round,address a,address b,uint256 amount,uint256 deadline)");
    /// @inheritdoc IDuelPot
    uint64 public constant REFUND_DELAY = 1 hours;

    /// @inheritdoc IDuelPot
    IGameBoxNames public immutable NAMES;
    /// @inheritdoc IDuelPot
    IFakeUSDC public immutable USDC;

    mapping(uint256 boxId => mapping(uint256 round => Pot)) private _pots;

    /// @param names The registrar Boxes and referees are read from.
    /// @param usdc The stake token; this contract must be its game spender.
    constructor(IGameBoxNames names, IFakeUSDC usdc) EIP712("Game Box Stakes", "1") {
        NAMES = names;
        USDC = usdc;
    }

    /// @inheritdoc IDuelPot
    function open(Stake calldata stake, bytes32 r, bytes32 s) external {
        BoxCheck.before(stake.deadline);
        (bytes32 qx, bytes32 qy) = BoxCheck.liveKey(NAMES, stake.box);
        if (stake.a == stake.b) revert SamePlayer(stake.a);
        if (stake.amount == 0) revert ZeroAmount();
        uint256 boxId = NameLib.id(stake.box);
        if (_pots[boxId][stake.round].state != State.None) revert PotExists(stake.box, stake.round);
        BoxCheck.verify(stakeDigest(stake), r, s, qx, qy);

        _pots[boxId][stake.round] =
            Pot(stake.a, stake.b, stake.amount, uint64(block.timestamp), State.Open, keccak256(bytes(stake.game)));
        USDC.safeTransferFrom(stake.a, address(this), stake.amount);
        USDC.safeTransferFrom(stake.b, address(this), stake.amount);
        emit PotOpened(stake.box, stake.game, stake.round, stake.a, stake.b, stake.amount);
    }

    /// @inheritdoc IDuelPot
    function settle(string calldata box, string calldata game, uint256 round, address winner, address loser, bool draw)
        external
    {
        if (!NAMES.hasRole(NAMES.REFEREE_ROLE(), msg.sender)) revert NotReferee(msg.sender);
        Pot storage pot = _openPot(box, round);
        bool players = (winner == pot.a && loser == pot.b) || (winner == pot.b && loser == pot.a);
        if (!players || keccak256(bytes(game)) != pot.game) revert PotMismatch(box, round);
        pot.state = State.Settled;
        uint256 amount = pot.amount;
        if (draw) {
            USDC.safeTransfer(winner, amount);
            USDC.safeTransfer(loser, amount);
        } else {
            USDC.safeTransfer(winner, 2 * amount);
        }
        emit PotSettled(box, round, winner, draw, amount);
    }

    /// @inheritdoc IDuelPot
    function refund(string calldata box, uint256 round) external {
        Pot storage pot = _openPot(box, round);
        uint256 refundableAt = uint256(pot.opened) + REFUND_DELAY;
        if (block.timestamp < refundableAt) revert TooEarly(refundableAt);
        pot.state = State.Refunded;
        USDC.safeTransfer(pot.a, pot.amount);
        USDC.safeTransfer(pot.b, pot.amount);
        emit PotRefunded(box, round, pot.amount);
    }

    /// @inheritdoc IDuelPot
    function getPot(string calldata box, uint256 round) external view returns (Pot memory) {
        return _pots[NameLib.id(box)][round];
    }

    /// @inheritdoc IDuelPot
    function stakeDigest(Stake calldata stake) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    STAKE_TYPEHASH,
                    keccak256(bytes(stake.box)),
                    keccak256(bytes(stake.game)),
                    stake.round,
                    stake.a,
                    stake.b,
                    stake.amount,
                    stake.deadline
                )
            )
        );
    }

    function _openPot(string calldata box, uint256 round) private view returns (Pot storage pot) {
        pot = _pots[NameLib.id(box)][round];
        if (pot.state != State.Open) revert PotNotOpen(box, round);
    }
}
