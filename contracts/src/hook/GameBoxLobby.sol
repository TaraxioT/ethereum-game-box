// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {NameLib} from "../names/NameLib.sol";
import {IBoxStaking} from "../staking/IBoxStaking.sol";
import {IFakeUSDC} from "../token/IFakeUSDC.sol";
import {IGameBoxHook} from "./IGameBoxHook.sol";
import {IGameBoxLobby} from "./IGameBoxLobby.sol";

/// @notice See `IGameBoxLobby`. It is its own v4 router: it unlocks the pool manager, swaps with the Box's approval as
///         hook data, pays the USDC it owes by minting it to the pool manager, and takes the GBX.
contract GameBoxLobby is IGameBoxLobby {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BUY = 100e6;
    uint256 public constant DAILY_CAP = 1_000e6;

    IPoolManager public immutable POOL_MANAGER;
    IGameBoxHook public immutable HOOK;
    IFakeUSDC public immutable USDC;
    IERC20 public immutable GBX;
    IBoxStaking public immutable STAKING;

    /// @dev USDC is the pool's `currency0`, so a buy (USDC in) is `zeroForOne`.
    bool private immutable _usdcIsToken0;

    mapping(uint256 boxId => mapping(uint256 day => uint256)) private _bought;

    /// @param hook The GBX/USDC pool's hook, which names the pool manager, GBX and USDC.
    /// @param staking Where a bonded Box's buys are staked.
    constructor(IGameBoxHook hook, IBoxStaking staking) {
        if (address(hook) == address(0) || address(staking) == address(0)) revert ZeroAddress();
        HOOK = hook;
        STAKING = staking;
        POOL_MANAGER = hook.POOL_MANAGER();
        USDC = IFakeUSDC(address(hook.USDC()));
        GBX = hook.GBX();
        _usdcIsToken0 = Currency.unwrap(hook.poolKey().currency0) == address(USDC);
        GBX.forceApprove(address(staking), type(uint256).max);
    }

    /// @inheritdoc IGameBoxLobby
    function buy(Buy calldata order, bytes32 r, bytes32 s) external returns (uint256 gbxOut, bool staked) {
        if (order.usdcIn == 0 || order.usdcIn > MAX_BUY) revert BadAmount(order.usdcIn);
        uint256 day = block.timestamp / 1 days;
        uint256 boxId = NameLib.id(order.box);
        uint256 today = _bought[boxId][day] + order.usdcIn;
        if (today > DAILY_CAP) revert DailyCapReached(order.box, _bought[boxId][day]);
        _bought[boxId][day] = today;

        // The hook checks the Box, its signature, the nonce and the deadline, and reverts the swap if any is wrong.
        bytes memory hookData = abi.encode(
            IGameBoxHook.TapSwapData({
                box: order.box, badge: order.badge, nonce: order.nonce, deadline: order.deadline, r: r, s: s
            })
        );
        gbxOut = abi.decode(POOL_MANAGER.unlock(abi.encode(order.usdcIn, hookData)), (uint256));
        if (gbxOut < order.minGbxOut) revert TooLittleOut(gbxOut, order.minGbxOut);

        staked = STAKING.isBonded(order.box);
        if (staked) STAKING.stakeFor(order.box, order.badge, gbxOut);
        else GBX.safeTransfer(order.badge, gbxOut);
        emit Bought(order.box, order.badge, order.usdcIn, gbxOut, staked);
    }

    /// @notice The pool manager's callback inside `unlock`: the swap, then paying for it and taking its GBX.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager();
        (uint256 usdcIn, bytes memory hookData) = abi.decode(data, (uint256, bytes));
        PoolKey memory key = HOOK.poolKey();

        BalanceDelta delta = POOL_MANAGER.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: _usdcIsToken0,
                amountSpecified: -int256(usdcIn),
                sqrtPriceLimitX96: _usdcIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            hookData
        );
        (int128 usdcDelta, int128 gbxDelta) =
            _usdcIsToken0 ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());

        // Pay what the swap owes (all of `usdcIn`, unless the pool ran out of GBX first) by minting it in.
        POOL_MANAGER.sync(Currency.wrap(address(USDC)));
        USDC.mint(address(POOL_MANAGER), uint256(uint128(-usdcDelta)));
        POOL_MANAGER.settle();

        uint256 gbxOut = uint256(uint128(gbxDelta));
        POOL_MANAGER.take(Currency.wrap(address(GBX)), address(this), gbxOut);
        return abi.encode(gbxOut);
    }

    /// @inheritdoc IGameBoxLobby
    function tapSwapOf(Buy calldata order) external view returns (IGameBoxHook.TapSwap memory) {
        return IGameBoxHook.TapSwap({
            box: order.box,
            badge: order.badge,
            sender: address(this),
            zeroForOne: _usdcIsToken0,
            amountSpecified: -int256(order.usdcIn),
            nonce: order.nonce,
            deadline: order.deadline
        });
    }

    /// @inheritdoc IGameBoxLobby
    function boughtOn(string calldata box, uint256 day) external view returns (uint256) {
        return _bought[NameLib.id(box)][day];
    }
}
