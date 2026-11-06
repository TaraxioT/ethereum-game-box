// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Test} from "forge-std/Test.sol";

import {IP256Account} from "../../src/box/IP256Account.sol";
import {IP256AccountFactory} from "../../src/box/IP256AccountFactory.sol";
import {P256Account} from "../../src/box/P256Account.sol";
import {P256AccountFactory} from "../../src/box/P256AccountFactory.sol";
import {P256Keys} from "./P256Keys.sol";

contract Target {
    error Refused(string why);

    uint256 public calls;
    address public lastCaller;

    function ping(uint256 n) external payable returns (uint256) {
        ++calls;
        lastCaller = msg.sender;
        return n * 2;
    }

    function refuse() external pure {
        revert Refused("no");
    }

    function refuseWithString() external pure {
        revert("plain reason");
    }
}

contract P256AccountTest is Test, P256Keys {
    uint256 internal key = p256Key("egb-test-p256-account");
    P256AccountFactory internal factory = new P256AccountFactory();
    P256Account internal account;
    Target internal target = new Target();

    function setUp() public {
        (bytes32 qx, bytes32 qy) = p256Public(key);
        account = P256Account(payable(factory.deploy(qx, qy)));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------------------------

    function _raw(uint256 k, bytes32 digest) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s) = p256Sign(k, digest);
        return abi.encodePacked(r, s);
    }

    function _digest(bytes memory data, uint256 nonce, uint256 deadline) internal view returns (bytes32) {
        return account.executeDigest(address(target), 0, data, nonce, deadline);
    }

    function _ping(uint256 n) internal pure returns (bytes memory) {
        return abi.encodeCall(Target.ping, (n));
    }

    /// @dev A raw-signed `execute` of `data` on the target.
    function _execute(bytes memory data, uint256 nonce) internal returns (bytes memory) {
        uint256 deadline = block.timestamp + 60;
        return account.execute(address(target), 0, data, nonce, deadline, _raw(key, _digest(data, nonce, deadline)));
    }

    function _assertion(bytes32 digest) internal pure returns (Assertion memory) {
        return Assertion("webauthn.get", abi.encodePacked(digest), FLAGS_UP_UV_BE_BS);
    }

    function _calls() internal view returns (IP256Account.Call[] memory calls) {
        calls = new IP256Account.Call[](2);
        calls[0] = IP256Account.Call(address(target), 0, _ping(1));
        calls[1] = IP256Account.Call(address(target), 0, _ping(2));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // execute
    // ---------------------------------------------------------------------------------------------------------------

    function test_executeRunsWithARawSignature() public {
        bytes memory data = _ping(21);
        vm.expectEmit(address(account));
        emit IP256Account.Executed(7, address(target), 0, keccak256(data));
        vm.prank(makeAddr("egb-test-relayer"));
        bytes memory out = _execute(data, 7);
        assertEq(abi.decode(out, (uint256)), 42);
        assertEq(target.calls(), 1);
        assertEq(target.lastCaller(), address(account));
        assertTrue(account.nonceUsed(7));
    }

    function test_executeRunsWithAPasskey() public {
        bytes memory data = _ping(21);
        uint256 deadline = block.timestamp + 60;
        bytes memory signature = webAuthnSign(key, _digest(data, 1, deadline));
        bytes memory out = account.execute(address(target), 0, data, 1, deadline, signature);
        assertEq(abi.decode(out, (uint256)), 42);
        assertTrue(account.nonceUsed(1));
    }

    function test_executeSendsValue() public {
        vm.deal(address(account), 1 ether);
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        bytes32 digest = account.executeDigest(address(target), 0.25 ether, data, 1, deadline);
        account.execute(address(target), 0.25 ether, data, 1, deadline, _raw(key, digest));
        assertEq(address(target).balance, 0.25 ether);
    }

    function test_noncesWorkInAnyOrder() public {
        _execute(_ping(1), 9);
        _execute(_ping(1), 3);
        assertEq(target.calls(), 2);
    }

    function test_replayFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        bytes memory raw = _raw(key, _digest(data, 1, deadline));
        account.execute(address(target), 0, data, 1, deadline, raw);
        vm.expectRevert(abi.encodeWithSelector(IP256Account.NonceUsed.selector, 1));
        account.execute(address(target), 0, data, 1, deadline, raw);

        bytes memory passkey = webAuthnSign(key, _digest(data, 2, deadline));
        account.execute(address(target), 0, data, 2, deadline, passkey);
        vm.expectRevert(abi.encodeWithSelector(IP256Account.NonceUsed.selector, 2));
        account.execute(address(target), 0, data, 2, deadline, passkey);
    }

    function test_expiredDeadlineFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        bytes memory raw = _raw(key, _digest(data, 1, deadline));
        bytes memory passkey = webAuthnSign(key, _digest(data, 1, deadline));
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IP256Account.DeadlineExpired.selector, deadline));
        account.execute(address(target), 0, data, 1, deadline, raw);
        vm.expectRevert(abi.encodeWithSelector(IP256Account.DeadlineExpired.selector, deadline));
        account.execute(address(target), 0, data, 1, deadline, passkey);
    }

    function test_deadlineItselfWorks() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        bytes memory raw = _raw(key, _digest(data, 1, deadline));
        vm.warp(deadline);
        account.execute(address(target), 0, data, 1, deadline, raw);
    }

    function test_targetRevertBubbles() public {
        uint256 deadline = block.timestamp + 60;
        bytes memory data = abi.encodeCall(Target.refuse, ());
        bytes memory sig = _raw(key, _digest(data, 1, deadline));
        vm.expectRevert(abi.encodeWithSelector(Target.Refused.selector, "no"));
        account.execute(address(target), 0, data, 1, deadline, sig);

        data = abi.encodeCall(Target.refuseWithString, ());
        sig = _raw(key, _digest(data, 2, deadline));
        vm.expectRevert(bytes("plain reason"));
        account.execute(address(target), 0, data, 2, deadline, sig);
        assertFalse(account.nonceUsed(1));
    }

    function test_highSFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) = p256Sign(key, _digest(data, 1, deadline));
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, abi.encodePacked(r, P256_N - uint256(s)));

        WebAuthn.WebAuthnAuth memory auth = webAuthnAuth(key, _assertion(_digest(data, 1, deadline)));
        auth.s = bytes32(P256_N - uint256(auth.s));
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, encodeWebAuthn(auth));
    }

    function test_wrongKeyFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        uint256 other = p256Key("egb-test-not-the-key");
        bytes32 digest = _digest(data, 1, deadline);
        bytes memory raw = _raw(other, digest);
        bytes memory passkey = webAuthnSign(other, digest);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, raw);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, passkey);
    }

    function test_changedCallFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        bytes memory raw = _raw(key, _digest(data, 1, deadline));
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, _ping(2), 1, deadline, raw);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 2, deadline, raw);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline + 1, raw);
    }

    function test_malformedSignaturesFail() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        bytes memory raw = _raw(key, _digest(data, 1, deadline));
        bytes[3] memory bad = [bytes(""), abi.encodePacked(raw, uint8(27)), new bytes(0xc0)];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(IP256Account.InvalidSignature.selector);
            account.execute(address(target), 0, data, 1, deadline, bad[i]);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // WebAuthn refusals
    // ---------------------------------------------------------------------------------------------------------------

    function test_passkeyWithTheWrongChallengeFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        // Signed for nonce 2, submitted as nonce 1.
        bytes memory signature = webAuthnSign(key, _assertion(_digest(data, 2, deadline)));
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, signature);
    }

    function test_passkeyWithTheWrongTypeFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        Assertion memory a = _assertion(_digest(data, 1, deadline));
        a.type_ = "webauthn.create";
        bytes memory signature = webAuthnSign(key, a);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, signature);
    }

    function test_passkeyWithoutUserVerificationFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        Assertion memory a = _assertion(_digest(data, 1, deadline));
        a.flags = 0x19; // user present, backed up, but not verified
        bytes memory signature = webAuthnSign(key, a);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, signature);
    }

    function test_passkeyWithoutUserPresenceFails() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        Assertion memory a = _assertion(_digest(data, 1, deadline));
        a.flags = 0x1c; // verified, but not present
        bytes memory signature = webAuthnSign(key, a);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, signature);
    }

    function test_passkeyOnADeviceBoundKeyWorks() public {
        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        Assertion memory a = _assertion(_digest(data, 1, deadline));
        a.flags = 0x05; // present and verified, not backup eligible (a security key)
        account.execute(address(target), 0, data, 1, deadline, webAuthnSign(key, a));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // executeBatch
    // ---------------------------------------------------------------------------------------------------------------

    function test_executeBatchRunsEveryCall() public {
        IP256Account.Call[] memory calls = _calls();
        uint256 deadline = block.timestamp + 60;
        bytes32 digest = account.batchDigest(calls, 5, deadline);
        assertEq(digest, account.executeDigest(address(account), 0, abi.encode(calls), 5, deadline));
        vm.expectEmit(address(account));
        emit IP256Account.ExecutedBatch(5, keccak256(abi.encode(calls)));
        bytes[] memory out = account.executeBatch(calls, 5, deadline, webAuthnSign(key, digest));
        assertEq(abi.decode(out[0], (uint256)), 2);
        assertEq(abi.decode(out[1], (uint256)), 4);
        assertEq(target.calls(), 2);
        assertTrue(account.nonceUsed(5));
    }

    function test_executeBatchIsAllOrNothing() public {
        IP256Account.Call[] memory calls = _calls();
        calls[1].data = abi.encodeCall(Target.refuse, ());
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _raw(key, account.batchDigest(calls, 5, deadline));
        vm.expectRevert(abi.encodeWithSelector(Target.Refused.selector, "no"));
        account.executeBatch(calls, 5, deadline, sig);
        assertEq(target.calls(), 0);
        assertFalse(account.nonceUsed(5));
    }

    function test_executeBatchRefusals() public {
        IP256Account.Call[] memory calls = _calls();
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _raw(key, account.batchDigest(calls, 5, deadline));
        calls[1].data = _ping(3);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.executeBatch(calls, 5, deadline, sig);

        calls = _calls();
        account.executeBatch(calls, 5, deadline, sig);
        vm.expectRevert(abi.encodeWithSelector(IP256Account.NonceUsed.selector, 5));
        account.executeBatch(calls, 5, deadline, sig);

        sig = _raw(key, account.batchDigest(calls, 6, deadline));
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IP256Account.DeadlineExpired.selector, deadline));
        account.executeBatch(calls, 6, deadline, sig);
    }

    /// @dev A batch's signature, submitted as a single call to the account with the encoded list as its calldata,
    ///      matches no function and reverts.
    function test_aBatchSignatureNeverRunsAsACall() public {
        IP256Account.Call[] memory calls = _calls();
        uint256 deadline = block.timestamp + 60;
        bytes memory encoded = abi.encode(calls);
        bytes memory sig = _raw(key, account.batchDigest(calls, 5, deadline));
        vm.expectRevert();
        account.execute(address(account), 0, encoded, 5, deadline, sig);
        assertFalse(account.nonceUsed(5));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // rotateKey
    // ---------------------------------------------------------------------------------------------------------------

    /// @dev Signs, with the current `key`, a call that moves the account to `next`.
    function _rotate(uint256 next) internal {
        (bytes32 nx, bytes32 ny) = p256Public(next);
        bytes memory rotate = abi.encodeCall(IP256Account.rotateKey, (nx, ny));
        uint256 deadline = block.timestamp + 60;
        bytes32 digest = account.executeDigest(address(account), 0, rotate, 1, deadline);
        vm.expectEmit(address(account));
        emit IP256Account.KeyRotated(nx, ny);
        account.execute(address(account), 0, rotate, 1, deadline, webAuthnSign(key, digest));
        (bytes32 qx, bytes32 qy) = account.publicKey();
        assertEq(qx, nx);
        assertEq(qy, ny);
    }

    function test_rotateKeyCutsTheOldKeyOff() public {
        uint256 next = p256Key("egb-test-p256-account-next");
        _rotate(next);

        bytes memory data = _ping(1);
        uint256 deadline = block.timestamp + 60;
        bytes32 digest = _digest(data, 2, deadline);
        bytes memory raw = _raw(key, digest);
        bytes memory passkey = webAuthnSign(key, digest);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 2, deadline, raw);
        vm.expectRevert(IP256Account.InvalidSignature.selector);
        account.execute(address(target), 0, data, 2, deadline, passkey);
        bytes32 hash = keccak256("egb-test-message");
        assertEq(account.isValidSignature(hash, _raw(key, hash)), bytes4(0xffffffff));

        account.execute(address(target), 0, data, 2, deadline, _raw(next, digest));
        assertEq(account.isValidSignature(hash, _raw(next, hash)), IERC1271.isValidSignature.selector);
    }

    /// @dev The account keeps its address; the factory still maps the original key to it.
    function test_aRotatedAccountKeepsItsAddress() public {
        address before = address(account);
        _rotate(p256Key("egb-test-p256-account-next"));
        (bytes32 ox, bytes32 oy) = p256Public(key);
        assertEq(factory.accountOf(ox, oy), before);
    }

    function test_onlyTheAccountRotatesItsKey() public {
        vm.expectRevert(IP256Account.OnlySelf.selector);
        account.rotateKey(bytes32(uint256(1)), bytes32(uint256(2)));

        bytes memory rotate = abi.encodeCall(IP256Account.rotateKey, (bytes32(0), bytes32(uint256(2))));
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _raw(key, account.executeDigest(address(account), 0, rotate, 1, deadline));
        vm.expectRevert(IP256Account.ZeroKey.selector);
        account.execute(address(account), 0, rotate, 1, deadline, sig);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // ERC-1271 and ERC-1155
    // ---------------------------------------------------------------------------------------------------------------

    function test_isValidSignatureTakesARawSignature() public view {
        bytes32 hash = keccak256("egb-test-message");
        assertEq(account.isValidSignature(hash, _raw(key, hash)), IERC1271.isValidSignature.selector);
        assertEq(account.isValidSignature(hash, _raw(p256Key("egb-test-other"), hash)), bytes4(0xffffffff));
        assertEq(account.isValidSignature(keccak256("other"), _raw(key, hash)), bytes4(0xffffffff));
        (bytes32 r, bytes32 s) = p256Sign(key, hash);
        assertEq(account.isValidSignature(hash, abi.encodePacked(r, P256_N - uint256(s))), bytes4(0xffffffff));
        assertEq(account.isValidSignature(hash, webAuthnSign(key, hash)), bytes4(0xffffffff));
        assertEq(account.isValidSignature(hash, ""), bytes4(0xffffffff));
    }

    function test_receivesERC1155() public {
        assertTrue(account.supportsInterface(type(IERC1155Receiver).interfaceId));
        assertEq(
            account.onERC1155Received(address(this), address(this), 1, 1, ""),
            IERC1155Receiver.onERC1155Received.selector
        );
    }

    function test_domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = account.eip712Domain();
        assertEq(name, "Game Box");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(account));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // P256AccountFactory
    // ---------------------------------------------------------------------------------------------------------------

    function test_factoryDeploysAtTheAddressOfTheKey() public {
        uint256 other = p256Key("egb-test-factory");
        (bytes32 qx, bytes32 qy) = p256Public(other);
        address predicted = factory.accountOf(qx, qy);
        assertEq(predicted.code.length, 0);
        vm.expectEmit(address(factory));
        emit IP256AccountFactory.AccountDeployed(predicted, qx, qy);
        vm.prank(makeAddr("egb-test-anyone"));
        assertEq(factory.deploy(qx, qy), predicted);
        (bytes32 ax, bytes32 ay) = P256Account(payable(predicted)).publicKey();
        assertEq(ax, qx);
        assertEq(ay, qy);
        // Again: no revert, same account.
        assertEq(factory.deploy(qx, qy), predicted);
        // Another key, another account.
        (bytes32 kx, bytes32 ky) = p256Public(key);
        assertEq(factory.accountOf(kx, ky), address(account));
        assertTrue(factory.accountOf(kx, ky) != predicted);
    }

    function test_factoryRefusesAZeroKey() public {
        vm.expectRevert();
        factory.deploy(bytes32(0), bytes32(uint256(1)));
    }
}
