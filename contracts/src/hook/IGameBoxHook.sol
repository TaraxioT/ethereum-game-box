// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {IGameBoxNames} from "../names/IGameBoxNames.sol";

/// @title IGameBoxHook
/// @notice The Uniswap v4 hook of the one GBX/USDC pool. It sets each swap's fee and keeps the pool's time-weighted
///         price.
/// @dev Fees, in hundredths of a basis point as v4 counts them:
///      - `BASE_FEE` (1%): any swap.
///      - `TAP_FEE` (0.25%): a swap a Box approved with its P-256 key after a player tapped their badge. The hook data
///        carries a `TapSwap` the Box signed, binding the badge, the router, the direction and the amount, used once.
///      - zero: a swap whose router (the `sender` the pool manager reports) holds `FEE_EXEMPT_ROLE`, such as the game
///        contracts that buy GBX with the USDC they hold.
///      The pool must be GBX/USDC with a dynamic fee, `TICK_SPACING` and this hook; initializing any other pool on
///      this hook reverts. The hook adds no liquidity rules: anyone may add or remove liquidity.
interface IGameBoxHook is IHooks, IAccessControl {
    /// @notice A Box-approved swap paid `TAP_FEE`.
    event TapSwapped(string box, address indexed badge, address indexed sender, uint256 nonce);
    /// @notice The pool was initialized.
    event PoolInitialized(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick);

    /// @notice Only the pool manager may call the hook.
    error NotPoolManager();
    /// @notice The pool isn't GBX/USDC with a dynamic fee, `TICK_SPACING` and this hook, or the pool is already set.
    error WrongPool();
    /// @notice The hook doesn't take this call.
    error HookNotImplemented();
    /// @notice The tap swap's deadline has passed.
    error DeadlineExpired(uint256 deadline);
    /// @notice No Box has this label.
    error UnknownBox(string box);
    /// @notice The Box's licence has lapsed.
    error BoxExpired(string box);
    /// @notice The Box isn't `Active`.
    error BoxNotActive(string box);
    /// @notice The Box already used this nonce.
    error NonceUsed(string box, uint256 nonce);
    /// @notice The signature isn't the Box's P-256 key over the swap.
    error InvalidSignature();
    /// @notice The pool hasn't been initialized, so it has no price yet.
    error NoPool();

    /// @notice What a Box signs to approve one swap at `TAP_FEE`.
    /// @param box The Box's label, e.g. `mumbai-01`.
    /// @param badge The player's badge that tapped.
    /// @param sender The router that will call the pool manager.
    /// @param zeroForOne The swap's direction, as in the pool manager's `SwapParams`.
    /// @param amountSpecified The swap's amount, as in `SwapParams`: negative for exact in, positive for exact out.
    /// @param nonce Any number the Box hasn't used.
    /// @param deadline The last second the swap may happen.
    struct TapSwap {
        string box;
        address badge;
        address sender;
        bool zeroForOne;
        int256 amountSpecified;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice The hook data of a tap swap, ABI-encoded: the `TapSwap` fields the swap doesn't already carry, and the
    ///         Box's signature.
    struct TapSwapData {
        string box;
        address badge;
        uint256 nonce;
        uint256 deadline;
        bytes32 r;
        bytes32 s;
    }

    /// @notice The EIP-712 digest the Box signs for `swap`.
    function tapSwapDigest(TapSwap calldata swap) external view returns (bytes32);

    /// @notice Whether `box` has used `nonce`.
    function nonceUsed(string calldata box, uint256 nonce) external view returns (bool);

    /// @notice The pool's running sum of `tick × seconds`, `secondsAgo[i]` seconds ago for each `i`.
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives);

    /// @notice The pool's average tick over the last `window` seconds, rounded down.
    function meanTick(uint32 window) external view returns (int24);

    /// @notice The pool's key.
    function poolKey() external view returns (PoolKey memory);

    /// @notice The pool's id, zero until it is initialized.
    function poolId() external view returns (bytes32);

    /// @notice The role whose holders, as swap routers, pay no fee.
    function FEE_EXEMPT_ROLE() external view returns (bytes32);
    /// @notice The fee of a plain swap: 1%.
    function BASE_FEE() external view returns (uint24);
    /// @notice The fee of a tap swap: 0.25%.
    function TAP_FEE() external view returns (uint24);
    /// @notice The pool's tick spacing.
    function TICK_SPACING() external view returns (int24);
    /// @notice The `TapSwap` type hash.
    function TAP_SWAP_TYPEHASH() external view returns (bytes32);
    /// @notice The pool manager.
    function POOL_MANAGER() external view returns (IPoolManager);
    /// @notice The game token.
    function GBX() external view returns (IERC20);
    /// @notice The dollar token.
    function USDC() external view returns (IERC20);
    /// @notice The registry the Boxes are read from.
    function NAMES() external view returns (IGameBoxNames);
}
