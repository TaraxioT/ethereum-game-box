// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";

/// @notice Writes `deployments/sepolia.json`, the one place addresses live.
abstract contract Deployments is Script {
    string internal constant PATH = "../deployments/sepolia.json";

    function _save(string memory name, address addr) internal {
        require(block.chainid == 11155111, "Deployments: not Sepolia");
        vm.writeJson(string.concat('"', vm.toString(addr), '"'), PATH, string.concat(".contracts.", name));
    }
}
