// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Pool} from "@uniswap/v4-core/src/libraries/Pool.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {IGameBoxHook} from "../../src/hook/IGameBoxHook.sol";
import {PriceOracle} from "../../src/hook/PriceOracle.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {HookFork} from "./HookFork.sol";

/// @notice `GameBoxHook` on the real Sepolia pool manager: the three fees, the Box's approval of a tap swap, the pool
///         it accepts, and its time-weighted price.
contract GameBoxHookTest is HookFork {
    using PoolIdLibrary for PoolKey;

    uint256 internal deadline;
    uint256 internal t0;

    function setUp() public override {
        super.setUp();
        t0 = block.timestamp;
        deadline = t0 + 1 hours;
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------------------------

    function tap(IPoolManager.SwapParams memory params, uint256 nonce) internal view returns (bytes memory) {
        return tapData(router, params, nonce, deadline, boxKey);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // The pool
    // ----------------------------------------------------------------------------------------------------------------

    function test_hookAddressCarriesItsFlags() public view {
        uint160 bits = uint160(address(hook)) & Hooks.ALL_HOOK_MASK;
        assertEq(bits, Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
    }

    function test_poolIsGbxUsdcWithDynamicFee() public view {
        assertEq(hook.poolId(), PoolId.unwrap(key.toId()));
        assertLt(uint160(Currency.unwrap(key.currency0)), uint160(Currency.unwrap(key.currency1)));
        assertEq(key.fee, LPFeeLibrary.DYNAMIC_FEE_FLAG);
        assertEq(key.tickSpacing, 60);
        assertEq(poolTick(), gbxIsToken0 ? GBX_PRICE_TICK : -GBX_PRICE_TICK);
    }

    function test_otherPoolsCannotUseTheHook() public {
        PoolKey memory fixedFee = key;
        fixedFee.fee = 3000;
        vm.expectRevert();
        manager.initialize(fixedFee, TickMath.getSqrtPriceAtTick(0));

        PoolKey memory otherSpacing = key;
        otherSpacing.tickSpacing = 10;
        vm.expectRevert();
        manager.initialize(otherSpacing, TickMath.getSqrtPriceAtTick(0));
    }

    function test_poolInitializesOnce() public {
        vm.expectRevert(abi.encodeWithSelector(Pool.PoolAlreadyInitialized.selector));
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
    }

    function test_onlyThePoolManagerCallsTheHook() public {
        vm.expectRevert(IGameBoxHook.NotPoolManager.selector);
        hook.beforeSwap(trader, key, buyGbx(1e6), "");
        vm.expectRevert(IGameBoxHook.NotPoolManager.selector);
        hook.afterInitialize(trader, key, TickMath.getSqrtPriceAtTick(0), 0);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Fees
    // ----------------------------------------------------------------------------------------------------------------

    function test_plainSwapPaysOnePercent() public {
        assertEq(swapFee(router, trader, buyGbx(100e6), ""), 10_000);
        assertEq(swapFee(router, trader, sellGbx(1000 ether), ""), 10_000);
    }

    function test_tapSwapPaysAQuarterPercent() public {
        IPoolManager.SwapParams memory params = buyGbx(100e6);
        bytes memory data = tap(params, 1);
        vm.expectEmit(address(hook));
        emit IGameBoxHook.TapSwapped(BOX, badge, address(router), 1);
        assertEq(swapFee(router, trader, params, data), 2_500);
        assertTrue(hook.nonceUsed(BOX, 1));
        assertFalse(hook.nonceUsed(BOX, 2));
    }

    function test_tapSwapCostsLessThanAPlainOne() public {
        uint256 before = gbx.balanceOf(trader);
        swap(router, trader, buyGbx(1000e6), "");
        uint256 plain = gbx.balanceOf(trader) - before;
        // Swap back so the second buy starts at the same price.
        swap(router, trader, sellGbx(plain), "");

        before = gbx.balanceOf(trader);
        IPoolManager.SwapParams memory params = buyGbx(1000e6);
        swap(router, trader, params, tap(params, 1));
        uint256 tapped = gbx.balanceOf(trader) - before;
        assertGt(tapped, plain);
    }

    function test_exemptRouterPaysNothing() public {
        bytes32 role = hook.FEE_EXEMPT_ROLE();
        vm.prank(admin);
        hook.grantRole(role, address(router));
        assertEq(swapFee(router, trader, buyGbx(100e6), ""), 0);
    }

    function test_onlyTheAdminExempts() public {
        bytes32 role = hook.FEE_EXEMPT_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, trader, bytes32(0))
        );
        vm.prank(trader);
        hook.grantRole(role, address(router));
    }

    // ----------------------------------------------------------------------------------------------------------------
    // The Box's approval
    // ----------------------------------------------------------------------------------------------------------------

    function test_tapSwapRefusesAReplay() public {
        IPoolManager.SwapParams memory params = buyGbx(100e6);
        bytes memory data = tap(params, 1);
        swap(router, trader, params, data);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.NonceUsed.selector, BOX, 1));
        swap(router, trader, params, data);
    }

    function test_tapSwapRefusesAPassedDeadline() public {
        IPoolManager.SwapParams memory params = buyGbx(100e6);
        bytes memory data = tap(params, 1);
        vm.warp(deadline + 1);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.DeadlineExpired.selector, deadline));
        swap(router, trader, params, data);
    }

    function test_tapSwapRefusesAnotherKey() public {
        IPoolManager.SwapParams memory params = buyGbx(100e6);
        bytes memory data = tapData(router, params, 1, deadline, p256Key("egb-test-other-box"));
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.InvalidSignature.selector));
        swap(router, trader, params, data);
    }

    function test_tapSwapRefusesAnotherAmountOrDirection() public {
        bytes memory data = tap(buyGbx(100e6), 1);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.InvalidSignature.selector));
        swap(router, trader, buyGbx(1000e6), data);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.InvalidSignature.selector));
        swap(router, trader, sellGbx(100e6), data);
    }

    function test_tapSwapRefusesAnotherRouter() public {
        PoolSwapTest other = new PoolSwapTest(manager);
        vm.startPrank(trader);
        gbx.approve(address(other), type(uint256).max);
        usdc.approve(address(other), type(uint256).max);
        vm.stopPrank();

        IPoolManager.SwapParams memory params = buyGbx(100e6);
        bytes memory data = tap(params, 1);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.InvalidSignature.selector));
        swap(other, trader, params, data);
    }

    function test_tapSwapRefusesAClosedBox() public {
        IPoolManager.SwapParams memory params = buyGbx(100e6);
        bytes memory data = tap(params, 1);

        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Suspended);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.BoxNotActive.selector, BOX));
        swap(router, trader, params, data);

        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Active);
        vm.warp(t0 + 30 days);
        bytes memory late = tapData(router, params, 1, block.timestamp + 1 hours, boxKey);
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.BoxExpired.selector, BOX));
        swap(router, trader, params, late);
    }

    function test_tapSwapRefusesAnUnknownBox() public {
        IPoolManager.SwapParams memory params = buyGbx(100e6);
        bytes memory data = abi.encode(
            IGameBoxHook.TapSwapData({
                box: "egbt-nobox",
                badge: badge,
                nonce: 1,
                deadline: deadline,
                r: bytes32(uint256(1)),
                s: bytes32(uint256(1))
            })
        );
        expectHookRevert(abi.encodeWithSelector(IGameBoxHook.UnknownBox.selector, "egbt-nobox"));
        swap(router, trader, params, data);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // The time-weighted price
    // ----------------------------------------------------------------------------------------------------------------

    function test_meanTickHoldsTheStartingPrice() public {
        vm.warp(t0 + 600);
        assertEq(hook.meanTick(600), poolTick());
        assertEq(hook.meanTick(60), poolTick());
    }

    function test_meanTickWeighsEachPriceByItsTime() public {
        int24 start = poolTick();
        vm.warp(t0 + 300);
        swap(router, trader, buyGbx(50_000e6), "");
        int24 moved = poolTick();
        assertTrue(moved != start);

        vm.warp(t0 + 600);
        uint32[] memory ago = new uint32[](3);
        (ago[0], ago[1], ago[2]) = (600, 150, 0);
        int56[] memory sums = hook.observe(ago);
        assertEq(sums[2] - sums[0], int56(start) * 300 + int56(moved) * 300);
        // 150 seconds ago lies after the swap.
        assertEq(sums[2] - sums[1], int56(moved) * 150);
        assertEq(hook.meanTick(300), moved);
    }

    function test_observeInterpolatesBetweenSwaps() public {
        int24 start = poolTick();
        vm.warp(t0 + 300);
        swap(router, trader, buyGbx(50_000e6), "");
        int24 moved = poolTick();
        vm.warp(t0 + 600);
        swap(router, trader, sellGbx(1_000_000 ether), "");
        vm.warp(t0 + 700);

        uint32[] memory ago = new uint32[](2);
        (ago[0], ago[1]) = (700, 250); // t0 and t0 + 450, between the two swaps
        int56[] memory sums = hook.observe(ago);
        assertEq(sums[1] - sums[0], int56(start) * 300 + int56(moved) * 150);
    }

    function test_aPriceMovedWithinOneBlockCountsForNothing() public {
        int24 start = poolTick();
        vm.warp(t0 + 300);
        // Up and back in the same second.
        swap(router, trader, buyGbx(50_000e6), "");
        swap(router, trader, sellGbx(100 ether), "");
        int24 end = poolTick();
        vm.warp(t0 + 600);
        uint32[] memory ago = new uint32[](2);
        (ago[0], ago[1]) = (600, 0);
        int56[] memory sums = hook.observe(ago);
        assertEq(sums[1] - sums[0], int56(start) * 300 + int56(end) * 300);
    }

    function test_meanTickRefusesAWindowBeforeThePool() public {
        vm.warp(t0 + 600);
        vm.expectRevert(
            abi.encodeWithSelector(PriceOracle.ObservationTooOld.selector, uint32(t0 - 1), uint32(t0))
        );
        hook.meanTick(601);
    }
}
