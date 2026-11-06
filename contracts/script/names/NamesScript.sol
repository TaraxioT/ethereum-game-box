// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BoxAccount} from "../../src/box/BoxAccount.sol";
import {P256} from "../../src/box/P256.sol";
import {BoxResults} from "../../src/names/BoxResults.sol";
import {DemoLicences} from "../../src/names/DemoLicences.sol";
import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {PlayerStats} from "../../src/names/PlayerStats.sol";
import {Deployments} from "../Deployments.sol";

/// @notice What every names deploy script shares: the ENS addresses from `deployments/sepolia.json`, our deployed
///         contracts, and the demo keys from `.env` (read, never printed).
/// @dev Run each script from `contracts/` with the repo `.env` loaded:
///      `forge script script/names/<Script>.s.sol --rpc-url sepolia --account sepolia-deployer --password '' \
///        --broadcast --slow --priority-gas-price 1gwei -g 150`, then once more without `--broadcast` to record each
///      deploy's block and transaction.
abstract contract NamesScript is Deployments {
    /// @notice The P-256 group order.
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    function _ens(string memory name) internal view returns (address) {
        return vm.parseJsonAddress(vm.readFile(PATH), string.concat(".ens.", name, ".address"));
    }

    function _names() internal view returns (GameBoxNames names) {
        names = GameBoxNames(_deployed("GameBoxNames"));
        require(address(names) != address(0), "GameBoxNames is not deployed: run DeployNames first");
    }

    function _results() internal view returns (BoxResults) {
        return BoxResults(_deployed("BoxResults"));
    }

    function _stats() internal view returns (PlayerStats) {
        return PlayerStats(_deployed("PlayerStats"));
    }

    function _licences() internal view returns (DemoLicences) {
        return DemoLicences(_deployed("DemoLicences"));
    }

    function _demoBox() internal view returns (BoxAccount box) {
        box = BoxAccount(payable(_deployed("DemoBoxAccount")));
        require(address(box) != address(0), "DemoBoxAccount is not deployed: run DeployNames first");
    }

    function _boxKey() internal view returns (uint256) {
        return vm.envUint("DEMO_BOX_P256_KEY");
    }

    function _operatorKey() internal view returns (uint256) {
        return vm.envUint("DEMO_OPERATOR_KEY");
    }

    function _agentKey() internal view returns (uint256) {
        return vm.envUint("AGENT_PRIVATE_KEY");
    }

    function _boxPublicKey() internal view returns (bytes32 qx, bytes32 qy) {
        (uint256 x, uint256 y) = vm.publicKeyP256(_boxKey());
        return (bytes32(x), bytes32(y));
    }

    /// @dev The demo Box's signature of `digest`: P-256 over the raw digest, with a low `s`.
    function _boxSign(bytes32 digest) internal view returns (bytes32 r, bytes32 s) {
        (r, s) = vm.signP256(_boxKey(), digest);
        if (uint256(s) > P256.HALF_N) s = bytes32(P256_N - uint256(s));
    }
}
