// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StorePot} from "../../src/game/StorePot.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {FakeUSDC} from "../../src/token/FakeUSDC.sol";
import {Deployments} from "../Deployments.sol";

/// @notice Deploys `FakeUSDC` a second time as `StoreUSDC`, then `StorePot`, and makes the pot its game spender: the
///         first `FakeUSDC`'s spender is set for good to `DuelPot`. The deployer, which is the relayer, is the token's
///         admin and minter, and the pot's lister. `STORE_VERIFIER` gets `VERIFIER_ROLE`, and `STORE_ADMIN` takes the
///         pot's admin role from the deployer. Both are addresses, never keys.
/// @dev The admin can make any key a verifier, so it mustn't be the relayer's internet-facing key, or the verifier key
///      it has to be able to replace. The deployer gives its admin role up for good, so check `STORE_ADMIN` first.
///
///      Skips whatever is already deployed and wired, and finishes a hand-over that stopped halfway. Once the hand-over
///      is done, a new `STORE_VERIFIER` or `STORE_ADMIN` reverts: only the admin rotates a key. A new `GameBoxNames`
///      brings a new pot, which needs a new token too (delete `StoreUSDC`'s entry first), since a token's spender is set
///      once.
contract DeployStorePot is Deployments {
    function run() external {
        deploy(vm.envAddress("STORE_VERIFIER"), vm.envAddress("STORE_ADMIN"));
    }

    /// @param verifier Gets `VERIFIER_ROLE`.
    /// @param admin Takes the pot's `DEFAULT_ADMIN_ROLE` from the deployer.
    function deploy(address verifier, address admin) public {
        IGameBoxNames names = IGameBoxNames(_deployed("GameBoxNames"));
        require(address(names) != address(0), "DeployStorePot: GameBoxNames first");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        require(
            admin != address(0) && admin != deployer && admin != verifier,
            "DeployStorePot: STORE_ADMIN must be its own account"
        );
        FakeUSDC usdc = FakeUSDC(_deployed("StoreUSDC"));
        if (address(usdc) == address(0)) usdc = new FakeUSDC(deployer, deployer);
        StorePot pot = StorePot(_deployed("StorePot"));
        if (address(pot) == address(0) || pot.NAMES() != names || pot.USDC() != usdc) {
            pot = new StorePot(names, usdc, deployer);
        }
        if (usdc.gameSpender() == address(0)) usdc.setGameSpender(address(pot));
        _grant(pot, pot.LISTER_ROLE(), deployer);
        _grant(pot, pot.VERIFIER_ROLE(), verifier);
        _handOver(pot, admin, deployer);
        vm.stopBroadcast();

        require(usdc.gameSpender() == address(pot), "StoreUSDC has another game spender");
        _save("StoreUSDC", address(usdc), "FakeUSDC");
        _save("StorePot", address(pot));
    }

    function _grant(StorePot pot, bytes32 role, address account) internal {
        if (!pot.hasRole(role, account)) pot.grantRole(role, account);
    }

    /// @dev The new admin comes first, so the pot is never without one.
    function _handOver(StorePot pot, address admin, address deployer) internal {
        bytes32 role = pot.DEFAULT_ADMIN_ROLE();
        _grant(pot, role, admin);
        if (pot.hasRole(role, deployer)) pot.renounceRole(role, deployer);
    }
}
