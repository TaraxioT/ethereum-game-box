// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IP256AccountFactory} from "../box/IP256AccountFactory.sol";
import {IGameBoxNames} from "../names/IGameBoxNames.sol";

/// @title IBoxLease
/// @notice A Box runs while GBX is staked on it. Staking `hours_ × RATE_PER_HOUR` GBX leases the Box for that many
///         hours: its name `<label>.gamebox.eth` goes `Active` in `GameBoxNames` (registered to the staker with the
///         Box's P-256 key if it had no name; kept, with its records, if it had one). Unstaking gives every GBX back
///         and suspends the name at once, so every Box-signed call (`BoxCheck`) refuses it until someone stakes again.
///         A lease that runs out is closed by anyone with `lapse`: the GBX goes back and the name is suspended.
/// @dev - The stake is a deposit, not a fee: it all comes back, on `unstake` or `lapse`.
///      - Staking again while the lease runs (the same operator) adds the hours to its end and the GBX to its stake.
///      - Once a lease has run out, anyone may stake: the last operator is paid back in the same transaction.
///      - The protocol admin bans a Box with `GameBoxNames.setBoxStatus(label, Revoked)`: a revoked Box can't be
///        staked. `Suspended` is this contract's own "no lease" state, which a stake lifts.
///      - This contract needs `LICENSOR_ROLE` on `GameBoxNames`.
interface IBoxLease {
    /// @notice A Box's lease.
    /// @param operator Who staked, and gets the GBX back.
    /// @param stake The GBX held.
    /// @param start When the lease began (unix seconds).
    /// @param end When it runs out (unix seconds).
    struct Lease {
        address operator;
        uint256 stake;
        uint64 start;
        uint64 end;
    }

    /// @notice `operator` staked `amount` GBX on `label` for `hours_` more hours: the lease now ends at `end`.
    event Staked(string label, address indexed operator, uint256 amount, uint64 hours_, uint64 end);
    /// @notice `label`'s lease closed and `amount` GBX went back to `operator`: unstaked, or `lapsed` after its end.
    event Unstaked(string label, address indexed operator, uint256 amount, bool lapsed);

    /// @notice `hours_` is outside `MIN_HOURS` to `MAX_HOURS`.
    error HoursOutOfRange(uint64 hours_);
    /// @notice Another operator's lease runs until `end`.
    error LeaseHeld(string label, address operator, uint64 end);
    /// @notice Only the lease's operator may do this.
    error NotOperator(string label, address caller);
    /// @notice No GBX is staked on `label`.
    error NoLease(string label);
    /// @notice The lease runs until `end`: only its operator may close it before then.
    error LeaseRunning(string label, uint64 end);
    /// @notice The protocol admin revoked the Box.
    error BoxRevoked(string label);
    /// @notice The key given isn't the one `label` is registered with.
    error WrongKey(string label);

    /// @notice Stakes `hours_ × RATE_PER_HOUR` GBX of the caller's on `label` (approve it first) and leases the Box for
    ///         `hours_` more hours. A Box with no name is registered to the caller with `(qx, qy)`; a named Box must
    ///         give its own key.
    /// @param label The Box's label under `gamebox.eth`.
    /// @param qx The Box's P-256 public key, x.
    /// @param qy The Box's P-256 public key, y.
    /// @param hours_ How many hours, `MIN_HOURS` to `MAX_HOURS`.
    /// @return end When the lease now runs out.
    function stake(string calldata label, bytes32 qx, bytes32 qy, uint64 hours_) external returns (uint64 end);

    /// @notice Closes the caller's lease on `label` now: every GBX back, and the Box's name suspended.
    /// @param label The Box's label.
    /// @return amount The GBX sent back.
    function unstake(string calldata label) external returns (uint256 amount);

    /// @notice Closes a lease that has run out: its GBX goes back to its operator and the name is suspended. Anyone.
    /// @param label The Box's label.
    /// @return amount The GBX sent back.
    function lapse(string calldata label) external returns (uint256 amount);

    /// @notice `label`'s lease, zero when it has none.
    function leaseOf(string calldata label) external view returns (Lease memory);

    /// @notice The GBX that `hours_` hours cost to stake.
    function quote(uint64 hours_) external view returns (uint256);

    /// @notice GBX staked per hour of lease.
    function RATE_PER_HOUR() external view returns (uint256);

    /// @notice The shortest lease, in hours.
    function MIN_HOURS() external view returns (uint64);

    /// @notice The longest single stake, in hours.
    function MAX_HOURS() external view returns (uint64);

    /// @notice The staked token.
    function GBX() external view returns (IERC20);

    /// @notice The registrar whose Box names a lease turns on and off.
    function NAMES() external view returns (IGameBoxNames);

    /// @notice Deploys a new Box's account from its key.
    function FACTORY() external view returns (IP256AccountFactory);
}
