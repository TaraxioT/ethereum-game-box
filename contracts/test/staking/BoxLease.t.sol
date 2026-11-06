// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {IBoxSigned} from "../../src/names/IBoxSigned.sol";
import {BoxLease} from "../../src/staking/BoxLease.sol";
import {IBoxLease} from "../../src/staking/IBoxLease.sol";
import {GBX} from "../../src/token/GBX.sol";
import {NamesFork} from "../names/NamesFork.sol";

/// @notice `BoxLease` on a Sepolia fork, against the real Game Box names and a fresh GBX: staking turns a Box's name
///         on (registering it, or keeping the one it has), unstaking turns it off and gives the GBX back.
contract BoxLeaseTest is NamesFork {
    string internal constant BOX = "egbt-lease";
    string internal constant BOX_NAME = "egbt-lease.gamebox.eth";

    GBX internal gbx;
    BoxLease internal lease;
    bytes32 internal qx;
    bytes32 internal qy;

    address internal rival = account("rival");

    function setUp() public override {
        super.setUp();
        (qx, qy) = p256Public(boxKey);
        vm.startPrank(admin);
        gbx = new GBX();
        lease = new BoxLease(names, gbx, accounts);
        names.grantRole(names.LICENSOR_ROLE(), address(lease));
        gbx.transfer(operator, 1_000_000 ether);
        gbx.transfer(rival, 1_000_000 ether);
        vm.stopPrank();
        vm.prank(operator);
        gbx.approve(address(lease), type(uint256).max);
        vm.prank(rival);
        gbx.approve(address(lease), type(uint256).max);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------------------------

    function _stake(address who, uint64 hours_) internal returns (uint64) {
        vm.prank(who);
        return lease.stake(BOX, qx, qy, hours_);
    }

    function _status() internal view returns (IGameBoxNames.BoxStatus) {
        return names.getBox(BOX).status;
    }

    /// @dev A Box-signed result for the box: refused unless the Box is live and Active.
    function _submit() internal {
        (address alice,) = claim("egbt-lalice");
        (address bob,) = claim("egbt-lbob");
        submit(result(BOX, "stockduel", 1, alice, bob, false));
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Stake
    // ----------------------------------------------------------------------------------------------------------------

    function test_stakeRegistersANewBoxToTheStaker() public {
        uint64 end = _stake(operator, 3);

        assertEq(end, block.timestamp + 3 hours);
        IGameBoxNames.Box memory box = names.getBox(BOX);
        assertEq(uint8(box.status), uint8(IGameBoxNames.BoxStatus.Active));
        assertEq(box.operator, operator);
        assertEq(box.account, accounts.accountOf(qx, qy));
        assertEq(box.expiry, end);
        assertEq(resolveAddr(BOX_NAME), accounts.accountOf(qx, qy));
        assertEq(gbx.balanceOf(address(lease)), 300 ether);
        IBoxLease.Lease memory l = lease.leaseOf(BOX);
        assertEq(l.operator, operator);
        assertEq(l.stake, 300 ether);
        assertEq(l.start, block.timestamp);
        assertEq(l.end, end);
        _submit();
    }

    function test_stakeKeepsAnExistingNameAndItsOperator() public {
        address resolver = registerBox(BOX, 1 hours);
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Suspended);

        uint64 end = _stake(rival, 5);

        IGameBoxNames.Box memory box = names.getBox(BOX);
        assertEq(uint8(box.status), uint8(IGameBoxNames.BoxStatus.Active));
        assertEq(box.resolver, resolver, "same name, same records");
        assertEq(box.operator, operator, "the name's operator is kept");
        assertEq(box.expiry, end, "renewed to the lease's end");
        assertEq(resolveText(BOX_NAME, "status"), "active");
        assertEq(lease.leaseOf(BOX).operator, rival);
    }

    function test_stakeDoesNotShortenALongerName() public {
        registerBox(BOX, 30 days);
        uint64 expiry = names.getBox(BOX).expiry;
        _stake(operator, 1);
        assertEq(names.getBox(BOX).expiry, expiry);
    }

    function test_stakeAgainExtendsTheLease() public {
        uint64 first = _stake(operator, 2);
        vm.warp(block.timestamp + 1 hours);
        uint64 second = _stake(operator, 4);

        assertEq(second, first + 4 hours);
        IBoxLease.Lease memory l = lease.leaseOf(BOX);
        assertEq(l.stake, 600 ether);
        assertEq(l.start, first - 2 hours);
        assertEq(names.getBox(BOX).expiry, second);
    }

    function test_stakeRefusesAnotherOperatorWhileTheLeaseRuns() public {
        uint64 end = _stake(operator, 2);
        vm.expectRevert(abi.encodeWithSelector(IBoxLease.LeaseHeld.selector, BOX, operator, end));
        _stake(rival, 1);
    }

    function test_stakeAfterARunOutLeasePaysTheLastOperatorBack() public {
        uint64 end = _stake(operator, 2);
        vm.warp(end);
        uint256 before = gbx.balanceOf(operator);

        _stake(rival, 1);

        assertEq(gbx.balanceOf(operator), before + 200 ether);
        assertEq(lease.leaseOf(BOX).operator, rival);
        assertEq(lease.leaseOf(BOX).stake, 100 ether);
    }

    function test_stakeRefusesHoursOutOfRange() public {
        vm.expectRevert(abi.encodeWithSelector(IBoxLease.HoursOutOfRange.selector, 0));
        _stake(operator, 0);
        vm.expectRevert(abi.encodeWithSelector(IBoxLease.HoursOutOfRange.selector, 721));
        _stake(operator, 721);
    }

    function test_stakeRefusesTheWrongKey() public {
        registerBox(BOX, 1 hours);
        (bytes32 ox, bytes32 oy) = p256Public(p256Key("egb-test-other"));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IBoxLease.WrongKey.selector, BOX));
        lease.stake(BOX, ox, oy, 1);
    }

    function test_stakeRefusesARevokedBox() public {
        registerBox(BOX, 1 hours);
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Revoked);
        vm.expectRevert(abi.encodeWithSelector(IBoxLease.BoxRevoked.selector, BOX));
        _stake(operator, 1);
    }

    function test_stakeRevivesAnExpiredName() public {
        registerBox(BOX, 1 hours);
        vm.warp(block.timestamp + 2 hours);
        uint64 end = _stake(operator, 1);
        assertEq(names.getBox(BOX).expiry, end);
        _submit();
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Unstake and lapse
    // ----------------------------------------------------------------------------------------------------------------

    function test_unstakeRefundsAndStopsTheBox() public {
        _stake(operator, 3);
        uint256 before = gbx.balanceOf(operator);

        vm.prank(operator);
        uint256 amount = lease.unstake(BOX);

        assertEq(amount, 300 ether);
        assertEq(gbx.balanceOf(operator), before + 300 ether);
        assertEq(lease.leaseOf(BOX).operator, address(0));
        assertEq(uint8(_status()), uint8(IGameBoxNames.BoxStatus.Suspended));
        assertEq(resolveText(BOX_NAME, "status"), "suspended");
        assertEq(resolveAddr(BOX_NAME), accounts.accountOf(qx, qy), "the name stays");

        (address alice,) = claim("egbt-lalice");
        (address bob,) = claim("egbt-lbob");
        IBoxResults.Result memory r = result(BOX, "stockduel", 1, alice, bob, false);
        (bytes32 sr, bytes32 ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(abi.encodeWithSelector(IBoxSigned.BoxNotActive.selector, BOX));
        results.submit(r, sr, ss);

        // Staking again turns it back on.
        _stake(operator, 1);
        assertEq(uint8(_status()), uint8(IGameBoxNames.BoxStatus.Active));
        results.submit(r, sr, ss);
    }

    function test_unstakeIsTheOperatorsAlone() public {
        _stake(operator, 1);
        vm.prank(rival);
        vm.expectRevert(abi.encodeWithSelector(IBoxLease.NotOperator.selector, BOX, rival));
        lease.unstake(BOX);
    }

    function test_unstakeWithoutALease() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IBoxLease.NoLease.selector, BOX));
        lease.unstake(BOX);
    }

    function test_unstakeLeavesARevokedBoxRevoked() public {
        _stake(operator, 1);
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Revoked);
        vm.prank(operator);
        lease.unstake(BOX);
        assertEq(uint8(_status()), uint8(IGameBoxNames.BoxStatus.Revoked));
    }

    function test_lapseWaitsForTheEnd() public {
        uint64 end = _stake(operator, 2);
        vm.expectRevert(abi.encodeWithSelector(IBoxLease.LeaseRunning.selector, BOX, end));
        lease.lapse(BOX);

        vm.warp(end);
        uint256 before = gbx.balanceOf(operator);
        vm.prank(rival);
        assertEq(lease.lapse(BOX), 200 ether);
        assertEq(gbx.balanceOf(operator), before + 200 ether);
        assertEq(uint8(_status()), uint8(IGameBoxNames.BoxStatus.Suspended));
    }

    function test_quote() public view {
        assertEq(lease.quote(1), 100 ether);
        assertEq(lease.quote(720), 72_000 ether);
    }
}
