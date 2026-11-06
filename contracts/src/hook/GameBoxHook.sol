// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {P256} from "../box/P256.sol";
import {IGameBoxNames} from "../names/IGameBoxNames.sol";
import {NameLib} from "../names/NameLib.sol";
import {IGameBoxHook} from "./IGameBoxHook.sol";
import {PriceOracle} from "./PriceOracle.sol";

/// @title GameBoxHook
/// @notice See `IGameBoxHook`. Deployed at an address whose low bits are `afterInitialize` and `beforeSwap`, which is
///         how the pool manager knows which calls to make.
contract GameBoxHook is IGameBoxHook, AccessControl, EIP712 {
    using PoolIdLibrary for PoolKey;
    using PriceOracle for PriceOracle.State;
    using StateLibrary for IPoolManager;

    bytes32 public constant FEE_EXEMPT_ROLE = keccak256("FEE_EXEMPT_ROLE");
    uint24 public constant BASE_FEE = 10_000;
    uint24 public constant TAP_FEE = 2_500;
    int24 public constant TICK_SPACING = 60;
    bytes32 public constant TAP_SWAP_TYPEHASH = keccak256(
        "TapSwap(string box,address badge,address sender,bool zeroForOne,int256 amountSpecified,uint256 nonce,uint256 deadline)"
    );

    IPoolManager public immutable POOL_MANAGER;
    IERC20 public immutable GBX;
    IERC20 public immutable USDC;
    IGameBoxNames public immutable NAMES;

    bytes32 public poolId;
    PriceOracle.State private _oracle;
    mapping(uint256 boxId => mapping(uint256 nonce => bool)) private _used;

    modifier onlyPoolManager() {
        if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager();
        _;
    }

    /// @param poolManager The v4 pool manager.
    /// @param gbx The game token.
    /// @param usdc The dollar token.
    /// @param names The registry the Boxes are read from.
    /// @param admin Who may grant `FEE_EXEMPT_ROLE`.
    constructor(IPoolManager poolManager, IERC20 gbx, IERC20 usdc, IGameBoxNames names, address admin)
        EIP712("Game Box Swap", "1")
    {
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: true,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
        POOL_MANAGER = poolManager;
        GBX = gbx;
        USDC = usdc;
        NAMES = names;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IHooks
    function afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        external
        onlyPoolManager
        returns (bytes4)
    {
        if (poolId != 0 || PoolId.unwrap(key.toId()) != PoolId.unwrap(poolKey().toId())) revert WrongPool();
        poolId = PoolId.unwrap(key.toId());
        _oracle.initialize(uint32(block.timestamp));
        emit PoolInitialized(poolId, sqrtPriceX96, tick);
        return IHooks.afterInitialize.selector;
    }

    /// @inheritdoc IHooks
    function beforeSwap(
        address sender,
        PoolKey calldata,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        // Only our pool can call: initializing any other pool on this hook reverted.
        (, int24 tick,,) = POOL_MANAGER.getSlot0(PoolId.wrap(poolId));
        _oracle.write(uint32(block.timestamp), tick);

        uint24 fee;
        if (hasRole(FEE_EXEMPT_ROLE, sender)) fee = 0;
        else if (hookData.length != 0) fee = _tapFee(sender, params, abi.decode(hookData, (TapSwapData)));
        else fee = BASE_FEE;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @inheritdoc IGameBoxHook
    function tapSwapDigest(TapSwap calldata swap) external view returns (bytes32) {
        return _digest(swap);
    }

    /// @inheritdoc IGameBoxHook
    function nonceUsed(string calldata box, uint256 nonce) external view returns (bool) {
        return _used[NameLib.id(box)][nonce];
    }

    /// @inheritdoc IGameBoxHook
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives) {
        int24 tick = _tick();
        tickCumulatives = new int56[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; ++i) {
            tickCumulatives[i] = _oracle.observe(uint32(block.timestamp), secondsAgos[i], tick);
        }
    }

    /// @inheritdoc IGameBoxHook
    function meanTick(uint32 window) external view returns (int24) {
        return _oracle.meanTick(uint32(block.timestamp), window, _tick());
    }

    /// @inheritdoc IGameBoxHook
    function poolKey() public view returns (PoolKey memory) {
        (address token0, address token1) =
            address(GBX) < address(USDC) ? (address(GBX), address(USDC)) : (address(USDC), address(GBX));
        return PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    /// @notice Checks a Box's approval of this swap and uses its nonce.
    function _tapFee(address sender, IPoolManager.SwapParams calldata params, TapSwapData memory data)
        private
        returns (uint24)
    {
        if (block.timestamp > data.deadline) revert DeadlineExpired(data.deadline);
        IGameBoxNames.Box memory box = NAMES.getBox(data.box);
        if (box.status == IGameBoxNames.BoxStatus.None) revert UnknownBox(data.box);
        if (block.timestamp >= box.expiry) revert BoxExpired(data.box);
        if (box.status != IGameBoxNames.BoxStatus.Active) revert BoxNotActive(data.box);
        uint256 boxId = NameLib.id(data.box);
        if (_used[boxId][data.nonce]) revert NonceUsed(data.box, data.nonce);

        bytes32 digest = _digest(
            TapSwap({
                box: data.box,
                badge: data.badge,
                sender: sender,
                zeroForOne: params.zeroForOne,
                amountSpecified: params.amountSpecified,
                nonce: data.nonce,
                deadline: data.deadline
            })
        );
        if (!P256.verify(digest, data.r, data.s, box.qx, box.qy)) revert InvalidSignature();

        _used[boxId][data.nonce] = true;
        emit TapSwapped(data.box, data.badge, sender, data.nonce);
        return TAP_FEE;
    }

    function _digest(TapSwap memory swap) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TAP_SWAP_TYPEHASH,
                    keccak256(bytes(swap.box)),
                    swap.badge,
                    swap.sender,
                    swap.zeroForOne,
                    swap.amountSpecified,
                    swap.nonce,
                    swap.deadline
                )
            )
        );
    }

    /// @notice The pool's tick now.
    function _tick() private view returns (int24 tick) {
        if (poolId == 0) revert NoPool();
        (, tick,,) = POOL_MANAGER.getSlot0(PoolId.wrap(poolId));
    }

    // The pool manager makes only the two calls above; the rest are never called.

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
