// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {GameBoxLobby} from "../src/hook/GameBoxLobby.sol";
import {IGameBoxHook} from "../src/hook/IGameBoxHook.sol";
import {IBoxStaking} from "../src/staking/IBoxStaking.sol";
import {IFakeUSDC} from "../src/token/IFakeUSDC.sol";
import {Deployments} from "./Deployments.sol";

/// @notice Deploys `GameBoxLobby` over the recorded `GameBoxHook` and `BoxStaking`, and makes it a `FakeUSDC` minter
///         (the deployer is `FakeUSDC`'s admin), so a tap can pay for its swap. Skips what is already done.
contract DeployLobby is Deployments {
    function run() external {
        address hook = _deployed("GameBoxHook");
        address staking = _deployed("BoxStaking");
        address usdc = _deployed("FakeUSDC");
        require(
            hook != address(0) && staking != address(0) && usdc != address(0),
            "DeployLobby: GameBoxHook, BoxStaking and FakeUSDC first"
        );

        vm.startBroadcast();
        GameBoxLobby lobby = GameBoxLobby(_deployed("GameBoxLobby"));
        if (address(lobby) == address(0)) lobby = new GameBoxLobby(IGameBoxHook(hook), IBoxStaking(staking));
        bytes32 minter = IFakeUSDC(usdc).MINTER_ROLE();
        if (!IAccessControl(usdc).hasRole(minter, address(lobby))) {
            IAccessControl(usdc).grantRole(minter, address(lobby));
        }
        vm.stopBroadcast();

        _save("GameBoxLobby", address(lobby));
    }
}
