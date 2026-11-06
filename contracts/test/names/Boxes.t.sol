// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Vm} from "forge-std/Vm.sol";

import {P256Account} from "../../src/box/P256Account.sol";
import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {
    IEnhancedAccessControl,
    IPermissionedRegistry,
    IPermissionedResolver,
    IRegistry,
    ResolverRoles
} from "../../src/names/IENSv2.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesFork} from "./NamesFork.sol";

contract BoxesTest is NamesFork {
    string internal constant BOX = "egbt-box";
    string internal constant BOX_NAME = "egbt-box.gamebox.eth";

    function _keys() internal pure returns (string[8] memory) {
        return ["boxKey", "status", "commission", "location", "description", "games", "lastSeen", "game"];
    }

    /// @dev Who may write each of `_keys()`.
    function _writerOf(uint256 i) internal view returns (address) {
        if (i < 2) return address(names);
        if (i < 6) return operator;
        return address(demoBox);
    }

    function test_registerBoxRecords() public {
        IPermissionedResolver resolver = IPermissionedResolver(registerBox(BOX, 30 days));
        (bytes32 qx, bytes32 qy) = p256Public(boxKey);
        assertEq(resolveAddr(BOX_NAME), address(demoBox));
        assertEq(resolveText(BOX_NAME, "status"), "active");
        assertEq(resolveText(BOX_NAME, "boxKey"), vm.toString(abi.encodePacked(bytes1(0x04), qx, qy)));
        assertEq(registry.getOwner(NameLib.id(BOX)), operator);
        assertEq(registry.getResolver(BOX), address(resolver));
        IGameBoxNames.Box memory box = names.getBox(BOX);
        assertEq(box.operator, operator);
        assertEq(box.account, address(demoBox));
        assertEq(box.qx, qx);
        assertEq(box.qy, qy);
        assertEq(uint8(box.status), uint8(IGameBoxNames.BoxStatus.Active));
        assertEq(box.resolver, address(resolver));
        assertEq(box.expiry, block.timestamp + 30 days);
        (bytes32 kx, bytes32 ky) = names.boxKey(BOX);
        assertEq(kx, qx);
        assertEq(ky, qy);
    }

    /// @dev Every party tries every key, as an eth_call from that party: only the key's writer succeeds.
    function test_roleSplit() public {
        IPermissionedResolver resolver = IPermissionedResolver(registerBox(BOX, 30 days));
        bytes memory name = NameLib.dnsName(BOX);
        address[5] memory parties = [address(names), operator, address(demoBox), admin, account("stranger")];
        string[8] memory keys = _keys();
        for (uint256 p; p < parties.length; ++p) {
            for (uint256 k; k < keys.length; ++k) {
                vm.prank(parties[p]);
                (bool ok,) = address(resolver).call(abi.encodeCall(IPermissionedResolver.setText, (name, keys[k], "x")));
                assertEq(ok, parties[p] == _writerOf(k), string.concat("party ", vm.toString(p), " key ", keys[k]));
            }
            // Nobody but GameBoxNames may re-point `addr`.
            vm.prank(parties[p]);
            (bool okAddr,) = address(resolver)
                .call(
                    abi.encodeCall(
                        IPermissionedResolver.setAddress, (name, COIN_TYPE_ETH, abi.encodePacked(parties[p]))
                    )
                );
            assertEq(okAddr, parties[p] == address(names));
        }
    }

    function test_operatorCantRepointOrTransfer() public {
        registerBox(BOX, 30 days);
        uint256 id = NameLib.id(BOX);
        uint256 resource = registry.getResource(id);
        uint256 tokenId = registry.getTokenId(id);
        assertEq(registry.roles(id, operator), 0);

        vm.startPrank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, resource, 1 << 24, operator
            )
        );
        registry.setResolver(id, operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, resource, 1 << 20, operator
            )
        );
        registry.setSubregistry(id, IRegistry(operator));
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.TransferDisallowed.selector, tokenId, operator));
        registry.safeTransferFrom(operator, admin, tokenId, 1, "");
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, resource, 1 << 12, operator
            )
        );
        registry.unregister(id);
        vm.stopPrank();
    }

    /// @dev GameBoxNames only ever grants the eight Box keys (SET_TEXT on each), when it registers a Box and when it
    ///      moves a Box to a new account.
    function test_onlyTheEightBoxKeysAreGranted() public {
        vm.recordLogs();
        address resolver = registerBox(BOX, 30 days);
        P256Account next = new P256Account(bytes32(uint256(1)), bytes32(uint256(2)));
        vm.prank(admin);
        names.setBoxKey(BOX, bytes32(uint256(1)), bytes32(uint256(2)), address(next));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        string[8] memory keys = _keys();
        uint256 grants;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != resolver || logs[i].topics[0] != IEnhancedAccessControl.EACRolesChanged.selector) {
                continue;
            }
            uint256 resource = uint256(logs[i].topics[1]);
            (uint256 oldRoles, uint256 newRoles) = abi.decode(logs[i].data, (uint256, uint256));
            if (resource == 0) {
                // The setup grant: GameBoxNames' own root roles.
                assertEq(address(uint160(uint256(logs[i].topics[2]))), address(names));
                assertEq(newRoles, ResolverRoles.SET_TEXT_ADMIN | ResolverRoles.SET_ADDRESS | ResolverRoles.LINK);
                continue;
            }
            bool known;
            for (uint256 k; k < keys.length; ++k) {
                if (resource == ResolverRoles.textResource(keys[k])) known = true;
            }
            assertTrue(known, "a grant outside the eight Box keys");
            assertEq((oldRoles | newRoles) & ~ResolverRoles.SET_TEXT, 0, "a role other than SET_TEXT");
            if (newRoles > oldRoles) ++grants;
        }
        assertEq(grants, 10); // 8 at registration, then lastSeen and game to the new account
    }

    function test_setBoxKeyMovesTheBoxKeys() public {
        IPermissionedResolver resolver = IPermissionedResolver(registerBox(BOX, 30 days));
        P256Account next = new P256Account(bytes32(uint256(1)), bytes32(uint256(2)));
        vm.prank(admin);
        names.setBoxKey(BOX, bytes32(uint256(1)), bytes32(uint256(2)), address(next));
        assertEq(resolveAddr(BOX_NAME), address(next));
        bytes memory name = NameLib.dnsName(BOX);
        vm.prank(address(demoBox));
        vm.expectRevert();
        resolver.setText(name, "lastSeen", "1");
        vm.prank(address(next));
        resolver.setText(name, "lastSeen", "1");
        assertEq(resolveText(BOX_NAME, "lastSeen"), "1");
        (bytes32 qx,) = names.boxKey(BOX);
        assertEq(qx, bytes32(uint256(1)));
    }

    uint256 internal newKey = p256Key("egb-test-box-new");

    /// @dev A lost Box moves to a new key and account, made by the factory.
    function _rotate() internal returns (P256Account next) {
        (bytes32 qx, bytes32 qy) = p256Public(newKey);
        next = P256Account(payable(accounts.deploy(qx, qy)));
        vm.expectEmit(address(names));
        emit IGameBoxNames.BoxKeyChanged(BOX, address(next), qx, qy);
        vm.prank(admin);
        names.setBoxKey(BOX, qx, qy, address(next));
        assertEq(resolveAddr(BOX_NAME), address(next));
        assertEq(resolveText(BOX_NAME, "boxKey"), vm.toString(abi.encodePacked(bytes1(0x04), qx, qy)));
        assertEq(names.getBox(BOX).account, address(next));
    }

    /// @dev After a rotation the old account's signed heartbeat reverts and the new one's lands.
    function test_aRotatedBoxWritesWithTheNewAccountOnly() public {
        address resolver = registerBox(BOX, 30 days);
        P256Account next = _rotate();
        bytes memory data = abi.encodeCall(IPermissionedResolver.setText, (NameLib.dnsName(BOX), "game", "stockduel"));
        uint256 deadline = block.timestamp + 60;
        bytes memory oldSig = rawSign(boxKey, demoBox.executeDigest(resolver, 0, data, 1, deadline));
        bytes memory newSig = rawSign(newKey, next.executeDigest(resolver, 0, data, 1, deadline));
        vm.expectRevert();
        demoBox.execute(resolver, 0, data, 1, deadline, oldSig);
        next.execute(resolver, 0, data, 1, deadline, newSig);
        assertEq(resolveText(BOX_NAME, "game"), "stockduel");
    }

    /// @dev After a rotation BoxResults refuses the old key and takes the new one.
    function test_aRotatedBoxReportsWithTheNewKeyOnly() public {
        registerBox(BOX, 30 days);
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");
        _rotate();
        IBoxResults.Result memory r = result(BOX, "stockduel", 1, alice, bob, false);
        (bytes32 sr, bytes32 ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(IBoxResults.InvalidSignature.selector);
        results.submit(r, sr, ss);
        (sr, ss) = p256Sign(newKey, results.resultDigest(r));
        results.submit(r, sr, ss);
        assertEq(resolveAddr("champion.stockduel.gamebox.eth"), alice);
    }

    function test_setBoxKeyRefusals() public {
        registerBox(BOX, 30 days);
        address stranger = account("stranger");
        bytes32 licensor = names.LICENSOR_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, licensor)
        );
        names.setBoxKey(BOX, bytes32(uint256(1)), bytes32(uint256(2)), stranger);
        vm.startPrank(admin);
        vm.expectRevert(IGameBoxNames.ZeroValue.selector);
        names.setBoxKey(BOX, bytes32(0), bytes32(uint256(2)), stranger);
        vm.expectRevert(IGameBoxNames.ZeroValue.selector);
        names.setBoxKey(BOX, bytes32(uint256(1)), bytes32(uint256(2)), address(0));
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.UnknownBox.selector, "egbt-none"));
        names.setBoxKey("egbt-none", bytes32(uint256(1)), bytes32(uint256(2)), stranger);
        vm.stopPrank();
    }

    /// @dev The Box writes its heartbeat through its own account: a P-256-signed `execute`.
    function test_boxWritesLastSeenThroughItsAccount() public {
        address resolver = registerBox(BOX, 30 days);
        bytes memory data =
            abi.encodeCall(IPermissionedResolver.setText, (NameLib.dnsName(BOX), "lastSeen", "1762400000"));
        uint256 deadline = block.timestamp + 60;
        demoBox.execute(
            resolver, 0, data, 1, deadline, rawSign(boxKey, demoBox.executeDigest(resolver, 0, data, 1, deadline))
        );
        assertEq(resolveText(BOX_NAME, "lastSeen"), "1762400000");
    }

    /// @dev A resolver is read through ENSIP-10 `resolve`; it has no direct `text` function.
    function test_recordsAreReadThroughResolve() public {
        IPermissionedResolver resolver = IPermissionedResolver(registerBox(BOX, 30 days));
        bytes memory call = abi.encodeWithSignature("text(bytes32,string)", namehash(BOX_NAME), "status");
        assertEq(abi.decode(resolver.resolve(NameLib.dnsName(BOX), call), (string)), "active");
        (bool ok,) = address(resolver).staticcall(call);
        assertFalse(ok);
    }

    function test_labelAlreadyRegistered() public {
        registerBox(BOX, 30 days);
        (bytes32 qx, bytes32 qy) = p256Public(boxKey);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.LabelAlreadyRegistered.selector, BOX));
        names.registerBox(BOX, operator, address(demoBox), qx, qy, uint64(block.timestamp + 1 days));
    }

    function test_registerBoxRefusals() public {
        (bytes32 qx, bytes32 qy) = p256Public(boxKey);
        uint64 expiry = uint64(block.timestamp + 1 days);
        address stranger = account("stranger");
        bytes32 licensor = names.LICENSOR_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, licensor)
        );
        names.registerBox(BOX, operator, address(demoBox), qx, qy, expiry);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.InvalidLabel.selector, "Egbt"));
        names.registerBox("Egbt", operator, address(demoBox), qx, qy, expiry);
        vm.expectRevert(IGameBoxNames.ZeroValue.selector);
        names.registerBox(BOX, address(0), address(demoBox), qx, qy, expiry);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.CannotSetPastExpiry.selector, block.timestamp));
        names.registerBox(BOX, operator, address(demoBox), qx, qy, uint64(block.timestamp));
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.UnknownBox.selector, "egbt-none"));
        names.renewBox("egbt-none", expiry);
        vm.expectRevert(IGameBoxNames.InvalidStatus.selector);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.None);
        vm.stopPrank();
    }

    function test_renewExtends() public {
        registerBox(BOX, 1 days);
        uint64 later = uint64(block.timestamp + 60 days);
        vm.prank(admin);
        names.renewBox(BOX, later);
        assertEq(registry.getExpiry(NameLib.id(BOX)), later);
        assertEq(names.getBox(BOX).expiry, later);
    }

    function test_renewCantMoveExpiryEarlier() public {
        registerBox(BOX, 30 days);
        uint64 expiry = uint64(block.timestamp + 30 days);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.CannotReduceExpiry.selector, expiry, expiry - 1));
        names.renewBox(BOX, expiry - 1);
    }

    function test_renewRevivesALapsedName() public {
        registerBox(BOX, 1 days);
        vm.warp(block.timestamp + 2 days);
        assertEq(resolveAddr(BOX_NAME), address(0));
        assertEq(uint8(registry.getStatus(NameLib.id(BOX))), uint8(IPermissionedRegistry.Status.AVAILABLE));

        vm.prank(admin);
        names.renewBox(BOX, uint64(block.timestamp + 30 days));
        assertEq(uint8(registry.getStatus(NameLib.id(BOX))), uint8(IPermissionedRegistry.Status.REGISTERED));
        assertEq(registry.getOwner(NameLib.id(BOX)), operator);
        assertEq(resolveAddr(BOX_NAME), address(demoBox));
        // The resolver kept its role table: the operator still writes its keys.
        IPermissionedResolver resolver = resolverOf(BOX);
        vm.prank(operator);
        resolver.setText(NameLib.dnsName(BOX), "location", "Mumbai");
        assertEq(resolveText(BOX_NAME, "location"), "Mumbai");
    }

    /// @dev A licence lapses: the name stops resolving to the Box (it falls back to the default record), and a second
    ///      operator registers the label with a resolver of its own.
    function test_lapseThenASecondOperator() public {
        address firstResolver = registerBox(BOX, 1 days);
        uint256 firstToken = registry.getTokenId(NameLib.id(BOX));
        vm.prank(operator);
        IPermissionedResolver(firstResolver).setText(NameLib.dnsName(BOX), "location", "Mumbai");
        assertEq(resolveText(BOX_NAME, "location"), "Mumbai");

        vm.warp(block.timestamp + 1 days);
        assertEq(resolveAddr(BOX_NAME), address(0));
        assertEq(resolveText(BOX_NAME, "location"), "");
        // The lapsed name falls back to gamebox.eth's default record.
        assertEq(resolveResolver(BOX_NAME), gameboxResolver);
        assertEq(resolveText(BOX_NAME, "description"), "This Game Box name is free.");

        address second = account("operator-2");
        uint256 secondKey = p256Key("egb-test-box-2");
        (bytes32 qx, bytes32 qy) = p256Public(secondKey);
        P256Account secondBox = new P256Account(qx, qy);
        vm.prank(admin);
        address secondResolver =
            names.registerBox(BOX, second, address(secondBox), qx, qy, uint64(block.timestamp + 30 days));

        assertTrue(secondResolver != firstResolver);
        assertEq(registry.getOwner(NameLib.id(BOX)), second);
        assertEq(registry.ownerOf(firstToken), address(0));
        assertEq(resolveAddr(BOX_NAME), address(secondBox));
        assertEq(resolveText(BOX_NAME, "location"), "");
        // The first operator holds nothing on the new resolver.
        vm.prank(operator);
        vm.expectRevert();
        IPermissionedResolver(secondResolver).setText(NameLib.dnsName(BOX), "location", "x");
    }

    function test_suspendedAndRevokedAreRefusedButStillResolve() public {
        registerBox(BOX, 30 days);
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");

        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Suspended);
        assertEq(resolveText(BOX_NAME, "status"), "suspended");
        assertEq(resolveAddr(BOX_NAME), address(demoBox));
        IBoxResults.Result memory r = result(BOX, "stockduel", 1, alice, bob, false);
        (bytes32 sr, bytes32 ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(abi.encodeWithSelector(IBoxResults.BoxNotActive.selector, BOX));
        results.submit(r, sr, ss);

        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Revoked);
        assertEq(resolveText(BOX_NAME, "status"), "revoked");
        assertEq(resolveAddr(BOX_NAME), address(demoBox));
        vm.expectRevert(abi.encodeWithSelector(IBoxResults.BoxNotActive.selector, BOX));
        results.submit(r, sr, ss);

        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Active);
        results.submit(r, sr, ss);
        assertEq(resolveAddr("champion.stockduel.gamebox.eth"), alice);
    }
}
