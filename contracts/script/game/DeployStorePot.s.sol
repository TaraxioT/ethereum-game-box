// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StorePot} from "../../src/game/StorePot.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {FakeUSDC} from "../../src/token/FakeUSDC.sol";
import {Deployments} from "../Deployments.sol";

/// @notice Deploys `FakeUSDC` a second time as `StoreUSDC`, then `StorePot`, and makes the pot its game spender: the
///         first `FakeUSDC`'s spender is set for good to `DuelPot`. The deployer, which is the relayer, is the token's
///         admin and minter, and the pot's admin and lister. `STORE_VERIFIER` (an address, never a key) gets
///         `VERIFIER_ROLE`.
/// @dev Skips whatever is already deployed and wired. A new `GameBoxNames` brings a new pot, which needs a new token
///      too (delete `StoreUSDC`'s entry first), since a token's spender is set once. Another `STORE_VERIFIER` is added
///      beside the old one: the admin revokes the old key itself.
contract DeployStorePot is Deployments {
    function run() external {
        IGameBoxNames names = IGameBoxNames(_deployed("GameBoxNames"));
        require(address(names) != address(0), "DeployStorePot: GameBoxNames first");
        address verifier = vm.envAddress("STORE_VERIFIER");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        FakeUSDC usdc = FakeUSDC(_deployed("StoreUSDC"));
        if (address(usdc) == address(0)) usdc = new FakeUSDC(deployer, deployer);
        StorePot pot = StorePot(_deployed("StorePot"));
        if (address(pot) == address(0) || pot.NAMES() != names || pot.USDC() != usdc) {
            pot = new StorePot(names, usdc, deployer);
        }
        if (usdc.gameSpender() == address(0)) usdc.setGameSpender(address(pot));
        _grant(pot, pot.LISTER_ROLE(), deployer);
        _grant(pot, pot.VERIFIER_ROLE(), verifier);
        vm.stopBroadcast();

        require(usdc.gameSpender() == address(pot), "StoreUSDC has another game spender");
        _save("StoreUSDC", address(usdc), "FakeUSDC");
        _save("StorePot", address(pot));
    }

    function _grant(StorePot pot, bytes32 role, address account) internal {
        if (!pot.hasRole(role, account)) pot.grantRole(role, account);
    }
}
