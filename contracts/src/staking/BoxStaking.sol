// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IGameBoxNames} from "../names/IGameBoxNames.sol";
import {NameLib} from "../names/NameLib.sol";
import {IBoxStaking} from "./IBoxStaking.sol";

/// @title BoxStaking
/// @notice GBX staked behind a Box: USDC fees in, commission to the operator, the rest to stakers by share, and a
///         slash for a proven cheat (see `IBoxStaking`).
contract BoxStaking is IBoxStaking, AccessControl {
    using SafeERC20 for IERC20;

    /// @inheritdoc IBoxStaking
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    /// @inheritdoc IBoxStaking
    uint16 public constant MIN_COMMISSION_BPS = 1_000;
    /// @inheritdoc IBoxStaking
    uint16 public constant MAX_COMMISSION_BPS = 9_000;

    uint16 internal constant BPS = 10_000;
    /// @notice Scales the USDC-per-share counter, so a 1-wei-USDC fee over 10^9 GBX of shares still counts.
    uint256 internal constant ACC = 1e36;

    /// @inheritdoc IBoxStaking
    IERC20 public immutable GBX;
    /// @inheritdoc IBoxStaking
    IERC20 public immutable USDC;
    /// @inheritdoc IBoxStaking
    IGameBoxNames public immutable NAMES;
    /// @inheritdoc IBoxStaking
    uint256 public immutable MIN_OPERATOR_STAKE;
    /// @inheritdoc IBoxStaking
    uint64 public immutable UNSTAKE_DELAY;
    /// @inheritdoc IBoxStaking
    uint64 public immutable COMMISSION_DELAY;

    /// @notice GBX held as shares. A slash lowers `stake` and leaves `shares`, so each share is worth less.
    struct Pool {
        uint256 shares;
        uint256 stake;
    }

    /// @notice One Box. `commissionBps` zero means it was never set: `MIN_COMMISSION_BPS`.
    struct BoxData {
        Pool active;
        Pool unbonding;
        uint256 accPerShare;
        uint16 commissionBps;
        uint16 pendingCommissionBps;
        uint64 commissionAt;
    }

    /// @notice One staker on one Box. `debt` is `shares × accPerShare` when it was last settled; `owed` is USDC
    ///         already earned.
    struct Staker {
        uint256 shares;
        uint256 debt;
        uint256 owed;
        uint256 unbondingShares;
        uint64 unlockAt;
    }

    mapping(uint256 id => BoxData) internal _boxes;
    mapping(uint256 id => mapping(address staker => Staker)) internal _stakers;

    /// @param gbx The token staked.
    /// @param usdc The token fees are paid in.
    /// @param names The registry the Boxes are read from.
    /// @param admin Holds `DEFAULT_ADMIN_ROLE`, and grants `SLASHER_ROLE`.
    /// @param minOperatorStake The GBX an operator must hold on its own Box.
    /// @param unstakeDelay How long unstaked GBX waits, and stays slashable.
    /// @param commissionDelay How long a commission raise waits.
    constructor(
        IERC20 gbx,
        IERC20 usdc,
        IGameBoxNames names,
        address admin,
        uint256 minOperatorStake,
        uint64 unstakeDelay,
        uint64 commissionDelay
    ) {
        if (
            address(gbx) == address(0) || address(usdc) == address(0) || address(names) == address(0)
                || admin == address(0) || minOperatorStake == 0
        ) revert ZeroValue();
        GBX = gbx;
        USDC = usdc;
        NAMES = names;
        MIN_OPERATOR_STAKE = minOperatorStake;
        UNSTAKE_DELAY = unstakeDelay;
        COMMISSION_DELAY = commissionDelay;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Stake
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IBoxStaking
    function stake(string calldata label, uint256 amount) external {
        _stake(label, msg.sender, amount);
    }

    /// @inheritdoc IBoxStaking
    function stakeFor(string calldata label, address staker, uint256 amount) external {
        _stake(label, staker, amount);
    }

    /// @inheritdoc IBoxStaking
    function requestUnstake(string calldata label, uint256 amount) external {
        if (amount == 0) revert ZeroValue();
        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        Staker storage s = _stakers[id][msg.sender];
        _settle(box, s);

        uint256 shares = _toShares(box.active, amount, Math.Rounding.Ceil);
        if (shares > s.shares) revert InsufficientStake(amount, _toStake(box.active, s.shares));
        box.active.shares -= shares;
        box.active.stake -= amount;
        s.shares -= shares;
        s.debt = _accrued(box, s.shares);

        IGameBoxNames.Box memory info = NAMES.getBox(label);
        if (msg.sender == info.operator && _isOpen(info)) {
            uint256 remaining = _toStake(box.active, s.shares);
            if (remaining < MIN_OPERATOR_STAKE) revert BelowOperatorMinimum(remaining);
        }

        uint256 unbondingShares = _toShares(box.unbonding, amount, Math.Rounding.Floor);
        if (unbondingShares == 0) revert ZeroValue();
        box.unbonding.shares += unbondingShares;
        box.unbonding.stake += amount;
        s.unbondingShares += unbondingShares;
        s.unlockAt = uint64(block.timestamp) + UNSTAKE_DELAY;
        emit UnstakeRequested(label, msg.sender, amount, s.unlockAt);
    }

    /// @inheritdoc IBoxStaking
    function withdraw(string calldata label) external returns (uint256 amount) {
        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        Staker storage s = _stakers[id][msg.sender];
        if (s.unbondingShares == 0) revert NothingToWithdraw();
        if (block.timestamp < s.unlockAt) revert StillUnbonding(s.unlockAt);

        amount = _toStake(box.unbonding, s.unbondingShares);
        box.unbonding.shares -= s.unbondingShares;
        box.unbonding.stake -= amount;
        s.unbondingShares = 0;
        s.unlockAt = 0;
        emit Withdrawn(label, msg.sender, amount);
        GBX.safeTransfer(msg.sender, amount);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Fees and rewards
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IBoxStaking
    function notifyFees(string calldata label, uint256 amount) external {
        if (amount == 0) revert ZeroValue();
        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        IGameBoxNames.Box memory info = NAMES.getBox(label);
        if (!_isOpen(info)) revert BoxNotOpen(label);
        if (_operatorStake(id, info.operator) < MIN_OPERATOR_STAKE) revert BoxNotBonded(label);

        _applyCommission(box);
        uint256 commission = amount * _commission(box) / BPS;
        _stakers[id][info.operator].owed += commission;
        box.accPerShare += Math.mulDiv(amount - commission, ACC, box.active.shares);
        emit FeesNotified(label, msg.sender, info.operator, amount, commission);
        USDC.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @inheritdoc IBoxStaking
    function claim(string calldata label) external returns (uint256 amount) {
        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        Staker storage s = _stakers[id][msg.sender];
        _settle(box, s);
        amount = s.owed;
        s.owed = 0;
        emit Claimed(label, msg.sender, amount);
        if (amount > 0) USDC.safeTransfer(msg.sender, amount);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Operator and slasher
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IBoxStaking
    function setCommission(string calldata label, uint16 bps) external {
        if (bps < MIN_COMMISSION_BPS || bps > MAX_COMMISSION_BPS) revert CommissionOutOfRange(bps);
        IGameBoxNames.Box memory info = NAMES.getBox(label);
        if (msg.sender != info.operator) revert NotOperator(label, msg.sender);

        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        _applyCommission(box);
        // A cut only helps stakers, and with no other stakers nobody needs warning: both take effect at once.
        bool alone = box.active.shares == _stakers[id][msg.sender].shares;
        if (bps <= _commission(box) || alone) {
            box.commissionBps = bps;
            box.pendingCommissionBps = 0;
            box.commissionAt = uint64(block.timestamp);
        } else {
            box.pendingCommissionBps = bps;
            box.commissionAt = uint64(block.timestamp) + COMMISSION_DELAY;
        }
        emit CommissionSet(label, bps, box.commissionAt);
    }

    /// @inheritdoc IBoxStaking
    function slash(string calldata label, uint16 bps, address to) external onlyRole(SLASHER_ROLE) returns (uint256) {
        if (bps == 0 || bps > BPS) revert SlashOutOfRange(bps);
        if (to == address(0)) revert ZeroValue();
        BoxData storage box = _boxes[NameLib.id(label)];
        uint256 fromActive = box.active.stake * bps / BPS;
        uint256 fromUnbonding = box.unbonding.stake * bps / BPS;
        box.active.stake -= fromActive;
        box.unbonding.stake -= fromUnbonding;
        uint256 amount = fromActive + fromUnbonding;
        emit Slashed(label, bps, amount, to);
        GBX.safeTransfer(to, amount);
        return amount;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IBoxStaking
    function positionOf(string calldata label, address staker) external view returns (Position memory) {
        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        Staker storage s = _stakers[id][staker];
        return Position({
            stake: _toStake(box.active, s.shares),
            unbonding: _toStake(box.unbonding, s.unbondingShares),
            unlockAt: s.unlockAt,
            rewards: s.owed + _accrued(box, s.shares) - s.debt
        });
    }

    /// @inheritdoc IBoxStaking
    function boxStake(string calldata label) external view returns (BoxStake memory) {
        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        IGameBoxNames.Box memory info = NAMES.getBox(label);
        uint256 operatorStake = _operatorStake(id, info.operator);
        bool matured = box.pendingCommissionBps != 0 && block.timestamp >= box.commissionAt;
        return BoxStake({
            stake: box.active.stake,
            unbonding: box.unbonding.stake,
            operatorStake: operatorStake,
            commissionBps: matured ? box.pendingCommissionBps : _commission(box),
            pendingCommissionBps: matured ? 0 : box.pendingCommissionBps,
            commissionAt: box.commissionAt,
            bonded: _isOpen(info) && operatorStake >= MIN_OPERATOR_STAKE
        });
    }

    /// @inheritdoc IBoxStaking
    function isBonded(string calldata label) external view returns (bool) {
        uint256 id = NameLib.id(label);
        IGameBoxNames.Box memory info = NAMES.getBox(label);
        return _isOpen(info) && _operatorStake(id, info.operator) >= MIN_OPERATOR_STAKE;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------------------------

    function _stake(string calldata label, address staker, uint256 amount) internal {
        if (amount == 0 || staker == address(0)) revert ZeroValue();
        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        IGameBoxNames.Box memory info = NAMES.getBox(label);
        if (!_isOpen(info)) revert BoxNotOpen(label);
        if (staker != info.operator && _operatorStake(id, info.operator) < MIN_OPERATOR_STAKE) {
            revert BoxNotBonded(label);
        }

        Staker storage s = _stakers[id][staker];
        _settle(box, s);
        uint256 shares = _toShares(box.active, amount, Math.Rounding.Floor);
        if (shares == 0) revert ZeroValue();
        box.active.shares += shares;
        box.active.stake += amount;
        s.shares += shares;
        s.debt = _accrued(box, s.shares);
        emit Staked(label, staker, msg.sender, amount, shares);
        GBX.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @dev Moves what `s` earned since it was last settled into `owed`, and resets its debt.
    function _settle(BoxData storage box, Staker storage s) internal {
        uint256 accrued = _accrued(box, s.shares);
        s.owed += accrued - s.debt;
        s.debt = accrued;
    }

    function _accrued(BoxData storage box, uint256 shares) internal view returns (uint256) {
        return Math.mulDiv(shares, box.accPerShare, ACC);
    }

    /// @dev The virtual share and the virtual wei (`+ 1`) keep the price defined when a pool is empty or was slashed to
    ///      nothing, and stop a first staker from inflating a share's price.
    function _toShares(Pool storage pool, uint256 amount, Math.Rounding rounding) internal view returns (uint256) {
        return Math.mulDiv(amount, pool.shares + 1, pool.stake + 1, rounding);
    }

    function _toStake(Pool storage pool, uint256 shares) internal view returns (uint256) {
        return Math.mulDiv(shares, pool.stake + 1, pool.shares + 1);
    }

    /// @dev Makes a raise whose delay has passed the commission in force.
    function _applyCommission(BoxData storage box) internal {
        if (box.pendingCommissionBps != 0 && block.timestamp >= box.commissionAt) {
            box.commissionBps = box.pendingCommissionBps;
            box.pendingCommissionBps = 0;
        }
    }

    function _commission(BoxData storage box) internal view returns (uint16) {
        return box.commissionBps == 0 ? MIN_COMMISSION_BPS : box.commissionBps;
    }

    function _operatorStake(uint256 id, address operator) internal view returns (uint256) {
        return _toStake(_boxes[id].active, _stakers[id][operator].shares);
    }

    function _isOpen(IGameBoxNames.Box memory info) internal view returns (bool) {
        return info.status == IGameBoxNames.BoxStatus.Active && info.expiry > block.timestamp;
    }
}
