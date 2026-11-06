// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IP256AccountFactory} from "../box/IP256AccountFactory.sol";
import {IGameBoxNames} from "../names/IGameBoxNames.sol";
import {NameLib} from "../names/NameLib.sol";
import {IBoxLease} from "./IBoxLease.sol";

/// @title BoxLease
/// @notice GBX staked on a Box keeps its name `Active` for the hours it paid for; unstaking suspends it (see
///         `IBoxLease`).
contract BoxLease is IBoxLease {
    using SafeERC20 for IERC20;

    /// @inheritdoc IBoxLease
    uint256 public constant RATE_PER_HOUR = 100 ether;
    /// @inheritdoc IBoxLease
    uint64 public constant MIN_HOURS = 1;
    /// @inheritdoc IBoxLease
    uint64 public constant MAX_HOURS = 720;

    /// @inheritdoc IBoxLease
    IGameBoxNames public immutable NAMES;
    /// @inheritdoc IBoxLease
    IERC20 public immutable GBX;
    /// @inheritdoc IBoxLease
    IP256AccountFactory public immutable FACTORY;

    mapping(uint256 id => Lease) private _leases;

    constructor(IGameBoxNames names, IERC20 gbx, IP256AccountFactory factory) {
        NAMES = names;
        GBX = gbx;
        FACTORY = factory;
    }

    /// @inheritdoc IBoxLease
    function stake(string calldata label, bytes32 qx, bytes32 qy, uint64 hours_) external returns (uint64 end) {
        if (hours_ < MIN_HOURS || hours_ > MAX_HOURS) revert HoursOutOfRange(hours_);
        Lease storage lease = _leases[NameLib.id(label)];
        bool running = lease.operator != address(0) && block.timestamp < lease.end;
        if (running && lease.operator != msg.sender) revert LeaseHeld(label, lease.operator, lease.end);
        // A lease that ran out goes back to its operator before the new one starts.
        if (!running && lease.operator != address(0)) _close(label, lease, true);

        uint256 amount = quote(hours_);
        GBX.safeTransferFrom(msg.sender, address(this), amount);
        end = (running ? lease.end : uint64(block.timestamp)) + hours_ * 1 hours;
        if (!running) (lease.operator, lease.start) = (msg.sender, uint64(block.timestamp));
        lease.stake += amount;
        lease.end = end;

        _activate(label, qx, qy, end);
        emit Staked(label, msg.sender, amount, hours_, end);
    }

    /// @inheritdoc IBoxLease
    function unstake(string calldata label) external returns (uint256 amount) {
        Lease storage lease = _leases[NameLib.id(label)];
        if (lease.operator == address(0)) revert NoLease(label);
        if (lease.operator != msg.sender) revert NotOperator(label, msg.sender);
        amount = _close(label, lease, block.timestamp >= lease.end);
        _suspend(label);
    }

    /// @inheritdoc IBoxLease
    function lapse(string calldata label) external returns (uint256 amount) {
        Lease storage lease = _leases[NameLib.id(label)];
        if (lease.operator == address(0)) revert NoLease(label);
        if (block.timestamp < lease.end) revert LeaseRunning(label, lease.end);
        amount = _close(label, lease, true);
        _suspend(label);
    }

    /// @inheritdoc IBoxLease
    function leaseOf(string calldata label) external view returns (Lease memory) {
        return _leases[NameLib.id(label)];
    }

    /// @inheritdoc IBoxLease
    function quote(uint64 hours_) public pure returns (uint256) {
        return uint256(hours_) * RATE_PER_HOUR;
    }

    /// @dev Pays `lease` back to its operator and clears it.
    function _close(string calldata label, Lease storage lease, bool lapsed) private returns (uint256 amount) {
        (address operator, uint256 held) = (lease.operator, lease.stake);
        delete _leases[NameLib.id(label)];
        GBX.safeTransfer(operator, held);
        emit Unstaked(label, operator, held, lapsed);
        return held;
    }

    /// @dev Turns the Box's name on until at least `end`: registers it to the staker if it has none, else checks the
    ///      key, lifts a suspension and moves the expiry out.
    function _activate(string calldata label, bytes32 qx, bytes32 qy, uint64 end) private {
        IGameBoxNames.Box memory box = NAMES.getBox(label);
        if (box.status == IGameBoxNames.BoxStatus.None) {
            NAMES.registerBox(label, msg.sender, FACTORY.deploy(qx, qy), qx, qy, end);
            return;
        }
        if (box.status == IGameBoxNames.BoxStatus.Revoked) revert BoxRevoked(label);
        if (box.qx != qx || box.qy != qy) revert WrongKey(label);
        if (box.status != IGameBoxNames.BoxStatus.Active) NAMES.setBoxStatus(label, IGameBoxNames.BoxStatus.Active);
        if (end > box.expiry) NAMES.renewBox(label, end);
    }

    /// @dev Suspends the Box's name, unless the admin already revoked it.
    function _suspend(string calldata label) private {
        if (NAMES.getBox(label).status == IGameBoxNames.BoxStatus.Active) {
            NAMES.setBoxStatus(label, IGameBoxNames.BoxStatus.Suspended);
        }
    }
}
