// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {GbxPool} from "../../script/uniswap/GbxPool.sol";
import {IPermit2} from "../../script/uniswap/IPermit2.sol";
import {IPositionManager} from "../../script/uniswap/IPositionManager.sol";
import {PoolSeed} from "../../script/uniswap/PoolSeed.sol";
import {HookFork} from "./HookFork.sol";

/// @notice `PoolSeed` on the Sepolia fork, through the real v4 `PositionManager` and `Permit2`: it opens the GBX/USDC
///         pool at 0.10 USDC per GBX, deposits both sides full-range as a position the owner holds, and is safe to run
///         again.
contract PoolSeedTest is HookFork {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPositionManager internal positions;
    IPermit2 internal permit2;

    function setUp() public override {
        string memory json = vm.readFile("../deployments/sepolia.json");
        positions = IPositionManager(vm.parseJsonAddress(json, ".external.PositionManager"));
        permit2 = IPermit2(vm.parseJsonAddress(json, ".external.Permit2"));
        super.setUp();
    }

    /// @dev Each test opens the pool itself.
    function openPool() internal override {}

    /// @notice Seeds the pool as `lp` with the GBX pool's opening; external so a test can expect its revert.
    function seedAsLp() external returns (uint256 tokenId) {
        vm.startPrank(lp);
        tokenId = PoolSeed.seed(
            PoolSeed.Seed({
                manager: manager,
                positions: positions,
                permit2: permit2,
                key: key,
                sqrtPriceX96: GbxPool.sqrtPriceX96(gbxIsToken0),
                tickRange: GbxPool.FULL_RANGE_TICK,
                amount0: gbxIsToken0 ? GbxPool.SEED_GBX : GbxPool.SEED_USDC,
                amount1: gbxIsToken0 ? GbxPool.SEED_USDC : GbxPool.SEED_GBX,
                owner: lp
            })
        );
        vm.stopPrank();
    }

    function test_seed_opensThePoolAtTenCentsWithAFullRangePosition() public {
        uint256 gbxBefore = gbx.balanceOf(lp);
        uint256 usdcBefore = usdc.balanceOf(lp);

        uint256 tokenId = this.seedAsLp();

        assertEq(poolTick(), gbxIsToken0 ? GBX_PRICE_TICK : -GBX_PRICE_TICK);
        assertEq(positions.ownerOf(tokenId), lp);
        uint128 liquidity = manager.getLiquidity(key.toId());
        assertGt(liquidity, 0);
        assertEq(positions.getPositionLiquidity(tokenId), liquidity);

        // Both sides go in at the opening price, all but rounding of the scarcer one.
        uint256 gbxIn = gbxBefore - gbx.balanceOf(lp);
        uint256 usdcIn = usdcBefore - usdc.balanceOf(lp);
        assertLe(gbxIn, GbxPool.SEED_GBX);
        assertLe(usdcIn, GbxPool.SEED_USDC);
        assertApproxEqRel(gbxIn, GbxPool.SEED_GBX, 0.01e18);
        assertApproxEqRel(usdcIn, GbxPool.SEED_USDC, 0.01e18);
    }

    function test_seed_twiceAddsNothing() public {
        this.seedAsLp();
        uint128 liquidity = manager.getLiquidity(key.toId());
        uint256 gbxHeld = gbx.balanceOf(lp);

        assertEq(this.seedAsLp(), 0);
        assertEq(manager.getLiquidity(key.toId()), liquidity);
        assertEq(gbx.balanceOf(lp), gbxHeld);
    }

    function test_seed_refusesAPoolSomeoneOpenedAtAnotherPrice() public {
        manager.initialize(key, TickMath.getSqrtPriceAtTick(gbxIsToken0 ? int24(-276_300) : int24(276_300)));

        vm.expectRevert("PoolSeed: pool opened at another price");
        this.seedAsLp();
    }

    function test_seed_poolTradesThroughTheHook() public {
        this.seedAsLp();

        assertEq(swapFee(router, trader, buyGbx(10e6), ""), hook.BASE_FEE());
        assertGt(gbx.balanceOf(trader), 1_000_000 ether);
    }
}
