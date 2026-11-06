// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {
    IPermissionedRegistry,
    IPermissionedResolver,
    IVerifiableFactory,
    RegistryRoles,
    ResolverRoles
} from "../../src/names/IENSv2.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {IPlayerStats} from "../../src/names/IPlayerStats.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesFork} from "./NamesFork.sol";

/// @notice A contract wallet: ERC-1271 says yes to its owner's ECDSA signatures, and it can hold ERC-1155 names.
contract Wallet1271 is IERC1271, ERC1155Holder {
    address public immutable OWNER;

    constructor(address owner) {
        OWNER = owner;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == OWNER ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

/// @notice A resolver a badge could point its name at (or upgrade to): it burns every bit of gas it is given.
contract GasBurner {
    fallback() external {
        while (true) {}
    }
}

contract PlayersTest is NamesFork {
    uint256 internal constant ALL_RESOLVER_ROLES = ResolverRoles.SET_ADDRESS | ResolverRoles.SET_TEXT
        | ResolverRoles.SET_CONTENTHASH | ResolverRoles.SET_ABI | ResolverRoles.SET_INTERFACE | ResolverRoles.SET_NAME
        | ResolverRoles.SET_DATA | ResolverRoles.LINK | ResolverRoles.CAN_NAME | ResolverRoles.UPGRADE;

    function _box() internal returns (string memory) {
        registerBox("egbt-box", 30 days);
        return "egbt-box";
    }

    function test_claimResolves() public {
        (address alice,) = claim("egbt-alice");
        assertEq(resolveAddr("egbt-alice.gamebox.eth"), alice);
        assertEq(names.labelOf(alice), "egbt-alice");
        assertEq(names.nameOf(alice), "egbt-alice.gamebox.eth");
        assertEq(registry.getOwner(NameLib.id("egbt-alice")), alice);
        assertEq(registry.getExpiry(NameLib.id("egbt-alice")), type(uint64).max);
    }

    function test_registryIsEmancipated() public {
        claim("egbt-alice");
        assertTrue(registry.isEmancipated());
        assertEq(
            registry.roles(0, address(names)),
            RegistryRoles.REGISTRAR | RegistryRoles.REGISTRAR_ADMIN | RegistryRoles.RENEW | RegistryRoles.RENEW_ADMIN
        );
        (IPermissionedRegistry parent, string memory label) = _parent();
        assertEq(address(parent), address(ethRegistry));
        assertEq(label, "gamebox");
    }

    function _parent() internal view returns (IPermissionedRegistry parent, string memory label) {
        (bool ok, bytes memory ret) = address(registry).staticcall(abi.encodeWithSignature("getParent()"));
        require(ok);
        return abi.decode(ret, (IPermissionedRegistry, string));
    }

    function test_badgeHoldsEveryRoleAndStatsOnlyStats() public {
        (address alice,) = claim("egbt-alice");
        IPermissionedResolver resolver = resolverOf("egbt-alice");
        uint256 stat = ResolverRoles.textResource("stats");

        assertEq(resolver.roles(0, alice), ALL_RESOLVER_ROLES | (ALL_RESOLVER_ROLES << 128));
        assertEq(resolver.roles(0, address(stats)), 0);
        assertEq(resolver.roles(stat, address(stats)), ResolverRoles.SET_TEXT);
        assertEq(resolver.roles(0, address(names)), 0);
        assertEq(resolver.roles(stat, address(names)), 0);

        bytes memory name = NameLib.dnsName("egbt-alice");
        vm.startPrank(address(stats));
        resolver.setText(name, "stats", "{}");
        vm.expectRevert();
        resolver.setText(name, "avatar", "x");
        vm.expectRevert();
        resolver.setAddress(name, COIN_TYPE_ETH, abi.encodePacked(address(stats)));
        vm.stopPrank();

        vm.startPrank(alice);
        resolver.setText(name, "avatar", "https://example.com/a.png");
        resolver.setText(name, "stats", "mine");
        vm.stopPrank();
        assertEq(resolveText("egbt-alice.gamebox.eth", "avatar"), "https://example.com/a.png");

        // The badge's token roles: everything a token can carry.
        assertEq(
            registry.roles(NameLib.id("egbt-alice"), alice),
            RegistryRoles.UNREGISTER | RegistryRoles.UNREGISTER_ADMIN | RegistryRoles.RENEW | RegistryRoles.RENEW_ADMIN
                | RegistryRoles.SET_SUBREGISTRY | RegistryRoles.SET_SUBREGISTRY_ADMIN | RegistryRoles.SET_RESOLVER
                | RegistryRoles.SET_RESOLVER_ADMIN | RegistryRoles.CAN_TRANSFER_ADMIN
        );
    }

    function test_claimRefusals() public {
        (address badge, uint256 key) = accountWithKey("badge-refusals");
        uint256 deadline = block.timestamp + 1 hours;

        // Wrong signer.
        (, uint256 otherKey) = accountWithKey("someone-else");
        bytes memory wrong = claimSignature("egbt-alice", badge, otherKey, deadline);
        vm.expectRevert(IGameBoxNames.InvalidClaimSignature.selector);
        names.claimPlayer("egbt-alice", badge, deadline, wrong);

        // Expired deadline.
        uint256 past = block.timestamp - 1;
        bytes memory late = claimSignature("egbt-alice", badge, key, past);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.DeadlineExpired.selector, past));
        names.claimPlayer("egbt-alice", badge, past, late);

        // Bad label.
        bytes memory bad = claimSignature("Egbt-Alice", badge, key, deadline);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.InvalidLabel.selector, "Egbt-Alice"));
        names.claimPlayer("Egbt-Alice", badge, deadline, bad);

        // Taken label.
        claim("egbt-taken");
        bytes memory taken = claimSignature("egbt-taken", badge, key, deadline);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.LabelAlreadyRegistered.selector, "egbt-taken"));
        names.claimPlayer("egbt-taken", badge, deadline, taken);

        // A Box's label.
        _box();
        bytes memory boxLabel = claimSignature("egbt-box", badge, key, deadline);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.LabelHeldByBox.selector, "egbt-box"));
        names.claimPlayer("egbt-box", badge, deadline, boxLabel);

        // A second name for the same badge.
        names.claimPlayer("egbt-first", badge, deadline, claimSignature("egbt-first", badge, key, deadline));
        bytes memory second = claimSignature("egbt-second", badge, key, deadline);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.BadgeHasName.selector, badge, "egbt-first"));
        names.claimPlayer("egbt-second", badge, deadline, second);
    }

    function test_claimNeedsTheStatsWriter() public {
        string memory json = vm.readFile("../deployments/sepolia.json");
        GameBoxNames fresh = new GameBoxNames(
            IVerifiableFactory(vm.parseJsonAddress(json, ".ens.VerifiableFactory.address")),
            vm.parseJsonAddress(json, ".ens.UserRegistryImpl.address"),
            vm.parseJsonAddress(json, ".ens.PermissionedResolverImpl.address"),
            ethRegistry,
            admin
        );
        (address badge, uint256 key) = accountWithKey("badge-fresh");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, fresh.claimDigest("egbt-alice", badge, deadline));
        vm.expectRevert(IGameBoxNames.StatsWriterNotSet.selector);
        fresh.claimPlayer("egbt-alice", badge, deadline, abi.encodePacked(r, s, v));
    }

    function test_erc1271WalletClaims() public {
        (address owner, uint256 key) = accountWithKey("wallet-owner");
        Wallet1271 wallet = new Wallet1271(owner);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, names.claimDigest("egbt-wallet", address(wallet), deadline));
        names.claimPlayer("egbt-wallet", address(wallet), deadline, abi.encodePacked(r, s, v));
        assertEq(resolveAddr("egbt-wallet.gamebox.eth"), address(wallet));
        assertEq(registry.balanceOf(address(wallet), registry.getTokenId(NameLib.id("egbt-wallet"))), 1);

        (, uint256 otherKey) = accountWithKey("not-the-owner");
        (v, r, s) = vm.sign(otherKey, names.claimDigest("egbt-wallet-2", address(wallet), deadline));
        Wallet1271 other = new Wallet1271(owner);
        vm.expectRevert(IGameBoxNames.InvalidClaimSignature.selector);
        names.claimPlayer("egbt-wallet-2", address(other), deadline, abi.encodePacked(r, s, v));
    }

    /// @dev Changing any one signed field breaks the signature.
    function testFuzz_claimSignatureCoversEveryField(uint8 field, uint32 extra, address otherBadge) public {
        (address badge, uint256 key) = accountWithKey("badge-fuzz");
        vm.assume(otherBadge != badge && otherBadge.code.length == 0 && uint160(otherBadge) > 0xffff);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = claimSignature("egbt-fuzz", badge, key, deadline);
        string memory label = "egbt-fuzz";
        address who = badge;
        uint256 when = deadline;
        field = field % 3;
        if (field == 0) label = string.concat("egbt-fuzz-", vm.toString(uint256(extra) % 1e6));
        else if (field == 1) who = otherBadge;
        else when = deadline + 1 + extra;
        vm.expectRevert(IGameBoxNames.InvalidClaimSignature.selector);
        names.claimPlayer(label, who, when, signature);
    }

    function test_badgeRevokesStatsAndTheOpponentStillSettles() public {
        string memory box = _box();
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");
        IPermissionedResolver bobs = resolverOf("egbt-bob");

        vm.prank(bob);
        bobs.revokeRoles(ResolverRoles.textResource("stats"), ResolverRoles.SET_TEXT, address(stats));
        assertFalse(bobs.hasRoles(ResolverRoles.textResource("stats"), ResolverRoles.SET_TEXT, address(stats)));

        vm.expectEmit(address(stats));
        emit IPlayerStats.StatsWritten(alice, '{"stockduel":{"wins":1,"losses":0,"draws":0}}');
        vm.expectEmit(address(stats));
        emit IPlayerStats.StatsSkipped(bob);
        submit(result(box, "stockduel", 1, alice, bob, false));

        assertEq(resolveText("egbt-alice.gamebox.eth", "stats"), '{"stockduel":{"wins":1,"losses":0,"draws":0}}');
        assertEq(resolveText("egbt-bob.gamebox.eth", "stats"), "");
        assertEq(resolveAddr("champion.stockduel.gamebox.eth"), alice);
        // The count still moves on chain.
        assertEq(stats.statsOf(bob, "stockduel").losses, 1);
    }

    /// @dev A badge points its name at a resolver that burns all the gas it gets: the result still settles.
    function test_aHostileResolverCantBlockTheOpponent() public {
        string memory box = _box();
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");
        GasBurner burner = new GasBurner();
        vm.prank(bob);
        registry.setResolver(NameLib.id("egbt-bob"), address(burner));

        vm.expectEmit(address(stats));
        emit IPlayerStats.StatsSkipped(bob);
        submit(result(box, "stockduel", 1, bob, alice, false));
        assertEq(resolveText("egbt-alice.gamebox.eth", "stats"), '{"stockduel":{"wins":0,"losses":1,"draws":0}}');
        assertEq(resolveAddr("champion.stockduel.gamebox.eth"), bob);
    }

    function test_tooLittleGasCantForceASkip() public {
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");
        vm.prank(address(results));
        vm.expectRevert(IPlayerStats.InsufficientGas.selector);
        stats.record{gas: 500_000}("stockduel", alice, bob, false);
    }

    function test_statsRefusals() public {
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");
        address stranger = account("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IPlayerStats.NotReferee.selector, stranger));
        stats.record("stockduel", alice, bob, false);

        vm.startPrank(address(results));
        vm.expectRevert(abi.encodeWithSelector(IPlayerStats.UnknownGame.selector, "egbt-nogame"));
        stats.record("egbt-nogame", alice, bob, false);
        vm.expectRevert(abi.encodeWithSelector(IPlayerStats.SamePlayer.selector, alice));
        stats.record("stockduel", alice, alice, false);
        vm.expectRevert(abi.encodeWithSelector(IPlayerStats.NotAPlayer.selector, stranger));
        stats.record("stockduel", alice, stranger, false);
        vm.stopPrank();
    }

    function test_drawsAndSeveralGames() public {
        string memory box = _box();
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");
        submit(result(box, "quickdraw", 1, alice, bob, true));
        submit(result(box, "stockduel", 2, bob, alice, false));
        assertEq(
            resolveText("egbt-alice.gamebox.eth", "stats"),
            '{"quickdraw":{"wins":0,"losses":0,"draws":1},"stockduel":{"wins":0,"losses":1,"draws":0}}'
        );
        // A draw crowns nobody.
        assertEq(names.getTitle("quickdraw").holder, address(0));
        assertEq(resolveAddr("champion.quickdraw.gamebox.eth"), address(0));
    }

    /// @dev A badge may move its name away (the registry is emancipated); it is then no longer a player.
    function test_aMovedNameIsNoLongerAPlayer() public {
        string memory box = _box();
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");
        address carol = account("carol");
        uint256 token = registry.getTokenId(NameLib.id("egbt-alice"));
        vm.prank(alice);
        registry.safeTransferFrom(alice, carol, token, 1, "");
        assertEq(names.labelOf(alice), "");
        assertEq(names.labelOf(carol), "");

        IBoxResults.Result memory r = result(box, "stockduel", 1, alice, bob, false);
        (bytes32 sr, bytes32 ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(abi.encodeWithSelector(IBoxResults.NotAPlayer.selector, alice));
        results.submit(r, sr, ss);
    }
}
