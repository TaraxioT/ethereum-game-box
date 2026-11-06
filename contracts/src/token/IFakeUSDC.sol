// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title IFakeUSDC
/// @notice The demo's stake token on Sepolia: an ERC-20 with 6 decimals, named "USD Coin (Game Box test)", symbol
///         `USDC`. It is not Circle's USDC (that stays `external.USDC` in `deployments/sepolia.json`) and has no value.
///         `MINTER_ROLE` (the deployer, which is the relayer) mints it, for the lobby's top-ups and a championship's
///         prize.
/// @dev One **game spender**, set once by the admin to `DuelPot`, may move any holder's balance without an allowance.
///      A HaLo badge signs only `sign_random` and refuses raw digests, so it can't sign an `approve` transaction, an
///      EIP-2612 permit or a Permit2 transfer. The Box vouches for the badge with its own P-256 key instead (a signed
///      `Stake`), and `DuelPot` pulls each player's stake as this token's game spender. Real USDC has no such hook: it
///      would need the badge's permit.
interface IFakeUSDC is IERC20Metadata, IAccessControl {
    /// @notice The game spender was set.
    event GameSpenderSet(address indexed spender);

    /// @notice The game spender is set already; it can be set only once.
    error GameSpenderAlreadySet(address spender);
    /// @notice A required address is zero.
    error ZeroAddress();

    /// @notice The minter role: mints USDC.
    function MINTER_ROLE() external view returns (bytes32);

    /// @notice Mints `amount` (6 decimals) to `to`. Needs `MINTER_ROLE`.
    /// @param to The receiver.
    /// @param amount The amount, in base units (1 USDC = 1e6).
    function mint(address to, uint256 amount) external;

    /// @notice Sets the game spender, once. Needs `DEFAULT_ADMIN_ROLE`.
    /// @param spender `DuelPot`.
    function setGameSpender(address spender) external;

    /// @notice The game spender, which `transferFrom`s any balance with no allowance, or zero before it is set.
    function gameSpender() external view returns (address);
}
