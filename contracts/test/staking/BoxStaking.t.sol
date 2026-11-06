// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {BoxStaking} from "../../src/staking/BoxStaking.sol";
import {IBoxStaking} from "../../src/staking/IBoxStaking.sol";
import {GBX} from "../../src/token/GBX.sol";
import {NamesFork} from "../names/NamesFork.sol";

/// @notice `BoxStaking` on a Sepolia fork, against the real Game Box names, a fresh GBX and Sepolia's real USDC.
contract BoxStakingTest is NamesFork {
    string internal constant BOX = "egbt-stake";

    uint256 internal constant MIN = 10_000 ether;
    uint64 internal constant UNSTAKE_DELAY = 1 days;
    uint64 internal constant COMMISSION_DELAY = 2 days;

    GBX internal gbx;
    IERC20 internal usdc;
    BoxStaking internal staking;

    address internal alice = account("alice");
    address internal bob = account("bob");
    address internal game = account("game");
    address internal slasher = account("slasher");
    address internal challenger = account("challenger");

    function setUp() public override {
        super.setUp();
        usdc = IERC20(vm.parseJsonAddress(vm.readFile("../deployments/sepolia.json"), ".external.USDC"));

        vm.startPrank(admin);
        gbx = new GBX();
        staking = new BoxStaking(gbx, usdc, names, admin, MIN, UNSTAKE_DELAY, COMMISSION_DELAY);
        staking.grantRole(staking.SLASHER_ROLE(), slasher);
        gbx.transfer(operator, 1_000_000 ether);
        gbx.transfer(alice, 1_000_000 ether);
        gbx.transfer(bob, 1_000_000 ether);
        vm.stopPrank();

        for (uint256 i; i < 3; ++i) {
            address who = [operator, alice, bob][i];
            vm.prank(who);
            gbx.approve(address(staking), type(uint256).max);
        }
        deal(address(usdc), game, 1_000_000e6);
        vm.prank(game);
        usdc.approve(address(staking), type(uint256).max);

        registerBox(BOX, 30 days);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------------------------

    function _stake(address who, uint256 amount) internal {
        vm.prank(who);
        staking.stake(BOX, amount);
    }

    function _fees(uint256 amount) internal {
        vm.prank(game);
        staking.notifyFees(BOX, amount);
    }

    function _bond() internal {
        _stake(operator, MIN);
    }

    function _position(address who) internal view returns (IBoxStaking.Position memory) {
        return staking.positionOf(BOX, who);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Setup
    // ----------------------------------------------------------------------------------------------------------------

    function test_constructor() public view {
        assertEq(address(staking.GBX()), address(gbx));
        assertEq(address(staking.USDC()), address(usdc));
        assertEq(address(staking.NAMES()), address(names));
        assertEq(staking.MIN_OPERATOR_STAKE(), MIN);
        assertEq(staking.UNSTAKE_DELAY(), UNSTAKE_DELAY);
        assertEq(staking.COMMISSION_DELAY(), COMMISSION_DELAY);
        assertEq(staking.MIN_COMMISSION_BPS(), 1_000);
        assertEq(staking.MAX_COMMISSION_BPS(), 9_000);
        assertTrue(staking.hasRole(staking.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_constructorRefusesZero() public {
        vm.expectRevert(IBoxStaking.ZeroValue.selector);
        new BoxStaking(gbx, usdc, names, admin, 0, UNSTAKE_DELAY, COMMISSION_DELAY);
        vm.expectRevert(IBoxStaking.ZeroValue.selector);
        new BoxStaking(gbx, usdc, names, address(0), MIN, UNSTAKE_DELAY, COMMISSION_DELAY);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Staking and bonding
    // ----------------------------------------------------------------------------------------------------------------

    function test_operatorBondsTheBox() public {
        assertFalse(staking.isBonded(BOX));
        _stake(operator, MIN - 1);
        assertFalse(staking.isBonded(BOX));
        _stake(operator, 1);
        assertTrue(staking.isBonded(BOX));

        IBoxStaking.BoxStake memory b = staking.boxStake(BOX);
        assertEq(b.stake, MIN);
        assertEq(b.operatorStake, MIN);
        assertEq(b.commissionBps, 1_000);
        assertTrue(b.bonded);
        assertEq(_position(operator).stake, MIN);
        assertEq(gbx.balanceOf(address(staking)), MIN);
    }

    function test_othersWaitForTheBond() public {
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.BoxNotBonded.selector, BOX));
        _stake(alice, 1 ether);
        _bond();
        _stake(alice, 500 ether);
        assertEq(_position(alice).stake, 500 ether);
        assertEq(staking.boxStake(BOX).stake, MIN + 500 ether);
    }

    function test_stakeForCreditsTheStaker() public {
        _bond();
        vm.prank(bob);
        staking.stakeFor(BOX, alice, 700 ether);
        assertEq(_position(alice).stake, 700 ether);
        assertEq(_position(bob).stake, 0);
        assertEq(gbx.balanceOf(bob), 1_000_000 ether - 700 ether);
    }

    function test_stakeForOperatorBondsTheBox() public {
        vm.prank(alice);
        staking.stakeFor(BOX, operator, MIN);
        assertTrue(staking.isBonded(BOX));
    }

    function test_stakeRefusals() public {
        vm.expectRevert(IBoxStaking.ZeroValue.selector);
        _stake(operator, 0);
        vm.prank(alice);
        vm.expectRevert(IBoxStaking.ZeroValue.selector);
        staking.stakeFor(BOX, address(0), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.BoxNotOpen.selector, "egbt-never"));
        vm.prank(operator);
        staking.stake("egbt-never", MIN);
    }

    function test_closedBoxRefusesStakeAndFees() public {
        _bond();
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Suspended);
        assertFalse(staking.isBonded(BOX));
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.BoxNotOpen.selector, BOX));
        _stake(operator, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.BoxNotOpen.selector, BOX));
        _fees(1e6);

        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Active);
        assertTrue(staking.isBonded(BOX));
    }

    function test_lapsedLicenceClosesTheBox() public {
        _bond();
        vm.warp(block.timestamp + 30 days);
        assertFalse(staking.isBonded(BOX));
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.BoxNotOpen.selector, BOX));
        _stake(operator, 1 ether);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Fees and rewards
    // ----------------------------------------------------------------------------------------------------------------

    function test_feesSplitByCommissionAndShare() public {
        _stake(operator, 30_000 ether);
        _stake(alice, 70_000 ether);
        vm.prank(operator);
        staking.setCommission(BOX, 3_000); // a raise with alice staked: waits
        vm.warp(block.timestamp + COMMISSION_DELAY);

        _fees(1_000e6);
        // 30% commission = 300 USDC to the operator; 700 split 30/70.
        assertEq(_position(operator).rewards, 300e6 + 210e6);
        assertEq(_position(alice).rewards, 490e6);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        assertEq(staking.claim(BOX), 490e6);
        assertEq(usdc.balanceOf(alice) - before, 490e6);
        assertEq(_position(alice).rewards, 0);

        vm.prank(operator);
        assertEq(staking.claim(BOX), 510e6);
    }

    function test_lateStakerEarnsOnlyLaterFees() public {
        _bond();
        _fees(100e6);
        _stake(alice, MIN);
        assertEq(_position(alice).rewards, 0);
        _fees(100e6);
        // Second fee: 10 commission, 90 split evenly.
        assertEq(_position(alice).rewards, 45e6);
        assertEq(_position(operator).rewards, 100e6 + 10e6 + 45e6);
    }

    function test_feesNeedABondedBox() public {
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.BoxNotBonded.selector, BOX));
        _fees(1e6);
        vm.expectRevert(IBoxStaking.ZeroValue.selector);
        _fees(0);
    }

    function test_claimWithNothingOwed() public {
        vm.prank(alice);
        assertEq(staking.claim(BOX), 0);
    }

    function test_rewardsSurviveAnUnstake() public {
        _bond();
        _stake(alice, MIN);
        _fees(200e6);
        vm.prank(alice);
        staking.requestUnstake(BOX, MIN);
        _fees(200e6); // alice has no stake now: the operator gets it all
        assertEq(_position(alice).rewards, 90e6);
        assertEq(_position(operator).rewards, 20e6 + 90e6 + 200e6);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Commission
    // ----------------------------------------------------------------------------------------------------------------

    function test_aloneTheOperatorSetsAnyCommissionAtOnce() public {
        _bond();
        vm.prank(operator);
        staking.setCommission(BOX, 9_000);
        assertEq(staking.boxStake(BOX).commissionBps, 9_000);
    }

    function test_raiseWaitsCutIsImmediate() public {
        _bond();
        _stake(alice, MIN);
        vm.prank(operator);
        vm.expectEmit(address(staking));
        emit IBoxStaking.CommissionSet(BOX, 5_000, uint64(block.timestamp) + COMMISSION_DELAY);
        staking.setCommission(BOX, 5_000);

        IBoxStaking.BoxStake memory b = staking.boxStake(BOX);
        assertEq(b.commissionBps, 1_000);
        assertEq(b.pendingCommissionBps, 5_000);
        _fees(100e6); // still at 10%
        assertEq(_position(alice).rewards, 45e6);

        vm.warp(block.timestamp + COMMISSION_DELAY);
        assertEq(staking.boxStake(BOX).commissionBps, 5_000);
        _fees(100e6); // now 50%
        assertEq(_position(alice).rewards, 45e6 + 25e6);

        vm.prank(operator);
        staking.setCommission(BOX, 2_000);
        assertEq(staking.boxStake(BOX).commissionBps, 2_000);
    }

    function test_cutCancelsAPendingRaise() public {
        _bond();
        _stake(alice, MIN);
        vm.startPrank(operator);
        staking.setCommission(BOX, 8_000);
        staking.setCommission(BOX, 1_000);
        vm.stopPrank();
        vm.warp(block.timestamp + COMMISSION_DELAY);
        IBoxStaking.BoxStake memory b = staking.boxStake(BOX);
        assertEq(b.commissionBps, 1_000);
        assertEq(b.pendingCommissionBps, 0);
    }

    function test_commissionRefusals() public {
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.CommissionOutOfRange.selector, 999));
        staking.setCommission(BOX, 999);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.CommissionOutOfRange.selector, 9_001));
        staking.setCommission(BOX, 9_001);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.NotOperator.selector, BOX, alice));
        staking.setCommission(BOX, 2_000);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Unstaking
    // ----------------------------------------------------------------------------------------------------------------

    function test_unstakeWaitsOutTheDelay() public {
        _bond();
        _stake(alice, 5_000 ether);
        vm.prank(alice);
        staking.requestUnstake(BOX, 2_000 ether);
        IBoxStaking.Position memory p = _position(alice);
        assertEq(p.stake, 3_000 ether);
        assertEq(p.unbonding, 2_000 ether);
        assertEq(p.unlockAt, block.timestamp + UNSTAKE_DELAY);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.StillUnbonding.selector, p.unlockAt));
        staking.withdraw(BOX);

        vm.warp(p.unlockAt);
        uint256 before = gbx.balanceOf(alice);
        vm.prank(alice);
        assertEq(staking.withdraw(BOX), 2_000 ether);
        assertEq(gbx.balanceOf(alice) - before, 2_000 ether);
        assertEq(_position(alice).unbonding, 0);

        vm.prank(alice);
        vm.expectRevert(IBoxStaking.NothingToWithdraw.selector);
        staking.withdraw(BOX);
    }

    function test_secondRequestRestartsTheDelay() public {
        _bond();
        _stake(alice, 5_000 ether);
        vm.prank(alice);
        staking.requestUnstake(BOX, 1_000 ether);
        vm.warp(block.timestamp + 12 hours);
        vm.prank(alice);
        staking.requestUnstake(BOX, 1_000 ether);
        IBoxStaking.Position memory p = _position(alice);
        assertEq(p.unbonding, 2_000 ether);
        assertEq(p.unlockAt, block.timestamp + UNSTAKE_DELAY);
    }

    function test_unstakeRefusals() public {
        _bond();
        _stake(alice, 1_000 ether);
        vm.startPrank(alice);
        vm.expectRevert(IBoxStaking.ZeroValue.selector);
        staking.requestUnstake(BOX, 0);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.InsufficientStake.selector, 1_001 ether, 1_000 ether));
        staking.requestUnstake(BOX, 1_001 ether);
        vm.stopPrank();
    }

    function test_operatorKeepsTheMinimumWhileOpen() public {
        _stake(operator, MIN + 100 ether);
        vm.startPrank(operator);
        staking.requestUnstake(BOX, 100 ether);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.BelowOperatorMinimum.selector, MIN - 1));
        staking.requestUnstake(BOX, 1);
        vm.stopPrank();

        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Revoked);
        vm.prank(operator);
        staking.requestUnstake(BOX, MIN);
        assertEq(_position(operator).stake, 0);
    }

    function test_claimAndWithdrawWorkAfterTheLicenceLapses() public {
        _bond();
        _stake(alice, MIN);
        _fees(100e6);
        vm.prank(alice);
        staking.requestUnstake(BOX, MIN);
        vm.warp(block.timestamp + 30 days);
        vm.startPrank(alice);
        assertEq(staking.claim(BOX), 45e6);
        assertEq(staking.withdraw(BOX), MIN);
        vm.stopPrank();
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Slashing
    // ----------------------------------------------------------------------------------------------------------------

    function test_slashTakesFromActiveAndUnbonding() public {
        _stake(operator, 20_000 ether);
        _stake(alice, 10_000 ether);
        vm.prank(alice);
        staking.requestUnstake(BOX, 4_000 ether);

        vm.prank(slasher);
        vm.expectEmit(address(staking));
        // Active 26,000 and unbonding 4,000: half of each.
        emit IBoxStaking.Slashed(BOX, 5_000, 15_000 ether, challenger);
        assertEq(staking.slash(BOX, 5_000, challenger), 15_000 ether);
        assertEq(gbx.balanceOf(challenger), 15_000 ether);

        assertApproxEqAbs(_position(operator).stake, 10_000 ether, 1);
        assertApproxEqAbs(_position(alice).stake, 3_000 ether, 1);
        assertApproxEqAbs(_position(alice).unbonding, 2_000 ether, 1);

        vm.warp(block.timestamp + UNSTAKE_DELAY);
        vm.prank(alice);
        assertApproxEqAbs(staking.withdraw(BOX), 2_000 ether, 1);
    }

    function test_slashCanUnbondTheBox() public {
        _bond();
        vm.prank(slasher);
        staking.slash(BOX, 1, challenger);
        assertFalse(staking.isBonded(BOX));
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.BoxNotBonded.selector, BOX));
        _stake(alice, 1 ether);
        _stake(operator, 1 ether);
        assertTrue(staking.isBonded(BOX));
    }

    function test_stakeAfterAFullSlashIsPricedFresh() public {
        _bond();
        vm.prank(slasher);
        staking.slash(BOX, 10_000, challenger);
        assertEq(staking.boxStake(BOX).stake, 0);
        assertEq(_position(operator).stake, 0);

        _stake(operator, MIN);
        assertApproxEqAbs(_position(operator).stake, MIN, 1);
        _stake(alice, MIN);
        assertApproxEqAbs(_position(alice).stake, MIN, 1);
    }

    function test_slashRefusals() public {
        bytes32 role = staking.SLASHER_ROLE();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, role));
        staking.slash(BOX, 1, challenger);
        vm.startPrank(slasher);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.SlashOutOfRange.selector, 0));
        staking.slash(BOX, 0, challenger);
        vm.expectRevert(abi.encodeWithSelector(IBoxStaking.SlashOutOfRange.selector, 10_001));
        staking.slash(BOX, 10_001, challenger);
        vm.expectRevert(IBoxStaking.ZeroValue.selector);
        staking.slash(BOX, 1, address(0));
        vm.stopPrank();
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Key rotation
    // ----------------------------------------------------------------------------------------------------------------

    function test_stakeOutlivesAKeyChange() public {
        _bond();
        _stake(alice, MIN);
        (bytes32 qx, bytes32 qy) = p256Public(p256Key("egb-test-new-box"));
        vm.prank(admin);
        names.setBoxKey(BOX, account("new-box"), qx, qy);
        assertTrue(staking.isBonded(BOX));
        assertEq(_position(alice).stake, MIN);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Fuzz
    // ----------------------------------------------------------------------------------------------------------------

    /// @dev Whatever the stakes, fees and commission, the rewards owed never exceed the USDC held, and each staker's
    ///      GBX comes back whole.
    function testFuzz_rewardsAreBacked(
        uint96 opExtra,
        uint96 aliceStake,
        uint96 bobStake,
        uint32 fee1,
        uint32 fee2,
        uint16 bps
    ) public {
        uint256 a = bound(aliceStake, 1 ether, 500_000 ether);
        uint256 b = bound(bobStake, 1 ether, 500_000 ether);
        uint256 o = MIN + bound(opExtra, 0, 500_000 ether);
        bps = uint16(bound(bps, 1_000, 9_000));

        _stake(operator, o);
        vm.prank(operator);
        staking.setCommission(BOX, bps);
        _stake(alice, a);
        _fees(bound(fee1, 1, 1_000_000e6));
        _stake(bob, b);
        _fees(bound(fee2, 1, 1_000_000e6));

        uint256 owed = _position(operator).rewards + _position(alice).rewards + _position(bob).rewards;
        assertLe(owed, usdc.balanceOf(address(staking)));
        assertApproxEqAbs(_position(alice).stake, a, 1);
        assertApproxEqAbs(_position(bob).stake, b, 1);
        assertApproxEqAbs(_position(operator).stake, o, 1);
    }
}
