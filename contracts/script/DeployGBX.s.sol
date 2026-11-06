// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Deployments} from "./Deployments.sol";
import {GBX} from "../src/token/GBX.sol";

/// forge script script/DeployGBX.s.sol --rpc-url sepolia --account $DEPLOYER_ACCOUNT --broadcast
contract DeployGBX is Deployments {
    function run() external {
        vm.startBroadcast();
        GBX gbx = new GBX();
        vm.stopBroadcast();

        _save("GBX", address(gbx));
    }
}
