// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

/// @notice Finds a CREATE2 salt that puts a hook at an address whose low 14 bits are exactly its permission flags,
///         which is how the v4 pool manager reads a hook's permissions.
library HookMiner {
    uint160 internal constant FLAG_MASK = Hooks.ALL_HOOK_MASK;
    uint256 internal constant MAX_TRIES = 200_000;

    error NoSalt();

    /// @param deployer The address that runs CREATE2: the CREATE2 factory in a script, the test contract in a test.
    /// @param flags The permission bits the address must have.
    /// @param initCode The creation code with its constructor arguments.
    /// @return hook The address.
    /// @return salt The salt.
    function find(address deployer, uint160 flags, bytes memory initCode)
        internal
        view
        returns (address hook, bytes32 salt)
    {
        bytes32 initCodeHash = keccak256(initCode);
        for (uint256 i; i < MAX_TRIES; ++i) {
            salt = bytes32(i);
            hook = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
            if (uint160(hook) & FLAG_MASK == flags && hook.code.length == 0) return (hook, salt);
        }
        revert NoSalt();
    }
}
