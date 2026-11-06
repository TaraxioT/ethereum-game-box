// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {BoxCheck} from "../names/BoxCheck.sol";
import {IGameBoxNames} from "../names/IGameBoxNames.sol";
import {NameLib} from "../names/NameLib.sol";
import {IFakeUSDC} from "../token/IFakeUSDC.sol";
import {IStorePot} from "./IStorePot.sol";

/// @title StorePot
/// @notice One Store USDC pot per store game's match, opened by a Box-signed `Stake` and ended by a verifier-signed
///         `Verdict` or `Void`, or a refund (see `IStorePot`).
contract StorePot is IStorePot, EIP712, AccessControl {
    using SafeERC20 for IFakeUSDC;

    /// @inheritdoc IStorePot
    bytes32 public constant STAKE_TYPEHASH =
        keccak256("Stake(string box,bytes32 bundle,uint256 round,address[] players,uint256 amount,uint256 deadline)");
    /// @inheritdoc IStorePot
    bytes32 public constant VERDICT_TYPEHASH =
        keccak256("Verdict(string box,uint256 round,uint256[] payouts,bytes32 record,uint256 deadline)");
    /// @inheritdoc IStorePot
    bytes32 public constant VOID_TYPEHASH = keccak256("Void(string box,uint256 round,bytes32 record,uint256 deadline)");
    /// @inheritdoc IStorePot
    bytes32 public constant LISTER_ROLE = keccak256("LISTER_ROLE");
    /// @inheritdoc IStorePot
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    /// @inheritdoc IStorePot
    uint256 public constant MIN_PLAYERS = 2;
    /// @inheritdoc IStorePot
    uint256 public constant MAX_PLAYERS = 4;
    /// @inheritdoc IStorePot
    uint64 public constant REFUND_DELAY = 1 hours;

    /// @inheritdoc IStorePot
    IGameBoxNames public immutable NAMES;
    /// @inheritdoc IStorePot
    IFakeUSDC public immutable USDC;

    /// @inheritdoc IStorePot
    mapping(bytes32 bundle => bool) public listed;
    mapping(uint256 boxId => mapping(uint256 round => Pot)) private _pots;

    /// @param names The registrar Boxes are read from.
    /// @param usdc The stake token; this contract must be its game spender.
    /// @param admin Gets `DEFAULT_ADMIN_ROLE` (grants and revokes the lister and verifier roles).
    constructor(IGameBoxNames names, IFakeUSDC usdc, address admin) EIP712("Game Box Store Pots", "1") {
        NAMES = names;
        USDC = usdc;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IStorePot
    function list(bytes32 bundle) external onlyRole(LISTER_ROLE) {
        listed[bundle] = true;
        emit BundleListed(bundle);
    }

    /// @inheritdoc IStorePot
    function open(Stake calldata stake, bytes32 r, bytes32 s) external {
        BoxCheck.before(stake.deadline);
        (bytes32 qx, bytes32 qy) = BoxCheck.liveKey(NAMES, stake.box);
        if (!listed[stake.bundle]) revert NotListed(stake.bundle);
        _checkPlayers(stake.players);
        if (stake.amount == 0) revert ZeroAmount();
        uint256 boxId = NameLib.id(stake.box);
        if (_pots[boxId][stake.round].state != State.None) revert PotExists(stake.box, stake.round);
        BoxCheck.verify(stakeDigest(stake), r, s, qx, qy);

        _pots[boxId][stake.round] =
            Pot(stake.players, stake.amount, uint64(block.timestamp), State.Open, stake.bundle, bytes32(0));
        for (uint256 i; i < stake.players.length; ++i) {
            USDC.safeTransferFrom(stake.players[i], address(this), stake.amount);
        }
        emit PotOpened(stake.box, stake.bundle, stake.round, stake.players, stake.amount);
    }

    /// @inheritdoc IStorePot
    function settle(Verdict calldata verdict, bytes calldata signature) external {
        BoxCheck.before(verdict.deadline);
        _requireVerifier(verdictDigest(verdict), signature);
        Pot storage pot = _openPot(verdict.box, verdict.round);
        address[] memory players = pot.players;
        if (verdict.payouts.length != players.length) revert PayoutCount(players.length, verdict.payouts.length);
        uint256 sum;
        for (uint256 i; i < players.length; ++i) {
            sum += verdict.payouts[i];
        }
        uint256 total = pot.amount * players.length;
        if (sum != total) revert PayoutSum(total, sum);

        pot.state = State.Settled;
        pot.record = verdict.record;
        for (uint256 i; i < players.length; ++i) {
            USDC.safeTransfer(players[i], verdict.payouts[i]);
        }
        emit PotSettled(verdict.box, verdict.round, verdict.payouts, verdict.record);
    }

    /// @inheritdoc IStorePot
    function voidPot(Void calldata voiding, bytes calldata signature) external {
        BoxCheck.before(voiding.deadline);
        _requireVerifier(voidDigest(voiding), signature);
        Pot storage pot = _openPot(voiding.box, voiding.round);
        pot.state = State.Voided;
        pot.record = voiding.record;
        _giveBack(pot);
        emit PotVoided(voiding.box, voiding.round, pot.amount, voiding.record);
    }

    /// @inheritdoc IStorePot
    function refund(string calldata box, uint256 round) external {
        Pot storage pot = _openPot(box, round);
        uint256 refundableAt = uint256(pot.opened) + REFUND_DELAY;
        if (block.timestamp < refundableAt) revert TooEarly(refundableAt);
        pot.state = State.Refunded;
        _giveBack(pot);
        emit PotRefunded(box, round, pot.amount);
    }

    /// @inheritdoc IStorePot
    function getPot(string calldata box, uint256 round) external view returns (Pot memory) {
        return _pots[NameLib.id(box)][round];
    }

    /// @inheritdoc IStorePot
    function stakeDigest(Stake calldata stake) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    STAKE_TYPEHASH,
                    keccak256(bytes(stake.box)),
                    stake.bundle,
                    stake.round,
                    keccak256(abi.encodePacked(stake.players)),
                    stake.amount,
                    stake.deadline
                )
            )
        );
    }

    /// @inheritdoc IStorePot
    function verdictDigest(Verdict calldata verdict) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    VERDICT_TYPEHASH,
                    keccak256(bytes(verdict.box)),
                    verdict.round,
                    keccak256(abi.encodePacked(verdict.payouts)),
                    verdict.record,
                    verdict.deadline
                )
            )
        );
    }

    /// @inheritdoc IStorePot
    function voidDigest(Void calldata voiding) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    VOID_TYPEHASH, keccak256(bytes(voiding.box)), voiding.round, voiding.record, voiding.deadline
                )
            )
        );
    }

    /// @dev This contract can't be a player: pulling its own stake moves nothing, so a verdict paying that seat's share
    ///      to the other players would spend other pots' money.
    function _checkPlayers(address[] calldata players) private view {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) revert PlayerCount(players.length);
        for (uint256 i; i < players.length; ++i) {
            if (players[i] == address(this)) revert PotIsPlayer();
            for (uint256 j; j < i; ++j) {
                if (players[i] == players[j]) revert RepeatedPlayer(players[i]);
            }
        }
    }

    function _requireVerifier(bytes32 digest, bytes calldata signature) private view {
        address signer = ECDSA.recoverCalldata(digest, signature);
        if (!hasRole(VERIFIER_ROLE, signer)) revert NotVerifier(signer);
    }

    function _openPot(string calldata box, uint256 round) private view returns (Pot storage pot) {
        pot = _pots[NameLib.id(box)][round];
        if (pot.state != State.Open) revert PotNotOpen(box, round);
    }

    function _giveBack(Pot storage pot) private {
        address[] memory players = pot.players;
        uint256 amount = pot.amount;
        for (uint256 i; i < players.length; ++i) {
            USDC.safeTransfer(players[i], amount);
        }
    }
}
