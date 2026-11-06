// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {IFakeUSDC} from "./IFakeUSDC.sol";

/// @title FakeUSDC
/// @notice The demo's test USDC on Sepolia, minted by the relayer and staked through `DuelPot` (see `IFakeUSDC`).
contract FakeUSDC is IFakeUSDC, ERC20, AccessControl {
    /// @inheritdoc IFakeUSDC
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @inheritdoc IFakeUSDC
    address public gameSpender;

    /// @param admin Gets `DEFAULT_ADMIN_ROLE` (sets the game spender, grants minters).
    /// @param minter Gets `MINTER_ROLE`.
    constructor(address admin, address minter) ERC20("USD Coin (Game Box test)", "USDC") {
        if (admin == address(0) || minter == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
    }

    /// @notice 6, as USDC.
    function decimals() public pure override(ERC20, IERC20Metadata) returns (uint8) {
        return 6;
    }

    /// @inheritdoc IFakeUSDC
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @inheritdoc IFakeUSDC
    function setGameSpender(address spender) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (spender == address(0)) revert ZeroAddress();
        if (gameSpender != address(0)) revert GameSpenderAlreadySet(gameSpender);
        gameSpender = spender;
        emit GameSpenderSet(spender);
    }

    /// @dev The game spender needs no allowance: badges can't sign one (see `IFakeUSDC`).
    function _spendAllowance(address owner, address spender, uint256 value) internal override {
        if (spender != gameSpender) super._spendAllowance(owner, spender, value);
    }
}
