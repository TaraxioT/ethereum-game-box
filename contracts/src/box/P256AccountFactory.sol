// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {IP256AccountFactory} from "./IP256AccountFactory.sol";
import {P256Account} from "./P256Account.sol";

/// @title P256AccountFactory
/// @notice Deploys `P256Account`s at CREATE2 addresses salted by their key (see `IP256AccountFactory`).
contract P256AccountFactory is IP256AccountFactory {
    /// @inheritdoc IP256AccountFactory
    function accountOf(bytes32 qx, bytes32 qy) public view returns (address) {
        return Create2.computeAddress(_salt(qx, qy), keccak256(_initCode(qx, qy)));
    }

    /// @inheritdoc IP256AccountFactory
    function deploy(bytes32 qx, bytes32 qy) external returns (address account) {
        account = accountOf(qx, qy);
        if (account.code.length != 0) return account;
        Create2.deploy(0, _salt(qx, qy), _initCode(qx, qy));
        emit AccountDeployed(account, qx, qy);
    }

    function _salt(bytes32 qx, bytes32 qy) private pure returns (bytes32) {
        return keccak256(abi.encode(qx, qy));
    }

    function _initCode(bytes32 qx, bytes32 qy) private pure returns (bytes memory) {
        return abi.encodePacked(type(P256Account).creationCode, abi.encode(qx, qy));
    }
}
