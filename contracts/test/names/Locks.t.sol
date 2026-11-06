// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {
    IEnhancedAccessControl,
    IPermissionedRegistry,
    IRegistry,
    RegistryRoles,
    ResolverRoles
} from "../../src/names/IENSv2.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesFork} from "./NamesFork.sol";

/// @notice ENS's `UniversalHelper`: walks a registry's locked canonical parents up to the root.
interface IUniversalHelper {
    function findCanonicalName(IRegistry registry) external view returns (bytes memory);
}

/// @notice The canonical-parent lock on every registry we create, and the registrar hand-over.
contract LocksTest is NamesFork {
    uint256 internal constant PARENT_ROLES =
        RegistryRoles.REGISTRAR | RegistryRoles.REGISTRAR_ADMIN | RegistryRoles.RENEW | RegistryRoles.RENEW_ADMIN;
    uint256 internal constant TITLE_ROLES = PARENT_ROLES | RegistryRoles.UNREGISTER | RegistryRoles.UNREGISTER_ADMIN;

    function _registries() internal view returns (IPermissionedRegistry[3] memory) {
        return [
            registry,
            IPermissionedRegistry(names.getGame("stockduel").titleRegistry),
            IPermissionedRegistry(names.getGame("quickdraw").titleRegistry)
        ];
    }

    /// @dev Bits of `roleCount(ROOT)` for one role nybble: how many hold it.
    function _holders(IPermissionedRegistry r, uint256 role) internal view returns (uint256) {
        uint256 shift;
        while (role >> shift != 1) shift += 4;
        return (r.roleCount(0) >> shift) & 0xf;
    }

    function test_nobodyHoldsSetParentOnOurRegistries() public view {
        IPermissionedRegistry[3] memory rs = _registries();
        for (uint256 i; i < rs.length; ++i) {
            assertEq(_holders(rs[i], RegistryRoles.SET_PARENT), 0);
            assertEq(_holders(rs[i], RegistryRoles.SET_PARENT_ADMIN), 0);
            assertFalse(rs[i].hasRootRoles(RegistryRoles.SET_PARENT, address(names)));
        }
        assertEq(registry.roles(0, address(names)), PARENT_ROLES);
        assertEq(rs[1].roles(0, address(names)), TITLE_ROLES);
    }

    function test_theParentCantBeMoved() public {
        vm.prank(address(names));
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, RegistryRoles.SET_PARENT, address(names)
            )
        );
        registry.setParent(IRegistry(address(0)), "x");
    }

    function test_findCanonicalNameOnOurRegistries() public view {
        IUniversalHelper helper = IUniversalHelper(
            vm.parseJsonAddress(vm.readFile("../deployments/sepolia.json"), ".ens.UniversalHelper.address")
        );
        assertEq(helper.findCanonicalName(registry), dns("gamebox.eth"));
        assertEq(
            helper.findCanonicalName(IRegistry(names.getGame("stockduel").titleRegistry)), dns("stockduel.gamebox.eth")
        );
    }

    function test_handOverRegistrar() public {
        address next = account("next-registrar");
        vm.expectEmit(address(names));
        emit IGameBoxNames.RegistrarHandedOver(next);
        vm.prank(admin);
        names.handOverRegistrar(next);

        IPermissionedRegistry[3] memory rs = _registries();
        assertEq(rs[0].roles(0, next), PARENT_ROLES);
        assertEq(rs[0].roles(0, address(names)), 0);
        for (uint256 i = 1; i < rs.length; ++i) {
            assertEq(rs[i].roles(0, next), TITLE_ROLES);
            assertEq(rs[i].roles(0, address(names)), 0);
        }
        assertTrue(registry.isEmancipated());

        // GameBoxNames can't register any more; the successor can.
        (bytes32 qx, bytes32 qy) = p256Public(boxKey);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, RegistryRoles.REGISTRAR, address(names)
            )
        );
        names.registerBox("egbt-box", operator, address(demoBox), qx, qy, uint64(block.timestamp + 1 days));
        vm.prank(next);
        registry.register("egbt-next", next, IRegistry(address(0)), address(0), 0, uint64(block.timestamp + 1 days));
        assertEq(registry.getOwner(NameLib.id("egbt-next")), next);
        // ... and can hand on again: it holds the admins.
        address after_ = account("after-registrar");
        vm.startPrank(next);
        registry.grantRootRoles(PARENT_ROLES, after_);
        registry.revokeRootRoles(PARENT_ROLES, next);
        vm.stopPrank();
        assertTrue(registry.isEmancipated());
    }

    function test_handOverNeedsTheAdmin() public {
        address stranger = account("stranger");
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, bytes32(0))
        );
        names.handOverRegistrar(stranger);
        vm.prank(admin);
        vm.expectRevert(IGameBoxNames.ZeroValue.selector);
        names.handOverRegistrar(address(0));
    }

    /// @dev Nobody holds UPGRADE on a Box resolver or on the shared resolvers.
    function test_nobodyCanUpgradeOurResolvers() public {
        address[4] memory rs =
            [registerBox("egbt-box", 30 days), names.TITLE_RESOLVER(), names.GAME_RESOLVER(), gameboxResolver];
        for (uint256 i; i < rs.length; ++i) {
            uint256 counts = IPermissionedRegistry(rs[i]).roleCount(0);
            assertEq((counts >> 124) & 0xf, 0, "UPGRADE");
            assertEq((counts >> 252) & 0xf, 0, "UPGRADE_ADMIN");
        }
        assertEq(
            IPermissionedRegistry(rs[0]).roles(0, address(names)),
            ResolverRoles.SET_TEXT_ADMIN | ResolverRoles.SET_ADDRESS | ResolverRoles.LINK
        );
    }
}
