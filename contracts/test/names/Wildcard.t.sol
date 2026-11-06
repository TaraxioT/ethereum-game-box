// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermissionedResolver, IRegistry, ResolverRoles} from "../../src/names/IENSv2.sol";
import {NamesFork} from "./NamesFork.sol";

/// @notice `gamebox.eth`'s own resolver and its default record: what every free `*.gamebox.eth` name resolves to.
contract WildcardTest is NamesFork {
    string internal constant FREE = "This Game Box name is free.";
    string internal constant URL = "https://gamebox-names.pages.dev/#/players";

    function test_aNeverRegisteredLabelGetsTheDefault() public view {
        string memory name = "egbt-never-registered.gamebox.eth";
        assertEq(resolveResolver(name), gameboxResolver);
        assertEq(resolveText(name, "url"), URL);
        assertEq(resolveText(name, "description"), FREE);
        assertEq(resolveAddr(name), address(0));
        assertEq(resolveText(name, "location"), "");
    }

    function test_deeperFreeNamesGetTheDefaultToo() public view {
        assertEq(resolveText("a.b.egbt-free.gamebox.eth", "description"), FREE);
    }

    function test_gameboxEthItselfReadsTheDefault() public view {
        assertEq(ethRegistry.getResolver("gamebox"), gameboxResolver);
        assertEq(resolveText("gamebox.eth", "url"), URL);
    }

    function test_aPlayersOwnRecordsWin() public {
        (address alice,) = claim("egbt-alice");
        string memory name = "egbt-alice.gamebox.eth";
        assertEq(resolveResolver(name), registry.getResolver("egbt-alice"));
        assertEq(resolveAddr(name), alice);
        assertEq(resolveText(name, "description"), "");
        assertEq(resolveText(name, "url"), "");
    }

    function test_aNameOutsideGameboxIsUntouched() public view {
        assertTrue(resolveResolver("egbt-never-registered.eth") != gameboxResolver);
        assertEq(resolveText("egbt-never-registered.eth", "description"), "");
    }

    function test_onlyTheOwnerWritesTheDefault() public {
        IPermissionedResolver r = IPermissionedResolver(gameboxResolver);
        assertEq(r.roles(0, ENS_DEPLOYER), ResolverRoles.SET_TEXT | ResolverRoles.SET_TEXT_ADMIN);
        vm.prank(account("stranger"));
        vm.expectRevert();
        r.setText(hex"00", "description", "x");
        vm.prank(ENS_DEPLOYER);
        r.setText(hex"00", "description", "changed");
        assertEq(resolveText("egbt-free.gamebox.eth", "description"), "changed");
        vm.prank(ENS_DEPLOYER);
        vm.expectRevert();
        r.setAddress(hex"00", COIN_TYPE_ETH, abi.encodePacked(ENS_DEPLOYER));
    }

    /// @dev Re-pointing gamebox.eth at our registry changed nothing else on the name: the deployer still owns it.
    function test_gameboxEthStillBelongsToItsOwner() public view {
        assertEq(ethRegistry.getOwner(uint256(keccak256("gamebox"))), ENS_DEPLOYER);
        assertEq(address(ethRegistry.getSubregistry("gamebox")), address(IRegistry(address(registry))));
    }
}
