// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {GameBoxLobby} from "../../src/hook/GameBoxLobby.sol";
import {IGameBoxHook} from "../../src/hook/IGameBoxHook.sol";
import {IGameBoxLobby} from "../../src/hook/IGameBoxLobby.sol";
import {BoxStaking} from "../../src/staking/BoxStaking.sol";
import {HookFork} from "./HookFork.sol";

/// @notice `GameBoxLobby` on the Sepolia fork: a tap buys GBX with minted USDC through the real pool manager at the
///         hook's tap fee, and the GBX goes to the badge, or to the Box's stake once the Box is bonded.
contract GameBoxLobbyTest is HookFork {
    uint256 internal constant MIN = 10_000 ether;

    BoxStaking internal staking;
    GameBoxLobby internal lobby;
    uint256 internal deadline;

    function setUp() public override {
        super.setUp();
        staking = new BoxStaking(gbx, usdc, names, admin, MIN, 1 hours, 1 hours);
        lobby = new GameBoxLobby(hook, staking);
        bytes32 minter = fakeUsdc.MINTER_ROLE();
        vm.prank(admin);
        fakeUsdc.grantRole(minter, address(lobby));
        deadline = block.timestamp + 1 hours;
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------------------------

    function order(uint256 usdcIn, uint256 nonce) internal view returns (IGameBoxLobby.Buy memory) {
        return
            IGameBoxLobby.Buy({box: BOX, badge: badge, usdcIn: usdcIn, minGbxOut: 0, nonce: nonce, deadline: deadline});
    }

    /// @notice The Box's P-256 signature of `o`, made with `key`.
    function sign(IGameBoxLobby.Buy memory o, uint256 key) internal view returns (bytes32 r, bytes32 s) {
        return p256Sign(key, hook.tapSwapDigest(lobby.tapSwapOf(o)));
    }

    function buy(IGameBoxLobby.Buy memory o) internal returns (uint256 gbxOut, bool staked) {
        (bytes32 r, bytes32 s) = sign(o, boxKey);
        return lobby.buy(o, r, s);
    }

    /// @notice The Box's operator stakes the minimum, so the Box is bonded.
    function bond() internal {
        vm.prank(admin);
        gbx.transfer(operator, MIN);
        vm.startPrank(operator);
        gbx.approve(address(staking), MIN);
        staking.stake(BOX, MIN);
        vm.stopPrank();
        assertTrue(staking.isBonded(BOX));
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Buying
    // ----------------------------------------------------------------------------------------------------------------

    function test_buySendsGbxToTheBadgeAtTheTapFee() public {
        uint256 supply = usdc.totalSupply();

        vm.recordLogs();
        (uint256 gbxOut, bool staked) = buy(order(10e6, 1));

        assertEq(recordedSwapFee(), hook.TAP_FEE());
        assertFalse(staked);
        assertEq(gbx.balanceOf(badge), gbxOut);
        // About 100 GBX for 10 USDC at 0.10, less the 0.25% fee and a little price impact.
        assertApproxEqRel(gbxOut, 99.75 ether, 0.01e18);
        // The lobby minted exactly what the swap took, and keeps nothing.
        assertEq(usdc.totalSupply(), supply + 10e6);
        assertEq(gbx.balanceOf(address(lobby)), 0);
        assertEq(usdc.balanceOf(address(lobby)), 0);
        assertTrue(hook.nonceUsed(BOX, 1));
    }

    function test_buyEmitsBought() public {
        (bytes32 r, bytes32 s) = sign(order(10e6, 1), boxKey);
        vm.expectEmit(false, true, false, false, address(lobby));
        emit IGameBoxLobby.Bought(BOX, badge, 10e6, 0, false);
        lobby.buy(order(10e6, 1), r, s);
    }

    function test_buyStakesToABondedBox() public {
        bond();

        (uint256 gbxOut, bool staked) = buy(order(10e6, 1));

        assertTrue(staked);
        assertEq(gbx.balanceOf(badge), 0);
        assertApproxEqAbs(staking.positionOf(BOX, badge).stake, gbxOut, 1);
        assertEq(gbx.balanceOf(address(lobby)), 0);
    }

    function test_buyCostsLessGbxThanAPlainSwap() public {
        uint256 snap = vm.snapshotState();
        (uint256 tapOut,) = buy(order(10e6, 1));
        vm.revertToState(snap);

        uint256 before = gbx.balanceOf(trader);
        swap(router, trader, buyGbx(10e6), "");
        assertGt(tapOut, gbx.balanceOf(trader) - before);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Limits
    // ----------------------------------------------------------------------------------------------------------------

    function test_buyRefusesZeroAndMoreThanMaxBuy() public {
        vm.expectRevert(abi.encodeWithSelector(IGameBoxLobby.BadAmount.selector, 0));
        lobby.buy(order(0, 1), 0, 0);

        uint256 tooMuch = lobby.MAX_BUY() + 1;
        vm.expectRevert(abi.encodeWithSelector(IGameBoxLobby.BadAmount.selector, tooMuch));
        lobby.buy(order(tooMuch, 1), 0, 0);
    }

    function test_buyStopsAtTheDailyCapAndResetsTheNextDay() public {
        uint256 max = lobby.MAX_BUY();
        uint256 buys = lobby.DAILY_CAP() / max;
        for (uint256 i; i < buys; ++i) {
            buy(order(max, i + 1));
        }
        uint256 day = block.timestamp / 1 days;
        assertEq(lobby.boughtOn(BOX, day), lobby.DAILY_CAP());

        IGameBoxLobby.Buy memory over = order(1e6, buys + 1);
        (bytes32 r, bytes32 s) = sign(over, boxKey);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxLobby.DailyCapReached.selector, BOX, lobby.DAILY_CAP()));
        lobby.buy(over, r, s);

        vm.warp((day + 1) * 1 days);
        over.deadline = block.timestamp + 1 hours;
        buy(over);
        assertEq(lobby.boughtOn(BOX, day + 1), 1e6);
    }

    function test_buyRefusesTooLittleOut() public {
        IGameBoxLobby.Buy memory o = order(10e6, 1);
        o.minGbxOut = 1_000 ether;
        (bytes32 r, bytes32 s) = sign(o, boxKey);
        vm.expectPartialRevert(IGameBoxLobby.TooLittleOut.selector);
        lobby.buy(o, r, s);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // The Box's approval
    // ----------------------------------------------------------------------------------------------------------------

    function test_buyRefusesAnotherKey() public {
        IGameBoxLobby.Buy memory o = order(10e6, 1);
        (bytes32 r, bytes32 s) = sign(o, p256Key("not-the-box"));
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.InvalidSignature.selector));
        lobby.buy(o, r, s);
    }

    function test_buyRefusesAnApprovalForAnotherAmount() public {
        (bytes32 r, bytes32 s) = sign(order(10e6, 1), boxKey);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.InvalidSignature.selector));
        lobby.buy(order(20e6, 1), r, s);
    }

    function test_buyRefusesAnApprovalForAnotherRouter() public {
        // Signed for the test router, as `GameBoxHook`'s own tests do, so it can't be spent through the lobby.
        IGameBoxLobby.Buy memory o = order(10e6, 1);
        IGameBoxHook.TapSwap memory viaRouter = lobby.tapSwapOf(o);
        viaRouter.sender = address(router);
        (bytes32 r, bytes32 s) = p256Sign(boxKey, hook.tapSwapDigest(viaRouter));
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.InvalidSignature.selector));
        lobby.buy(o, r, s);
    }

    function test_buyRefusesAReplay() public {
        IGameBoxLobby.Buy memory o = order(10e6, 1);
        (bytes32 r, bytes32 s) = sign(o, boxKey);
        lobby.buy(o, r, s);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.NonceUsed.selector, BOX, 1));
        lobby.buy(o, r, s);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Setup
    // ----------------------------------------------------------------------------------------------------------------

    function test_onlyThePoolManagerCallsBack() public {
        vm.expectRevert(IGameBoxLobby.NotPoolManager.selector);
        lobby.unlockCallback(abi.encode(uint256(10e6), bytes("")));
    }

    function test_buyNeedsTheLobbyToMint() public {
        bytes32 minter = fakeUsdc.MINTER_ROLE();
        vm.prank(admin);
        fakeUsdc.revokeRole(minter, address(lobby));
        IGameBoxLobby.Buy memory o = order(10e6, 1);
        (bytes32 r, bytes32 s) = sign(o, boxKey);
        vm.expectPartialRevert(IAccessControl.AccessControlUnauthorizedAccount.selector);
        lobby.buy(o, r, s);
    }

    function test_constructorReadsThePoolFromTheHook() public view {
        assertEq(address(lobby.POOL_MANAGER()), address(manager));
        assertEq(address(lobby.GBX()), address(gbx));
        assertEq(address(lobby.USDC()), address(usdc));
        assertEq(lobby.tapSwapOf(order(10e6, 1)).zeroForOne, !gbxIsToken0);
        assertEq(lobby.tapSwapOf(order(10e6, 1)).amountSpecified, -10e6);
    }
}
