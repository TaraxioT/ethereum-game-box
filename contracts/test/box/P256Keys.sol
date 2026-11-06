// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Vm} from "forge-std/Vm.sol";

import {P256} from "../../src/box/P256.sol";

/// @notice P-256 test keys, low-`s` signatures and WebAuthn assertions, from forge's cheatcodes.
abstract contract P256Keys {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice The order of P-256.
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    /// @notice The relying party a test passkey is bound to.
    string internal constant RP_ID = "gamebox-operator.pages.dev";
    /// @notice Authenticator flags: user present, user verified, backup eligible, backed up (a synced passkey).
    bytes1 internal constant FLAGS_UP_UV_BE_BS = 0x1d;

    /// @notice A WebAuthn assertion's parts, before it is signed.
    struct Assertion {
        string type_;
        bytes challenge;
        bytes1 flags;
    }

    function p256Key(string memory seed) internal pure returns (uint256) {
        return uint256(keccak256(bytes(seed))) % (P256_N - 1) + 1;
    }

    function p256Public(uint256 key) internal pure returns (bytes32 qx, bytes32 qy) {
        (uint256 x, uint256 y) = VM.publicKeyP256(key);
        return (bytes32(x), bytes32(y));
    }

    /// @dev Signs the raw digest (no prehash) and normalises `s` to the low half.
    function p256Sign(uint256 key, bytes32 digest) internal pure returns (bytes32 r, bytes32 s) {
        (r, s) = VM.signP256(key, digest);
        if (uint256(s) > P256.HALF_N) s = bytes32(P256_N - uint256(s));
    }

    /// @dev A passkey's assertion over `digest`: `"type":"webauthn.get"`, the digest as the challenge, user present and
    ///      verified, low `s`, encoded as `encodeWebAuthn`.
    function webAuthnSign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        return webAuthnSign(key, Assertion("webauthn.get", abi.encodePacked(digest), FLAGS_UP_UV_BE_BS));
    }

    /// @dev An assertion with any type, challenge and flags, for refusals.
    function webAuthnSign(uint256 key, Assertion memory a) internal pure returns (bytes memory) {
        return encodeWebAuthn(webAuthnAuth(key, a));
    }

    /// @dev The signature form `P256Account` takes: the struct's fields ABI-encoded in order, with no outer offset
    ///      (what OpenZeppelin's `WebAuthn.tryDecodeAuth` reads).
    function encodeWebAuthn(WebAuthn.WebAuthnAuth memory auth) internal pure returns (bytes memory) {
        return
            abi.encode(auth.r, auth.s, auth.challengeIndex, auth.typeIndex, auth.authenticatorData, auth.clientDataJSON);
    }

    function webAuthnAuth(uint256 key, Assertion memory a) internal pure returns (WebAuthn.WebAuthnAuth memory auth) {
        auth.authenticatorData = abi.encodePacked(sha256(bytes(RP_ID)), a.flags, uint32(0));
        auth.clientDataJSON = string.concat(
            '{"type":"',
            a.type_,
            '","challenge":"',
            Base64.encodeURL(a.challenge),
            '","origin":"https://',
            RP_ID,
            '","crossOrigin":false}'
        );
        auth.typeIndex = 1;
        auth.challengeIndex = bytes(string.concat('{"type":"', a.type_, '",')).length;
        (auth.r, auth.s) =
            p256Sign(key, sha256(abi.encodePacked(auth.authenticatorData, sha256(bytes(auth.clientDataJSON)))));
    }
}
