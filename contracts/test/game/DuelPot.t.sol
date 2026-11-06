// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {IDuelPot} from "../../src/game/IDuelPot.sol";
import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {IBoxSigned} from "../../src/names/IBoxSigned.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NamesFork} from "../names/NamesFork.sol";

contract DuelPotTest is NamesFork {
    string internal constant BOX = "egbt-box";
    uint256 internal constant STAKE = 10e6;
    address internal alice;
    address internal bob;

    function setUp() public override {
        super.setUp();
        registerBox(BOX, 1 days);
        (alice,) = claim("egbt-alice");
        (bob,) = claim("egbt-bob");
        vm.startPrank(admin);
        usdc.mint(alice, 100e6);
        usdc.mint(bob, 100e6);
        vm.stopPrank();
    }

    function _stake(uint256 round) internal view returns (IDuelPot.Stake memory) {
        return IDuelPot.Stake(BOX, "stockduel", round, alice, bob, STAKE, block.timestamp + 1 hours);
    }

    function _open(IDuelPot.Stake memory s) internal {
        (bytes32 r, bytes32 ss) = p256Sign(boxKey, pot.stakeDigest(s));
        pot.open(s, r, ss);
    }

    function _expectRefused(IDuelPot.Stake memory s, bytes memory error) internal {
        (bytes32 r, bytes32 ss) = p256Sign(boxKey, pot.stakeDigest(s));
        vm.expectRevert(error);
        pot.open(s, r, ss);
    }

    function test_openPullsBothStakes() public {
        vm.expectEmit(address(pot));
        emit IDuelPot.PotOpened(BOX, "stockduel", 1, alice, bob, STAKE);
        _open(_stake(1));
        assertEq(usdc.balanceOf(address(pot)), 2 * STAKE);
        assertEq(usdc.balanceOf(alice), 90e6);
        assertEq(usdc.balanceOf(bob), 90e6);
        IDuelPot.Pot memory p = pot.getPot(BOX, 1);
        assertEq(p.a, alice);
        assertEq(p.b, bob);
        assertEq(p.amount, STAKE);
        assertEq(p.opened, block.timestamp);
        assertEq(uint8(p.state), uint8(IDuelPot.State.Open));
        assertEq(p.game, keccak256("stockduel"));
        assertEq(uint8(pot.getPot(BOX, 2).state), uint8(IDuelPot.State.None));
    }

    function test_theResultPaysTheWinner() public {
        _open(_stake(1));
        vm.expectEmit(address(pot));
        emit IDuelPot.PotSettled(BOX, 1, bob, false, STAKE);
        submit(result(BOX, "stockduel", 1, bob, alice, false));
        assertEq(usdc.balanceOf(bob), 110e6);
        assertEq(usdc.balanceOf(alice), 90e6);
        assertEq(usdc.balanceOf(address(pot)), 0);
        assertEq(uint8(pot.getPot(BOX, 1).state), uint8(IDuelPot.State.Settled));
        // The same signature crowned and counted.
        assertEq(names.getTitle("stockduel").holder, bob);
        assertEq(stats.statsOf(bob, "stockduel").wins, 1);
    }

    function test_aDrawRefundsBoth() public {
        _open(_stake(1));
        submit(result(BOX, "stockduel", 1, alice, bob, true));
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(bob), 100e6);
        assertEq(uint8(pot.getPot(BOX, 1).state), uint8(IDuelPot.State.Settled));
    }

    function test_aResultWithoutAPotStillSettles() public {
        submit(result(BOX, "stockduel", 1, alice, bob, false));
        assertEq(names.getTitle("stockduel").holder, alice);
        assertEq(uint8(pot.getPot(BOX, 1).state), uint8(IDuelPot.State.None));
    }

    function test_aResultForOtherPlayersOrGameReverts() public {
        (address carol,) = claim("egbt-carol");
        _open(_stake(1));
        IBoxResults.Result memory r = result(BOX, "stockduel", 1, carol, alice, false);
        (bytes32 sr, bytes32 ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.PotMismatch.selector, BOX, 1));
        results.submit(r, sr, ss);

        r = result(BOX, "quickdraw", 1, alice, bob, false);
        (sr, ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.PotMismatch.selector, BOX, 1));
        results.submit(r, sr, ss);
    }

    function test_refundAfterAnHour() public {
        _open(_stake(1));
        uint256 at = block.timestamp + 1 hours;
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.TooEarly.selector, at));
        pot.refund(BOX, 1);

        vm.warp(at);
        vm.expectEmit(address(pot));
        emit IDuelPot.PotRefunded(BOX, 1, STAKE);
        vm.prank(account("anyone"));
        pot.refund(BOX, 1);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(bob), 100e6);
        assertEq(uint8(pot.getPot(BOX, 1).state), uint8(IDuelPot.State.Refunded));

        vm.expectRevert(abi.encodeWithSelector(IDuelPot.PotNotOpen.selector, BOX, 1));
        pot.refund(BOX, 1);
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.PotNotOpen.selector, BOX, 2));
        pot.refund(BOX, 2);
    }

    function test_aSettledPotCantBeRefunded() public {
        _open(_stake(1));
        submit(result(BOX, "stockduel", 1, alice, bob, false));
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.PotNotOpen.selector, BOX, 1));
        pot.refund(BOX, 1);
    }

    function test_aRefundedPotLetsTheResultStand() public {
        _open(_stake(1));
        vm.warp(block.timestamp + 1 hours);
        pot.refund(BOX, 1);
        submit(result(BOX, "stockduel", 1, alice, bob, false));
        assertEq(names.getTitle("stockduel").holder, alice);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_replay() public {
        IDuelPot.Stake memory s = _stake(1);
        (bytes32 r, bytes32 ss) = p256Sign(boxKey, pot.stakeDigest(s));
        pot.open(s, r, ss);
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.PotExists.selector, BOX, 1));
        pot.open(s, r, ss);
        // Not even once it is settled.
        submit(result(BOX, "stockduel", 1, alice, bob, false));
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.PotExists.selector, BOX, 1));
        pot.open(s, r, ss);
    }

    function test_theWrongKey() public {
        IDuelPot.Stake memory s = _stake(1);
        (bytes32 r, bytes32 ss) = p256Sign(p256Key("egb-test-not-the-box"), pot.stakeDigest(s));
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        pot.open(s, r, ss);

        (r, ss) = p256Sign(boxKey, pot.stakeDigest(s));
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        pot.open(s, r, bytes32(P256_N - uint256(ss)));

        // The signature covers every field.
        s.amount = 50e6;
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        pot.open(s, r, ss);
    }

    function test_aSuspendedOrExpiredBox() public {
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Suspended);
        _expectRefused(_stake(1), abi.encodeWithSelector(IBoxSigned.BoxNotActive.selector, BOX));
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Active);

        vm.warp(block.timestamp + 1 days);
        _expectRefused(_stake(1), abi.encodeWithSelector(IBoxSigned.BoxExpired.selector, BOX));

        IDuelPot.Stake memory s = _stake(1);
        s.box = "egbt-nobox";
        _expectRefused(s, abi.encodeWithSelector(IBoxSigned.UnknownBox.selector, "egbt-nobox"));
    }

    function test_refusals() public {
        IDuelPot.Stake memory s = _stake(1);
        s.b = alice;
        _expectRefused(s, abi.encodeWithSelector(IDuelPot.SamePlayer.selector, alice));

        s = _stake(1);
        s.amount = 0;
        _expectRefused(s, abi.encodeWithSelector(IDuelPot.ZeroAmount.selector));

        s = _stake(1);
        s.deadline = block.timestamp - 1;
        _expectRefused(s, abi.encodeWithSelector(IBoxSigned.DeadlineExpired.selector, s.deadline));

        s = _stake(1);
        s.amount = 101e6;
        _expectRefused(s, abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 100e6, 101e6));
    }

    function test_onlyARefereeSettles() public {
        _open(_stake(1));
        address stranger = account("stranger");
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.NotReferee.selector, stranger));
        vm.prank(stranger);
        pot.settle(BOX, "stockduel", 1, stranger, alice, false);

        vm.prank(address(results));
        vm.expectRevert(abi.encodeWithSelector(IDuelPot.PotNotOpen.selector, BOX, 2));
        pot.settle(BOX, "stockduel", 2, alice, bob, false);
    }

    function test_domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = pot.eip712Domain();
        assertEq(name, "Game Box Stakes");
        assertEq(version, "1");
        assertEq(chainId, 11155111);
        assertEq(verifying, address(pot));
        assertEq(
            pot.STAKE_TYPEHASH(),
            keccak256("Stake(string box,string game,uint256 round,address a,address b,uint256 amount,uint256 deadline)")
        );
    }
}
