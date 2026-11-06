// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {P256AccountFactory} from "../../src/box/P256AccountFactory.sol";
import {DuelPot} from "../../src/game/DuelPot.sol";
import {BoxResults} from "../../src/names/BoxResults.sol";
import {BoxSeats} from "../../src/names/BoxSeats.sol";
import {Championships} from "../../src/names/Championships.sol";
import {DemoLicences} from "../../src/names/DemoLicences.sol";
import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IRegistry, IVerifiableFactory} from "../../src/names/IENSv2.sol";
import {PlayerStats} from "../../src/names/PlayerStats.sol";
import {FakeUSDC} from "../../src/token/FakeUSDC.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Deploys `P256AccountFactory`, `GameBoxNames` (which creates `gamebox.eth`'s registry and the shared title
///         and game resolvers), `PlayerStats`, `FakeUSDC`, `DuelPot`, `Championships`, `BoxResults`, `DemoLicences`
///         and `BoxSeats`. Grants `LICENSOR_ROLE` to the deployer and `DemoLicences`, `REFEREE_ROLE` to `BoxResults`
///         and `SEATER_ROLE` to `BoxSeats`, sets the stats writer and the championships contract, and makes `DuelPot`
///         USDC's game spender. The deployer is USDC's admin and minter and `Championships`' admin.
/// @dev Skips whatever is already deployed and wired to the contracts it depends on, so a new `GameBoxNames` (delete
///      its entry in `deployments/sepolia.json` first) brings new copies of everything bound to it, and the factory
///      and USDC stay.
contract DeployNames is NamesScript {
    function run() external {
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
        if (address(stats) == address(0) || stats.NAMES() != names) stats = new PlayerStats(names);
        FakeUSDC usdc = FakeUSDC(_deployed("FakeUSDC"));
        if (address(usdc) == address(0)) usdc = new FakeUSDC(deployer, deployer);
        DuelPot pot = DuelPot(_deployed("DuelPot"));
        if (address(pot) == address(0) || pot.NAMES() != names || pot.USDC() != usdc) pot = new DuelPot(names, usdc);
        Championships cups = Championships(_deployed("Championships"));
        if (address(cups) == address(0) || cups.NAMES() != names || cups.USDC() != usdc) {
            cups = new Championships(
                names, usdc, IVerifiableFactory(_ens("VerifiableFactory")), _ens("PermissionedResolverImpl"), deployer
            );
        }
        BoxResults results = BoxResults(_deployed("BoxResults"));
        if (
            address(results) == address(0) || results.NAMES() != names || results.STATS() != stats
                || results.POT() != pot || results.CUPS() != cups
        ) results = new BoxResults(names, stats, pot, cups);
        DemoLicences licences = DemoLicences(_deployed("DemoLicences"));
        if (address(licences) == address(0) || licences.NAMES() != names) licences = new DemoLicences(names);
        BoxSeats seats = BoxSeats(_deployed("BoxSeats"));
        if (address(seats) == address(0) || seats.NAMES() != names) seats = new BoxSeats(names);

        _grant(names, names.LICENSOR_ROLE(), deployer);
        _grant(names, names.LICENSOR_ROLE(), address(licences));
        _grant(names, names.REFEREE_ROLE(), address(results));
        _grant(names, names.SEATER_ROLE(), address(seats));
        if (names.statsWriter() != address(stats)) names.setStatsWriter(address(stats));
        if (names.championships() == address(0)) names.setChampionships(address(cups));
        if (usdc.gameSpender() == address(0)) usdc.setGameSpender(address(pot));
        vm.stopBroadcast();

        require(names.championships() == address(cups), "GameBoxNames has another championships contract");
        require(usdc.gameSpender() == address(pot), "FakeUSDC has another game spender");
        _save("P256AccountFactory", address(factory));
        _save("GameBoxNames", address(names));
        _save("PlayerStats", address(stats));
        _save("FakeUSDC", address(usdc));
        _save("DuelPot", address(pot));
        _save("Championships", address(cups));
        _save("BoxResults", address(results));
        _save("DemoLicences", address(licences));
        _save("BoxSeats", address(seats));
        _saveAddress(".names.registry", address(names.REGISTRY()));
        _saveAddress(".names.titleResolver", names.TITLE_RESOLVER());
        _saveAddress(".names.gameResolver", names.GAME_RESOLVER());
    }

    function _grant(GameBoxNames names, bytes32 role, address account) internal {
        if (!names.hasRole(role, account)) names.grantRole(role, account);
    }
}
