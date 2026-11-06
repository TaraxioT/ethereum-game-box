// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IGameBoxNames} from "../names/IGameBoxNames.sol";

/// @title IBoxStaking
/// @notice GBX staked behind a Box, keyed by the Box's label in `GameBoxNames`. Stakers earn the Box's USDC game fees,
///         after the operator's commission, and lose a share of their stake if the Box is proven to cheat.
/// @dev - A Box is **open** while `GameBoxNames` has it `Active` and its licence hasn't lapsed. New stake and fees need
///        an open Box. Unstaking, withdrawing and claiming always work.
///      - A Box is **bonded** while it is open and its operator's own stake is at least `MIN_OPERATOR_STAKE`. Only
///        the operator may stake on a Box that isn't bonded, and fees go only to a bonded Box.
///      - Stake is held as shares, so a slash lowers every staker's GBX by the same fraction without a loop.
///        Unstaking moves stake into a second, unbonding pool that earns nothing and is slashed the same way, until
///        `UNSTAKE_DELAY` has passed.
///      - Rewards use a USDC-per-share counter. The operator's commission is credited to the operator at the moment
///        the fees arrive.
///      - Commission is in basis points, 10% to 90%. It starts at 10%. A cut takes effect at once; a raise waits
///        `COMMISSION_DELAY`, unless the operator is the Box's only staker.
interface IBoxStaking is IAccessControl {
    /// @notice `staker` added `amount` GBX (worth `shares` shares) to `label`'s stake, paid by `payer`.
    event Staked(string label, address indexed staker, address indexed payer, uint256 amount, uint256 shares);
    /// @notice `staker` moved `amount` GBX of its stake on `label` into unbonding, until `unlockAt`.
    event UnstakeRequested(string label, address indexed staker, uint256 amount, uint64 unlockAt);
    /// @notice `staker` took `amount` GBX of unbonded stake back from `label`.
    event Withdrawn(string label, address indexed staker, uint256 amount);
    /// @notice `payer` paid `amount` USDC of fees to `label`: `commission` to `operator`, the rest to its stakers.
    event FeesNotified(
        string label, address indexed payer, address indexed operator, uint256 amount, uint256 commission
    );
    /// @notice `staker` claimed `amount` USDC of rewards from `label`.
    event Claimed(string label, address indexed staker, uint256 amount);
    /// @notice `label`'s commission becomes `bps` at `effectiveAt` (now, for a cut).
    event CommissionSet(string label, uint16 bps, uint64 effectiveAt);
    /// @notice `amount` GBX (`bps` of all the Box's stake, active and unbonding) was taken from `label` and sent to `to`.
    event Slashed(string label, uint16 bps, uint256 amount, address indexed to);

    /// @notice The Box isn't `Active` in `GameBoxNames`, or its licence has lapsed.
    error BoxNotOpen(string label);
    /// @notice The Box's operator doesn't hold `MIN_OPERATOR_STAKE` on it, so only the operator may stake on it, and
    ///         it takes no fees.
    error BoxNotBonded(string label);
    /// @notice Only the Box's operator may do this.
    error NotOperator(string label, address caller);
    /// @notice The commission is outside `MIN_COMMISSION_BPS` to `MAX_COMMISSION_BPS`.
    error CommissionOutOfRange(uint16 bps);
    /// @notice A slash above 100%.
    error SlashOutOfRange(uint16 bps);
    /// @notice An amount, or an address, is zero.
    error ZeroValue();
    /// @notice The caller holds less stake on the Box than it asked to unstake.
    error InsufficientStake(uint256 requested, uint256 available);
    /// @notice The operator can't take its own stake below `MIN_OPERATOR_STAKE` while the Box is open.
    error BelowOperatorMinimum(uint256 remaining);
    /// @notice The stake is still unbonding.
    error StillUnbonding(uint64 unlockAt);
    /// @notice Nothing is unbonding for the caller on this Box.
    error NothingToWithdraw();

    /// @notice A Box's stake for one staker.
    /// @param stake The GBX staked, earning rewards.
    /// @param unbonding The GBX waiting out `UNSTAKE_DELAY`.
    /// @param unlockAt When `unbonding` may be withdrawn.
    /// @param rewards The USDC claimable now.
    struct Position {
        uint256 stake;
        uint256 unbonding;
        uint64 unlockAt;
        uint256 rewards;
    }

    /// @notice A Box's totals.
    /// @param stake The GBX staked on it, earning rewards.
    /// @param unbonding The GBX waiting out `UNSTAKE_DELAY`.
    /// @param operatorStake Its operator's own stake.
    /// @param commissionBps The commission in force now.
    /// @param pendingCommissionBps A queued raise, or zero.
    /// @param commissionAt When the queued raise takes effect.
    /// @param bonded Whether it is open and its operator holds `MIN_OPERATOR_STAKE`.
    struct BoxStake {
        uint256 stake;
        uint256 unbonding;
        uint256 operatorStake;
        uint16 commissionBps;
        uint16 pendingCommissionBps;
        uint64 commissionAt;
        bool bonded;
    }

    /// @notice Stakes `amount` GBX of the caller's on `label`, for the caller.
    /// @param label The Box's label.
    /// @param amount The GBX to stake.
    function stake(string calldata label, uint256 amount) external;

    /// @notice Stakes `amount` GBX of the caller's on `label`, for `staker`: the lobby and the operator auction stake
    ///         for a player or an operator in the same transaction that buys the GBX.
    /// @param label The Box's label.
    /// @param staker Who owns the stake.
    /// @param amount The GBX to stake, pulled from the caller.
    function stakeFor(string calldata label, address staker, uint256 amount) external;

    /// @notice Moves `amount` GBX of the caller's stake on `label` into unbonding. It stops earning at once and can be
    ///         withdrawn after `UNSTAKE_DELAY`; a second request adds to it and restarts the delay.
    /// @param label The Box's label.
    /// @param amount The GBX to unstake.
    function requestUnstake(string calldata label, uint256 amount) external;

    /// @notice Sends the caller its unbonded GBX on `label`, after the delay.
    /// @param label The Box's label.
    /// @return amount The GBX sent.
    function withdraw(string calldata label) external returns (uint256 amount);

    /// @notice Pays `amount` USDC of game fees to `label`, pulled from the caller: the commission to the operator, the
    ///         rest to its stakers by share. The Box must be bonded.
    /// @param label The Box's label.
    /// @param amount The USDC.
    function notifyFees(string calldata label, uint256 amount) external;

    /// @notice Sends the caller its USDC rewards on `label`.
    /// @param label The Box's label.
    /// @return amount The USDC sent.
    function claim(string calldata label) external returns (uint256 amount);

    /// @notice Sets `label`'s commission. Operator only.
    /// @param label The Box's label.
    /// @param bps The commission, `MIN_COMMISSION_BPS` to `MAX_COMMISSION_BPS`.
    function setCommission(string calldata label, uint16 bps) external;

    /// @notice Takes `bps` of all of `label`'s stake, active and unbonding, and sends it to `to`. `SLASHER_ROLE` only.
    /// @param label The Box's label.
    /// @param bps The share to take, up to 10,000.
    /// @param to Who receives the GBX.
    /// @return amount The GBX taken.
    function slash(string calldata label, uint16 bps, address to) external returns (uint256 amount);

    /// @notice One staker's position on a Box.
    /// @param label The Box's label.
    /// @param staker The staker.
    /// @return The position.
    function positionOf(string calldata label, address staker) external view returns (Position memory);

    /// @notice A Box's totals.
    /// @param label The Box's label.
    /// @return The totals.
    function boxStake(string calldata label) external view returns (BoxStake memory);

    /// @notice Whether `label` is open and its operator holds `MIN_OPERATOR_STAKE`.
    /// @param label The Box's label.
    /// @return True if bonded.
    function isBonded(string calldata label) external view returns (bool);

    /// @notice The role that may slash.
    function SLASHER_ROLE() external view returns (bytes32);
    /// @notice The lowest commission: 10%.
    function MIN_COMMISSION_BPS() external view returns (uint16);
    /// @notice The highest commission: 90%.
    function MAX_COMMISSION_BPS() external view returns (uint16);
    /// @notice The GBX an operator must hold on its own Box for the Box to be bonded.
    function MIN_OPERATOR_STAKE() external view returns (uint256);
    /// @notice How long unstaked GBX waits before it can be withdrawn, and stays slashable.
    function UNSTAKE_DELAY() external view returns (uint64);
    /// @notice How long a commission raise waits before it takes effect.
    function COMMISSION_DELAY() external view returns (uint64);
    /// @notice The token staked.
    function GBX() external view returns (IERC20);
    /// @notice The token fees are paid in.
    function USDC() external view returns (IERC20);
    /// @notice The registry the Boxes are read from.
    function NAMES() external view returns (IGameBoxNames);
}
