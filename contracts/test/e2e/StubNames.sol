// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";

/// @title StubNames
/// @notice The slice of `GameBoxNames` a store match reads, for `pnpm store:e2e`, which runs on a bare anvil: the real
///         one needs ENS, so a fork of Sepolia. `StorePot` still goes through `BoxCheck`, so a Box's status, licence and
///         P-256 signature are checked on the same path, against what this holds.
contract StubNames {
    mapping(string label => IGameBoxNames.Box) private _boxes;
    mapping(address badge => string name) public nameOf;

    /// @notice Sets a Box's licence, whatever it held before.
    function setBox(string calldata label, IGameBoxNames.Box calldata box) external {
        _boxes[label] = box;
    }

    /// @notice Gives a badge a player name.
    function setName(address badge, string calldata name) external {
        nameOf[badge] = name;
    }

    /// @notice A Box's licence, as `IGameBoxNames.getBox`.
    function getBox(string calldata label) external view returns (IGameBoxNames.Box memory) {
        return _boxes[label];
    }

    /// @notice A Box's key, as `IGameBoxNames.boxKey`.
    function boxKey(string calldata label) external view returns (bytes32 qx, bytes32 qy) {
        return (_boxes[label].qx, _boxes[label].qy);
    }
}
