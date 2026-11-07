// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";

import {IFakeUSDC} from "../token/IFakeUSDC.sol";
import {IBoxStaking} from "../staking/IBoxStaking.sol";
import {IGameBoxHook} from "./IGameBoxHook.sol";

/// @title IGameBoxLobby
/// @notice The Box's lobby buy: a player taps their badge, and test USDC buys GBX on the GBX/USDC pool at the hook's
///         tap fee (0.25%). The GBX is staked to the Box for the badge when the Box is bonded, or sent to the badge.
/// @dev A HaLo badge can't sign an `approve` or a permit, and `FakeUSDC`'s one allowance-free spender is `DuelPot`,
///      so nothing can pull a badge's USDC into a swap. A buy is the lobby's top-up paid in GBX instead: the lobby
///      holds `MINTER_ROLE` on `FakeUSDC` and mints exactly what the swap owes straight to the pool manager. The swap
///      itself is a real v4 swap through `GameBoxHook`, and the Box's P-256 `TapSwap` (with this lobby as its
///      `sender`) is what earns the tap fee; without it the hook charges 1%, and a bad one reverts.
///      `MAX_BUY` caps one buy and `DAILY_CAP` each Box's buys per UTC day, so a Box key can't mint without end.
interface IGameBoxLobby is IUnlockCallback {
    /// @notice What the Box asks for. The Box signs `GameBoxHook`'s `TapSwap` over it: `box`, `badge`, this lobby as
    ///         `sender`, the USDC-for-GBX direction, `-usdcIn` (exact in), `nonce` and `deadline`.
    /// @param box The Box's label.
    /// @param badge The badge that tapped, which gets the GBX or the stake.
    /// @param usdcIn The USDC to spend (6 decimals), at most `MAX_BUY`.
    /// @param minGbxOut The least GBX the buy may get; not signed, so the sender picks its own slippage.
    /// @param nonce The `TapSwap`'s nonce.
    /// @param deadline The `TapSwap`'s deadline.
    struct Buy {
        string box;
        address badge;
        uint256 usdcIn;
        uint256 minGbxOut;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice `badge` bought `gbxOut` GBX with `usdcIn` USDC at `box`; `staked` if it went to the Box's stake.
    event Bought(string box, address indexed badge, uint256 usdcIn, uint256 gbxOut, bool staked);

    /// @notice Only the pool manager may call back.
    error NotPoolManager();
    /// @notice A buy of zero, or of more than `MAX_BUY`.
    error BadAmount(uint256 usdcIn);
    /// @notice The Box's buys today would pass `DAILY_CAP`.
    error DailyCapReached(string box, uint256 boughtToday);
    /// @notice The swap gave less GBX than `minGbxOut`.
    error TooLittleOut(uint256 gbxOut, uint256 minGbxOut);
    /// @notice A required address is zero.
    error ZeroAddress();

    /// @notice Buys GBX for `order.badge` with freshly minted USDC, at the tap fee, and stakes it to the Box if the
    ///         Box is bonded. Anyone may send it: the Box's signature decides.
    /// @param order The buy.
    /// @param r The Box's P-256 signature of the `TapSwap`, `r`.
    /// @param s The Box's P-256 signature of the `TapSwap`, `s` (low).
    /// @return gbxOut The GBX bought.
    /// @return staked Whether it was staked to the Box.
    function buy(Buy calldata order, bytes32 r, bytes32 s) external returns (uint256 gbxOut, bool staked);

    /// @notice The `TapSwap` the Box signs for `order`.
    function tapSwapOf(Buy calldata order) external view returns (IGameBoxHook.TapSwap memory);

    /// @notice The USDC `box` has spent on buys in the UTC day `day` (`timestamp / 1 days`).
    function boughtOn(string calldata box, uint256 day) external view returns (uint256);

    /// @notice The most one buy spends: 100 USDC, a top-up.
    function MAX_BUY() external view returns (uint256);
    /// @notice The most a Box's buys spend in a UTC day: 1,000 USDC.
    function DAILY_CAP() external view returns (uint256);

    function POOL_MANAGER() external view returns (IPoolManager);
    function HOOK() external view returns (IGameBoxHook);
    function USDC() external view returns (IFakeUSDC);
    function GBX() external view returns (IERC20);
    function STAKING() external view returns (IBoxStaking);
}
