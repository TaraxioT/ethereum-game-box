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
    function _save(string memory name, address addr, string memory contractName) internal {
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
        if (txHash == 0) {
            try vm.getBroadcast(contractName, uint64(block.chainid), VmSafe.BroadcastTxType.Create) returns (
                VmSafe.BroadcastTxSummary memory b
            ) {
                if (b.contractAddress == addr) (txHash, deployBlock) = (b.txHash, b.blockNumber);
            } catch {}
        }

        string memory entry = string.concat("deployment-", name);
        vm.serializeAddress(entry, "address", addr);
        vm.serializeUint(entry, "deployBlock", deployBlock);
        vm.serializeBytes32(entry, "txHash", txHash);
        vm.writeJson(vm.serializeBool(entry, "verified", verified), PATH, key);
    }

    /// @notice The recorded address of `.contracts.<name>`, or zero if it is missing or has no code.
    function _deployed(string memory name) internal view returns (address addr) {
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
