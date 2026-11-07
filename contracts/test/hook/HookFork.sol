// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {Vm} from "forge-std/Vm.sol";

import {HookMiner} from "../../script/HookMiner.sol";
import {GbxPool} from "../../script/uniswap/GbxPool.sol";
import {GameBoxHook} from "../../src/hook/GameBoxHook.sol";
import {IGameBoxHook} from "../../src/hook/IGameBoxHook.sol";
import {GBX} from "../../src/token/GBX.sol";
import {NamesFork} from "../names/NamesFork.sol";

/// @notice The GBX/USDC pool on a Sepolia fork: the real v4 pool manager and its test routers, the fork's `FakeUSDC`, a
///         fresh GBX, and `GameBoxHook` mined to an address with its flags. The pool starts at 0.10 USDC per GBX with
///         full-range liquidity.
abstract contract HookFork is NamesFork {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    string internal constant BOX = "egbt-swap";
    int24 internal constant GBX_PRICE_TICK = GbxPool.PRICE_TICK;
    int24 internal constant MAX_RANGE_TICK = GbxPool.FULL_RANGE_TICK;
    bytes32 internal constant SWAP_EVENT =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");

    IPoolManager internal manager;
    PoolSwapTest internal router;
    PoolModifyLiquidityTest internal lpRouter;
    GBX internal gbx;
    IERC20 internal usdc;
    GameBoxHook internal hook;
    PoolKey internal key;
    bool internal gbxIsToken0;

    address internal lp = account("lp");
    address internal trader = account("trader");
    address internal badge = account("badge-swap");

    function setUp() public virtual override {
        super.setUp();
        string memory json = vm.readFile("../deployments/sepolia.json");
        usdc = fakeUsdc;
        manager = IPoolManager(vm.parseJsonAddress(json, ".external.PoolManager"));
        router = PoolSwapTest(vm.parseJsonAddress(json, ".external.PoolSwapTest"));
        lpRouter = PoolModifyLiquidityTest(vm.parseJsonAddress(json, ".external.PoolModifyLiquidityTest"));

        vm.prank(admin);
        gbx = new GBX();
        hook = deployHook();
        key = hook.poolKey();
        gbxIsToken0 = Currency.unwrap(key.currency0) == address(gbx);

        vm.startPrank(admin);
        gbx.transfer(lp, 10_000_000 ether);
        gbx.transfer(trader, 1_000_000 ether);
        vm.stopPrank();
        deal(address(usdc), lp, 10_000_000e6);
        deal(address(usdc), trader, 1_000_000e6);
        approveRouters(lp);
        approveRouters(trader);

        registerBox(BOX, 30 days);
        openPool();
    }

    /// @notice Opens the pool at 0.10 USDC per GBX with full-range liquidity.
    function openPool() internal virtual {
        manager.initialize(key, GbxPool.sqrtPriceX96(gbxIsToken0));
        addLiquidity(1e17);
    }

    function deployHook() internal returns (GameBoxHook) {
        uint160 flags = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG;
        bytes memory args = abi.encode(manager, gbx, usdc, names, admin);
        (address mined, bytes32 salt) =
            HookMiner.find(address(this), flags, abi.encodePacked(type(GameBoxHook).creationCode, args));
        GameBoxHook deployed = new GameBoxHook{salt: salt}(manager, gbx, usdc, names, admin);
        assertEq(address(deployed), mined);
        return deployed;
    }

    function approveRouters(address who) internal {
        vm.startPrank(who);
        gbx.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        gbx.approve(address(lpRouter), type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        vm.stopPrank();
    }

    function addLiquidity(int256 liquidity) internal {
        vm.prank(lp);
        lpRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -MAX_RANGE_TICK,
                tickUpper: MAX_RANGE_TICK,
                liquidityDelta: liquidity,
                salt: 0
            }),
            ""
        );
    }

    /// @notice The swap params of selling `usdcIn` USDC for GBX, exact in.
    function buyGbx(uint256 usdcIn) internal view returns (IPoolManager.SwapParams memory) {
        bool zeroForOne = !gbxIsToken0;
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(usdcIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    /// @notice The swap params of selling `gbxIn` GBX for USDC, exact in.
    function sellGbx(uint256 gbxIn) internal view returns (IPoolManager.SwapParams memory) {
        bool zeroForOne = gbxIsToken0;
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(gbxIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    /// @notice Swaps through `via` as `who`.
    function swap(PoolSwapTest via, address who, IPoolManager.SwapParams memory params, bytes memory hookData)
        internal
    {
        vm.prank(who);
        via.swap(key, params, PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), hookData);
    }

    /// @notice Swaps through `via` as `who` and returns the fee the pool manager charged.
    function swapFee(PoolSwapTest via, address who, IPoolManager.SwapParams memory params, bytes memory hookData)
        internal
        returns (uint24)
    {
        vm.recordLogs();
        swap(via, who, params, hookData);
        return recordedSwapFee();
    }

    /// @notice The fee of the pool manager's `Swap` among the logs recorded since `vm.recordLogs()`.
    function recordedSwapFee() internal returns (uint24) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == SWAP_EVENT) {
                (,,,,, uint24 fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return fee;
            }
        }
        revert("no Swap event");
    }

    /// @notice A Box approval of `params` through `via`, signed by `signer`, as hook data.
    function tapData(
        PoolSwapTest via,
        IPoolManager.SwapParams memory params,
        uint256 nonce,
        uint256 deadline,
        uint256 signer
    ) internal view returns (bytes memory) {
        bytes32 digest = hook.tapSwapDigest(
            IGameBoxHook.TapSwap({
                box: BOX,
                badge: badge,
                sender: address(via),
                zeroForOne: params.zeroForOne,
                amountSpecified: params.amountSpecified,
                nonce: nonce,
                deadline: deadline
            })
        );
        (bytes32 r, bytes32 s) = p256Sign(signer, digest);
        return abi.encode(
            IGameBoxHook.TapSwapData({box: BOX, badge: badge, nonce: nonce, deadline: deadline, r: r, s: s})
        );
    }

    /// @notice Expects the next swap to revert inside the hook with `reason`, as the pool manager wraps it.
    function expectHookRevert(bytes memory reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeSwap.selector,
                reason,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    /// @notice The pool's tick now.
    function poolTick() internal view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(key.toId());
    }
}
