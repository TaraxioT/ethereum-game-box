// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

/// @notice Writes `deployments/sepolia.json`, the one place addresses live.
/// @dev Each of our contracts is `.contracts.<name>`: `{address, deployBlock, txHash, verified}`. The block and hash
///      come from forge's record of the broadcast that created the contract, which exists only once the broadcast is
///      done: run a deploy script again without `--broadcast` afterwards, and it fills them in (every deploy script
///      skips what is already deployed). `verified` is set by `pnpm names:verify`, and kept while the address stays.
abstract contract Deployments is Script {
    string internal constant PATH = "../deployments/sepolia.json";

    /// @notice Records `addr` as `.contracts.<name>`, for a contract whose type is also `name`.
    function _save(string memory name, address addr) internal {
        _save(name, addr, name);
    }

    /// @notice Records `addr` as `.contracts.<name>`, created by `new <contractName>`.
    function _save(string memory name, address addr, string memory contractName) internal virtual {
        _record(name, addr, contractName, VmSafe.BroadcastTxType.Create, addr);
    }

    /// @notice Records `addr` as `.contracts.<name>`, created by a call to our contract `.contracts.<factoryName>`
    ///         (its latest broadcast call gives the block and transaction).
    function _saveCreatedBy(string memory name, address addr, string memory factoryName) internal {
        _record(name, addr, factoryName, VmSafe.BroadcastTxType.Call, _deployed(factoryName));
    }

    /// @dev Writes the entry. The block and hash come from the latest broadcast of type `txType` to or by
    ///      `contractName` whose contract address is `txAddress`.
    function _record(
        string memory name,
        address addr,
        string memory contractName,
        VmSafe.BroadcastTxType txType,
        address txAddress
    ) private {
        require(block.chainid == 11155111, "Deployments: not Sepolia");
        string memory key = string.concat(".contracts.", name);
        string memory json = vm.readFile(PATH);
        bool same = _deployed(name) == addr;

        bytes32 txHash;
        uint256 deployBlock;
        bool verified;
        if (same && vm.keyExistsJson(json, string.concat(key, ".txHash"))) {
            txHash = vm.parseJsonBytes32(json, string.concat(key, ".txHash"));
            deployBlock = vm.parseJsonUint(json, string.concat(key, ".deployBlock"));
            verified = vm.parseJsonBool(json, string.concat(key, ".verified"));
        }
        if (txHash == 0) (txHash, deployBlock) = _broadcast(contractName, txType, txAddress);
        // A contract made by `new C{salt: ...}` (a v4 hook at a mined address) goes through the CREATE2 factory.
        if (txHash == 0 && txType == VmSafe.BroadcastTxType.Create) {
            (txHash, deployBlock) = _broadcast(contractName, VmSafe.BroadcastTxType.Create2, txAddress);
        }

        string memory entry = string.concat("deployment-", name);
        vm.serializeAddress(entry, "address", addr);
        vm.serializeUint(entry, "deployBlock", deployBlock);
        vm.serializeBytes32(entry, "txHash", txHash);
        vm.writeJson(vm.serializeBool(entry, "verified", verified), PATH, key);
    }

    /// @dev The hash and block of the latest broadcast of type `txType` to or by `contractName`, if its contract address
    ///      is `txAddress`; zero otherwise.
    function _broadcast(string memory contractName, VmSafe.BroadcastTxType txType, address txAddress)
        private
        view
        returns (bytes32 txHash, uint256 deployBlock)
    {
        try vm.getBroadcast(contractName, uint64(block.chainid), txType) returns (VmSafe.BroadcastTxSummary memory b) {
            if (b.contractAddress == txAddress) (txHash, deployBlock) = (b.txHash, b.blockNumber);
        } catch {}
    }

    /// @notice The recorded address of `.contracts.<name>`, or zero if it is missing or has no code.
    function _deployed(string memory name) internal view virtual returns (address addr) {
        string memory json = vm.readFile(PATH);
        string memory key = string.concat(".contracts.", name, ".address");
        if (!vm.keyExistsJson(json, key)) return address(0);
        addr = vm.parseJsonAddress(json, key);
        if (addr.code.length == 0) return address(0);
    }

    /// @notice Records an address we didn't deploy ourselves (a proxy one of our contracts created) at `key`.
    function _saveAddress(string memory key, address addr) internal {
        require(block.chainid == 11155111, "Deployments: not Sepolia");
        vm.writeJson(string.concat('"', vm.toString(addr), '"'), PATH, key);
    }
}
