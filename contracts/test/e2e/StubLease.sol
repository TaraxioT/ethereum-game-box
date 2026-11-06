// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IBoxLease} from "../../src/staking/IBoxLease.sol";

/// @title StubLease
/// @notice The slice of `BoxLease` a Box's lease gate reads, for `pnpm store:e2e`, which runs on a bare anvil: every
///         label holds a lease that runs far past the run, so the Box's real gate opens.
contract StubLease {
    uint256 public constant RATE_PER_HOUR = 1 ether;
    uint64 public constant MIN_HOURS = 1;
    uint64 public constant MAX_HOURS = 720;

    /// @notice A label's lease, as `IBoxLease.leaseOf`.
    function leaseOf(string calldata) external view returns (IBoxLease.Lease memory) {
        return IBoxLease.Lease(address(this), 1 ether, uint64(block.timestamp), uint64(block.timestamp + 365 days));
    }
}
