// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {P256AccountFactory} from "../../src/box/P256AccountFactory.sol";
import {BoxResults} from "../../src/names/BoxResults.sol";
import {DemoLicences} from "../../src/names/DemoLicences.sol";
import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IRegistry, IVerifiableFactory} from "../../src/names/IENSv2.sol";
import {PlayerStats} from "../../src/names/PlayerStats.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Deploys `P256AccountFactory`, `GameBoxNames` (which creates `gamebox.eth`'s registry and the shared title
///         and game resolvers), `PlayerStats`, `BoxResults` and `DemoLicences`; grants `LICENSOR_ROLE` to the deployer
///         and `DemoLicences` and `REFEREE_ROLE` to `BoxResults`, and sets the stats writer. Then deploys the demo
///         Box's `P256Account` through the factory, from `DEMO_BOX_QX` and `DEMO_BOX_QY`. Skips whatever is already
///         deployed or granted.
contract DeployNames is NamesScript {
    function run() external {
        (bytes32 qx, bytes32 qy) = _boxPublicKey();
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        P256AccountFactory factory = P256AccountFactory(_deployed("P256AccountFactory"));
        if (address(factory) == address(0)) factory = new P256AccountFactory();
        GameBoxNames names = GameBoxNames(_deployed("GameBoxNames"));
        if (address(names) == address(0)) {
            names = new GameBoxNames(
                IVerifiableFactory(_ens("VerifiableFactory")),
                _ens("UserRegistryImpl"),
                _ens("PermissionedResolverImpl"),
                IRegistry(_ens("ETHRegistry")),
                deployer
            );
        }
        PlayerStats stats = PlayerStats(_deployed("PlayerStats"));
        if (address(stats) == address(0)) stats = new PlayerStats(names);
        BoxResults results = BoxResults(_deployed("BoxResults"));
        if (address(results) == address(0)) results = new BoxResults(names, stats);
        DemoLicences licences = DemoLicences(_deployed("DemoLicences"));
        if (address(licences) == address(0)) licences = new DemoLicences(names);

        if (!names.hasRole(names.LICENSOR_ROLE(), deployer)) names.grantRole(names.LICENSOR_ROLE(), deployer);
        if (!names.hasRole(names.LICENSOR_ROLE(), address(licences))) {
            names.grantRole(names.LICENSOR_ROLE(), address(licences));
        }
        if (!names.hasRole(names.REFEREE_ROLE(), address(results))) {
            names.grantRole(names.REFEREE_ROLE(), address(results));
        }
        if (names.statsWriter() != address(stats)) names.setStatsWriter(address(stats));

        address box = factory.accountOf(qx, qy);
        if (box.code.length == 0) factory.deploy{gas: CREATE_GAS}(qx, qy);
        vm.stopBroadcast();

        _save("P256AccountFactory", address(factory));
        _save("GameBoxNames", address(names));
        _save("PlayerStats", address(stats));
        _save("BoxResults", address(results));
        _save("DemoLicences", address(licences));
        _saveCreatedBy("DemoBoxAccount", box, "P256AccountFactory");
        _saveAddress(".names.registry", address(names.REGISTRY()));
        _saveAddress(".names.titleResolver", names.TITLE_RESOLVER());
        _saveAddress(".names.gameResolver", names.GAME_RESOLVER());
    }
}
