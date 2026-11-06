// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

import {IP256Account} from "../../src/box/IP256Account.sol";
import {P256Account} from "../../src/box/P256Account.sol";

import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {RegistryRoles, ResolverRoles} from "../../src/names/IENSv2.sol";
import {NamesFork} from "./NamesFork.sol";

/// @notice Writes `packages/shared/src/names/vectors.json`: the digests for fixed inputs, as the contracts compute
///         them, with an ECDSA signature of the claim, P-256 signatures (raw digest, low `s`) of the others, a passkey
///         (WebAuthn) signature of the `Execute`, and the role table. Every signature here is also run through the
///         contract that checks it. `vectors.test.ts` checks `messages.ts`, `webauthn.ts` and `roles.ts` against it
///         byte for byte.
contract VectorsTest is NamesFork {
    string internal constant PATH = "../packages/shared/src/names/vectors.json";

    /// @dev anvil's first well-known test key: a throwaway, never a real one.
    uint256 internal constant BADGE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant DEADLINE = 1_800_000_000;
    address internal constant TARGET = 0x3333333333333333333333333333333333333333;
    address internal constant WINNER = 0x2222222222222222222222222222222222222222;
    address internal constant LOSER = 0x4444444444444444444444444444444444444444;

    function test_writeVectors() public {
        uint256 p256Key_ = p256Key("egb-vector-box");
        (bytes32 qx, bytes32 qy) = p256Public(p256Key_);
        // The vector account: the factory's account for the vector key.
        P256Account vectorAccount = P256Account(payable(accounts.deploy(qx, qy)));

        string memory json = "vectors";
        vm.serializeString(json, "chainId", vm.toString(block.chainid));
        vm.serializeString(json, "claimName", _claim());
        vm.serializeString(json, "execute", _execute(vectorAccount, p256Key_));
        vm.serializeString(json, "batch", _batch(vectorAccount, p256Key_));
        vm.serializeString(json, "webAuthn", _webAuthn(vectorAccount, p256Key_));
        vm.serializeString(json, "result", _result(p256Key_));
        vm.serializeString(json, "primaryName", _primaryName());
        string memory p = "p256";
        vm.serializeString(p, "privateKey", vm.toString(bytes32(p256Key_)));
        vm.serializeString(p, "qx", vm.toString(qx));
        vm.serializeString(json, "p256", vm.serializeString(p, "qy", vm.toString(qy)));
        vm.serializeString(json, "registryRoles", _registryRoles());
        vm.writeJson(vm.serializeString(json, "resolverRoles", _resolverRoles()), PATH);
    }

    function _claim() internal returns (string memory) {
        address badge = vm.addr(BADGE_KEY);
        bytes32 digest = names.claimDigest("alice", badge, DEADLINE);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BADGE_KEY, digest);
        string memory o = "claim";
        vm.serializeString(o, "privateKey", vm.toString(bytes32(BADGE_KEY)));
        vm.serializeAddress(o, "gameBoxNames", address(names));
        vm.serializeString(o, "label", "alice");
        vm.serializeAddress(o, "badge", badge);
        vm.serializeString(o, "deadline", vm.toString(DEADLINE));
        vm.serializeBytes32(o, "digest", digest);
        return vm.serializeBytes(o, "signature", abi.encodePacked(r, s, v));
    }

    function _execute(P256Account account_, uint256 key) internal returns (string memory) {
        bytes memory data = hex"deadbeef";
        bytes32 digest = account_.executeDigest(TARGET, 5, data, 7, DEADLINE);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        string memory o = "execute";
        vm.serializeAddress(o, "factory", address(accounts));
        vm.serializeAddress(o, "account", address(account_));
        vm.serializeAddress(o, "target", TARGET);
        vm.serializeString(o, "value", "5");
        vm.serializeBytes(o, "data", data);
        vm.serializeString(o, "nonce", "7");
        vm.serializeString(o, "deadline", vm.toString(DEADLINE));
        vm.serializeBytes32(o, "digest", digest);
        vm.serializeBytes32(o, "r", r);
        vm.serializeBytes32(o, "s", s);
        assertEq(account_.isValidSignature(digest, abi.encodePacked(r, s)), account_.isValidSignature.selector);
        return vm.serializeBytes(o, "signature", abi.encodePacked(r, s));
    }

    function _vectorCalls() internal pure returns (IP256Account.Call[] memory calls) {
        calls = new IP256Account.Call[](2);
        calls[0] = IP256Account.Call(TARGET, 0, hex"deadbeef");
        calls[1] = IP256Account.Call(WINNER, 1, hex"");
    }

    function _batch(P256Account account_, uint256 key) internal returns (string memory) {
        IP256Account.Call[] memory calls = _vectorCalls();
        bytes32 digest = account_.batchDigest(calls, 8, DEADLINE);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        string memory o = "batch";
        vm.serializeAddress(o, "account", address(account_));
        vm.serializeAddress(o, "target0", calls[0].target);
        vm.serializeString(o, "value0", vm.toString(calls[0].value));
        vm.serializeBytes(o, "data0", calls[0].data);
        vm.serializeAddress(o, "target1", calls[1].target);
        vm.serializeString(o, "value1", vm.toString(calls[1].value));
        vm.serializeBytes(o, "data1", calls[1].data);
        vm.serializeString(o, "nonce", "8");
        vm.serializeString(o, "deadline", vm.toString(DEADLINE));
        vm.serializeBytes32(o, "dataHash", keccak256(abi.encode(calls)));
        vm.serializeBytes32(o, "digest", digest);
        assertEq(account_.isValidSignature(digest, abi.encodePacked(r, s)), account_.isValidSignature.selector);
        return vm.serializeBytes(o, "signature", abi.encodePacked(r, s));
    }

    /// @dev A passkey's signature of the `Execute` vector's digest, checked by the account itself.
    function _webAuthn(P256Account account_, uint256 key) internal returns (string memory) {
        bytes memory data = hex"deadbeef";
        bytes32 digest = account_.executeDigest(TARGET, 5, data, 7, DEADLINE);
        WebAuthn.WebAuthnAuth memory auth =
            webAuthnAuth(key, Assertion("webauthn.get", abi.encodePacked(digest), FLAGS_UP_UV_BE_BS));
        bytes memory signature = encodeWebAuthn(auth);
        vm.deal(address(account_), 5);
        vm.etch(TARGET, hex"00"); // a target that accepts the call, so the account runs it
        vm.warp(DEADLINE);
        account_.execute(TARGET, 5, data, 7, DEADLINE, signature);
        string memory o = "webAuthn";
        vm.serializeBytes32(o, "digest", digest);
        vm.serializeBytes(o, "authenticatorData", auth.authenticatorData);
        // As hex: forge would parse the JSON text into an object.
        vm.serializeBytes(o, "clientDataJSON", bytes(auth.clientDataJSON));
        vm.serializeUint(o, "challengeIndex", auth.challengeIndex);
        vm.serializeUint(o, "typeIndex", auth.typeIndex);
        vm.serializeBytes32(o, "r", auth.r);
        vm.serializeBytes32(o, "s", auth.s);
        return vm.serializeBytes(o, "signature", signature);
    }

    function _result(uint256 key) internal returns (string memory) {
        IBoxResults.Result memory res = IBoxResults.Result("mumbai-01", "quickdraw", 3, WINNER, LOSER, false, DEADLINE);
        bytes32 digest = results.resultDigest(res);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        string memory o = "result";
        vm.serializeAddress(o, "boxResults", address(results));
        vm.serializeString(o, "box", res.box);
        vm.serializeString(o, "game", res.game);
        vm.serializeString(o, "round", "3");
        vm.serializeAddress(o, "winner", WINNER);
        vm.serializeAddress(o, "loser", LOSER);
        vm.serializeBool(o, "draw", false);
        vm.serializeString(o, "deadline", vm.toString(DEADLINE));
        vm.serializeBytes32(o, "digest", digest);
        vm.serializeBytes32(o, "r", r);
        return vm.serializeBytes32(o, "s", s);
    }

    /// @dev The badge's `default.reverse` message for its primary name, as ENS's `DefaultReverseRegistrar` hashes it.
    function _primaryName() internal returns (string memory) {
        address registrar =
            vm.parseJsonAddress(vm.readFile("../deployments/sepolia.json"), ".ens.DefaultReverseRegistrar.address");
        address badge = vm.addr(BADGE_KEY);
        string memory name = "alice.gamebox.eth";
        bytes32 message = keccak256(
            abi.encodePacked(
                registrar,
                bytes4(keccak256("setNameForAddrWithSignature(address,uint256,string,bytes)")),
                badge,
                DEADLINE,
                name
            )
        );
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(message);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BADGE_KEY, digest);
        string memory o = "primaryName";
        vm.serializeAddress(o, "registrar", registrar);
        vm.serializeAddress(o, "badge", badge);
        vm.serializeString(o, "name", name);
        vm.serializeString(o, "expiry", vm.toString(DEADLINE));
        vm.serializeBytes32(o, "message", message);
        vm.serializeBytes32(o, "digest", digest);
        return vm.serializeBytes(o, "signature", abi.encodePacked(r, s, v));
    }

    function _role(string memory o, string memory name, uint256 bit) internal returns (string memory) {
        return vm.serializeString(o, name, vm.toString(bytes32(bit)));
    }

    function _registryRoles() internal returns (string memory o) {
        o = "registryRoles";
        _role(o, "REGISTRAR", RegistryRoles.REGISTRAR);
        _role(o, "REGISTRAR_ADMIN", RegistryRoles.REGISTRAR_ADMIN);
        _role(o, "REGISTER_RESERVED", RegistryRoles.REGISTER_RESERVED);
        _role(o, "REGISTER_RESERVED_ADMIN", RegistryRoles.REGISTER_RESERVED_ADMIN);
        _role(o, "SET_PARENT", RegistryRoles.SET_PARENT);
        _role(o, "SET_PARENT_ADMIN", RegistryRoles.SET_PARENT_ADMIN);
        _role(o, "UNREGISTER", RegistryRoles.UNREGISTER);
        _role(o, "UNREGISTER_ADMIN", RegistryRoles.UNREGISTER_ADMIN);
        _role(o, "RENEW", RegistryRoles.RENEW);
        _role(o, "RENEW_ADMIN", RegistryRoles.RENEW_ADMIN);
        _role(o, "SET_SUBREGISTRY", RegistryRoles.SET_SUBREGISTRY);
        _role(o, "SET_SUBREGISTRY_ADMIN", RegistryRoles.SET_SUBREGISTRY_ADMIN);
        _role(o, "SET_RESOLVER", RegistryRoles.SET_RESOLVER);
        _role(o, "SET_RESOLVER_ADMIN", RegistryRoles.SET_RESOLVER_ADMIN);
        _role(o, "CAN_TRANSFER_ADMIN", RegistryRoles.CAN_TRANSFER_ADMIN);
        _role(o, "SET_URI", RegistryRoles.SET_URI);
        _role(o, "SET_URI_ADMIN", RegistryRoles.SET_URI_ADMIN);
        _role(o, "CAN_NAME", RegistryRoles.CAN_NAME);
        _role(o, "CAN_NAME_ADMIN", RegistryRoles.CAN_NAME_ADMIN);
        _role(o, "UPGRADE", RegistryRoles.UPGRADE);
        return _role(o, "UPGRADE_ADMIN", RegistryRoles.UPGRADE_ADMIN);
    }

    function _resolverRoles() internal returns (string memory o) {
        o = "resolverRoles";
        _role(o, "SET_ADDRESS", ResolverRoles.SET_ADDRESS);
        _role(o, "SET_ADDRESS_ADMIN", ResolverRoles.SET_ADDRESS_ADMIN);
        _role(o, "SET_TEXT", ResolverRoles.SET_TEXT);
        _role(o, "SET_TEXT_ADMIN", ResolverRoles.SET_TEXT_ADMIN);
        _role(o, "SET_CONTENTHASH", ResolverRoles.SET_CONTENTHASH);
        _role(o, "SET_CONTENTHASH_ADMIN", ResolverRoles.SET_CONTENTHASH_ADMIN);
        _role(o, "SET_ABI", ResolverRoles.SET_ABI);
        _role(o, "SET_ABI_ADMIN", ResolverRoles.SET_ABI_ADMIN);
        _role(o, "SET_INTERFACE", ResolverRoles.SET_INTERFACE);
        _role(o, "SET_INTERFACE_ADMIN", ResolverRoles.SET_INTERFACE_ADMIN);
        _role(o, "SET_NAME", ResolverRoles.SET_NAME);
        _role(o, "SET_NAME_ADMIN", ResolverRoles.SET_NAME_ADMIN);
        _role(o, "SET_DATA", ResolverRoles.SET_DATA);
        _role(o, "SET_DATA_ADMIN", ResolverRoles.SET_DATA_ADMIN);
        _role(o, "LINK", ResolverRoles.LINK);
        _role(o, "LINK_ADMIN", ResolverRoles.LINK_ADMIN);
        _role(o, "CAN_NAME", ResolverRoles.CAN_NAME);
        _role(o, "CAN_NAME_ADMIN", ResolverRoles.CAN_NAME_ADMIN);
        _role(o, "UPGRADE", ResolverRoles.UPGRADE);
        return _role(o, "UPGRADE_ADMIN", ResolverRoles.UPGRADE_ADMIN);
    }
}
