// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {P256AccountFactory} from "../../src/box/P256AccountFactory.sol";
import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {Deployments} from "../Deployments.sol";

/// @notice What every names deploy script shares: the ENS addresses from `deployments/sepolia.json`, our deployed
///         contracts, and the demo Box's public key from the environment. No script reads a private key: the
///         deployer signs through its cast keystore, and every other account signs with P-256 off chain.
/// @dev Run each script from `contracts/` with the repo `.env` loaded (see `contracts/README.md`).
abstract contract NamesScript is Deployments {
    function _ens(string memory name) internal view returns (address) {
        return vm.parseJsonAddress(vm.readFile(PATH), string.concat(".ens.", name, ".address"));
    }

    function _names() internal view returns (GameBoxNames names) {
        names = GameBoxNames(_deployed("GameBoxNames"));
        require(address(names) != address(0), "GameBoxNames is not deployed: run DeployNames first");
    }

    function _factory() internal view returns (P256AccountFactory factory) {
        factory = P256AccountFactory(_deployed("P256AccountFactory"));
        require(address(factory) != address(0), "P256AccountFactory is not deployed: run DeployNames first");
    }

    /// @dev The demo Box's P-256 public key, `DEMO_BOX_QX` and `DEMO_BOX_QY` (0x-prefixed 32-byte hex each).
    function _boxPublicKey() internal view returns (bytes32 qx, bytes32 qy) {
        return (vm.envBytes32("DEMO_BOX_QX"), vm.envBytes32("DEMO_BOX_QY"));
    }
}
