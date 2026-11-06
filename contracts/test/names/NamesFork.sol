// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {P256Account} from "../../src/box/P256Account.sol";
import {P256AccountFactory} from "../../src/box/P256AccountFactory.sol";
import {BoxResults} from "../../src/names/BoxResults.sol";
import {DefaultRecord} from "../../src/names/DefaultRecord.sol";
import {DemoLicences} from "../../src/names/DemoLicences.sol";
import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {
    IPermissionedRegistry,
    IPermissionedResolver,
    IRegistry,
    IUniversalResolver,
    IVerifiableFactory
} from "../../src/names/IENSv2.sol";
import {PlayerStats} from "../../src/names/PlayerStats.sol";
import {P256Keys} from "../box/P256Keys.sol";

/// @notice A fork of Sepolia at a pinned block with the live ENSv2 contracts, and the Game Box names deployed on it
///         the way `script/` deploys them: the account factory and the demo Box's account, `gamebox.eth` pointed at
///         our registry and at its own resolver with the default record, both games added, the roles granted.
abstract contract NamesFork is Test, P256Keys {
    /// @dev After `gamebox.eth` moved to the deployer.
    uint256 internal constant FORK_BLOCK = 12_075_200;
    uint256 internal constant COIN_TYPE_ETH = 60;

    address internal constant ENS_DEPLOYER = 0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E;

    IPermissionedRegistry internal ethRegistry;
    IUniversalResolver internal universalResolver;
    IVerifiableFactory internal ensFactory;
    address internal resolverImpl;

    GameBoxNames internal names;
    PlayerStats internal stats;
    BoxResults internal results;
    DemoLicences internal licences;
    P256AccountFactory internal accounts;
    P256Account internal demoBox;
    IPermissionedRegistry internal registry;
    /// @notice `gamebox.eth`'s own resolver, with the default record.
    address internal gameboxResolver;

    uint256 internal boxKey = p256Key("egb-test-box");
    address internal admin = account("admin");
    address internal operator = account("operator");

    function setUp() public virtual {
        vm.createSelectFork("sepolia", FORK_BLOCK);
        string memory json = vm.readFile("../deployments/sepolia.json");
        ethRegistry = IPermissionedRegistry(vm.parseJsonAddress(json, ".ens.ETHRegistry.address"));
        universalResolver = IUniversalResolver(vm.parseJsonAddress(json, ".ens.UniversalResolver.address"));

        ensFactory = IVerifiableFactory(vm.parseJsonAddress(json, ".ens.VerifiableFactory.address"));
        resolverImpl = vm.parseJsonAddress(json, ".ens.PermissionedResolverImpl.address");

        vm.startPrank(admin);
        accounts = new P256AccountFactory();
        names = new GameBoxNames(
            ensFactory, vm.parseJsonAddress(json, ".ens.UserRegistryImpl.address"), resolverImpl, ethRegistry, admin
        );
        stats = new PlayerStats(names);
        results = new BoxResults(names, stats);
        licences = new DemoLicences(names);
        names.grantRole(names.LICENSOR_ROLE(), admin);
        names.grantRole(names.LICENSOR_ROLE(), address(licences));
        names.grantRole(names.REFEREE_ROLE(), address(results));
        names.setStatsWriter(address(stats));
        (bytes32 qx, bytes32 qy) = p256Public(boxKey);
        demoBox = P256Account(payable(accounts.deploy(qx, qy)));
        vm.stopPrank();

        registry = names.REGISTRY();
        vm.startPrank(ENS_DEPLOYER);
        ethRegistry.setSubregistry(uint256(keccak256("gamebox")), IRegistry(address(registry)));
        gameboxResolver = ensFactory.deployProxy(
            resolverImpl, uint256(keccak256("gamebox.eth resolver")), DefaultRecord.initData(ENS_DEPLOYER)
        );
        ethRegistry.setResolver(uint256(keccak256("gamebox")), gameboxResolver);
        vm.stopPrank();

        vm.startPrank(admin);
        names.addGame("stockduel", 7 days);
        names.addGame("quickdraw", 15 minutes);
        vm.stopPrank();
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Accounts
    // ----------------------------------------------------------------------------------------------------------------

    /// @dev Prefixed, so the address can't collide with live Sepolia state; checked to have no code.
    function account(string memory name) internal returns (address a) {
        a = makeAddr(string.concat("egb-test-", name));
        require(a.code.length == 0, "test account has code on Sepolia");
    }

    function accountWithKey(string memory name) internal returns (address a, uint256 key) {
        (a, key) = makeAddrAndKey(string.concat("egb-test-", name));
        require(a.code.length == 0, "test account has code on Sepolia");
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------------------------------------------------------

    function claimSignature(string memory label, address badge, uint256 key, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, names.claimDigest(label, badge, deadline));
        return abi.encodePacked(r, s, v);
    }

    /// @dev A fresh badge claims `<label>.gamebox.eth`.
    function claim(string memory label) internal returns (address badge, uint256 key) {
        (badge, key) = accountWithKey(string.concat("badge-", label));
        uint256 deadline = block.timestamp + 1 hours;
        names.claimPlayer(label, badge, deadline, claimSignature(label, badge, key, deadline));
    }

    /// @dev A raw P-256 signature (`r ‖ s`, low `s`) of `digest`.
    function rawSign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        return abi.encodePacked(r, s);
    }

    function registerBox(string memory label, uint64 term) internal returns (address resolver) {
        (bytes32 qx, bytes32 qy) = p256Public(boxKey);
        vm.prank(admin);
        resolver = names.registerBox(label, operator, address(demoBox), qx, qy, uint64(block.timestamp) + term);
    }

    function result(string memory box, string memory game, uint256 round, address winner, address loser, bool draw)
        internal
        view
        returns (IBoxResults.Result memory)
    {
        return IBoxResults.Result(box, game, round, winner, loser, draw, block.timestamp + 1 hours);
    }

    /// @dev Signs `r` with the demo Box's key (low `s`) and submits it.
    function submit(IBoxResults.Result memory r) internal {
        (bytes32 sr, bytes32 ss) = p256Sign(boxKey, results.resultDigest(r));
        results.submit(r, sr, ss);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Reads through the Universal Resolver, the path viem's getEnsAddress and getEnsText take
    // ----------------------------------------------------------------------------------------------------------------

    function dns(string memory fullName) internal pure returns (bytes memory out) {
        bytes memory s = bytes(fullName);
        uint256 start;
        for (uint256 i; i <= s.length; ++i) {
            if (i == s.length || s[i] == ".") {
                bytes memory label = new bytes(i - start);
                for (uint256 j; j < label.length; ++j) {
                    label[j] = s[start + j];
                }
                out = abi.encodePacked(out, uint8(label.length), label);
                start = i + 1;
            }
        }
        out = abi.encodePacked(out, uint8(0));
    }

    function namehash(string memory fullName) internal pure returns (bytes32 node) {
        bytes memory name = dns(fullName);
        return _namehash(name, 0);
    }

    function _namehash(bytes memory name, uint256 offset) private pure returns (bytes32) {
        uint256 len = uint8(name[offset]);
        if (len == 0) return bytes32(0);
        bytes memory label = new bytes(len);
        for (uint256 j; j < len; ++j) {
            label[j] = name[offset + 1 + j];
        }
        return keccak256(abi.encodePacked(_namehash(name, offset + 1 + len), keccak256(label)));
    }

    /// @dev `resolve(name, addr(node))`; zero when the name does not resolve (as viem returns null).
    function resolveAddr(string memory fullName) internal view returns (address) {
        bytes memory call = abi.encodeWithSignature("addr(bytes32)", namehash(fullName));
        (bool ok, bytes memory ret) =
            address(universalResolver).staticcall(abi.encodeCall(IUniversalResolver.resolve, (dns(fullName), call)));
        if (!ok) return address(0);
        (bytes memory answer,) = abi.decode(ret, (bytes, address));
        return answer.length == 32 ? abi.decode(answer, (address)) : address(0);
    }

    /// @dev `resolve(name, text(node, key))`; empty when the name does not resolve.
    function resolveText(string memory fullName, string memory key) internal view returns (string memory) {
        bytes memory call = abi.encodeWithSignature("text(bytes32,string)", namehash(fullName), key);
        (bool ok, bytes memory ret) =
            address(universalResolver).staticcall(abi.encodeCall(IUniversalResolver.resolve, (dns(fullName), call)));
        if (!ok) return "";
        (bytes memory answer,) = abi.decode(ret, (bytes, address));
        return abi.decode(answer, (string));
    }

    /// @dev The resolver the Universal Resolver answered `name`'s address from, or zero if none did.
    function resolveResolver(string memory fullName) internal view returns (address) {
        bytes memory call = abi.encodeWithSignature("addr(bytes32)", namehash(fullName));
        (bool ok, bytes memory ret) =
            address(universalResolver).staticcall(abi.encodeCall(IUniversalResolver.resolve, (dns(fullName), call)));
        if (!ok) return address(0);
        (, address resolver) = abi.decode(ret, (bytes, address));
        return resolver;
    }

    /// @dev The Universal Resolver's revert for `name`'s address, or empty if it resolves.
    function resolveError(string memory fullName) internal view returns (bytes memory) {
        bytes memory call = abi.encodeWithSignature("addr(bytes32)", namehash(fullName));
        (bool ok, bytes memory ret) =
            address(universalResolver).staticcall(abi.encodeCall(IUniversalResolver.resolve, (dns(fullName), call)));
        return ok ? bytes("") : ret;
    }

    function resolverOf(string memory label) internal view returns (IPermissionedResolver) {
        return IPermissionedResolver(registry.getResolver(label));
    }
}
