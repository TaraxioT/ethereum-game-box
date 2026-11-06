// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {BoxAccount} from "../../src/box/BoxAccount.sol";
import {IBoxAccount} from "../../src/box/IBoxAccount.sol";
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

contract BoxAccountTest is Test, P256Keys {
    uint256 internal key = p256Key("egb-test-box-account");
    BoxAccount internal account;
    Target internal target = new Target();

    function setUp() public {
        (bytes32 qx, bytes32 qy) = p256Public(key);
        account = new BoxAccount(qx, qy);
    }

    function _signed(address to, uint256 value, bytes memory data, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32 r, bytes32 s)
    {
        return p256Sign(key, account.executeDigest(to, value, data, nonce, deadline));
    }

    function _execute(address to, uint256 value, bytes memory data, uint256 nonce) internal returns (bytes memory) {
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) = _signed(to, value, data, nonce, deadline);
        return account.execute(to, value, data, nonce, deadline, r, s);
    }

    function test_executeRuns() public {
        bytes memory data = abi.encodeCall(Target.ping, (21));
        vm.expectEmit(address(account));
        emit IBoxAccount.Executed(7, address(target), 0, keccak256(data));
        vm.prank(makeAddr("egb-test-relayer"));
        bytes memory out = _execute(address(target), 0, data, 7);
        assertEq(abi.decode(out, (uint256)), 42);
        assertEq(target.calls(), 1);
        assertEq(target.lastCaller(), address(account));
        assertTrue(account.nonceUsed(7));
    }

    function test_executeSendsValue() public {
        vm.deal(address(account), 1 ether);
        _execute(address(target), 0.25 ether, abi.encodeCall(Target.ping, (1)), 1);
        assertEq(address(target).balance, 0.25 ether);
    }

    function test_noncesWorkInAnyOrder() public {
        _execute(address(target), 0, abi.encodeCall(Target.ping, (1)), 9);
        _execute(address(target), 0, abi.encodeCall(Target.ping, (1)), 3);
        assertEq(target.calls(), 2);
    }

    function test_replayedNonceFails() public {
        bytes memory data = abi.encodeCall(Target.ping, (1));
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) = _signed(address(target), 0, data, 1, deadline);
        account.execute(address(target), 0, data, 1, deadline, r, s);
        vm.expectRevert(abi.encodeWithSelector(IBoxAccount.NonceUsed.selector, 1));
        account.execute(address(target), 0, data, 1, deadline, r, s);
    }

    function test_expiredDeadlineFails() public {
        bytes memory data = abi.encodeCall(Target.ping, (1));
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) = _signed(address(target), 0, data, 1, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IBoxAccount.DeadlineExpired.selector, deadline));
        account.execute(address(target), 0, data, 1, deadline, r, s);
    }

    function test_deadlineItselfWorks() public {
        bytes memory data = abi.encodeCall(Target.ping, (1));
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) = _signed(address(target), 0, data, 1, deadline);
        vm.warp(deadline);
        account.execute(address(target), 0, data, 1, deadline, r, s);
    }

    function test_targetRevertBubbles() public {
        uint256 deadline = block.timestamp + 60;
        bytes memory data = abi.encodeCall(Target.refuse, ());
        (bytes32 r, bytes32 s) = _signed(address(target), 0, data, 1, deadline);
        vm.expectRevert(abi.encodeWithSelector(Target.Refused.selector, "no"));
        account.execute(address(target), 0, data, 1, deadline, r, s);

        data = abi.encodeCall(Target.refuseWithString, ());
        (r, s) = _signed(address(target), 0, data, 2, deadline);
        vm.expectRevert(bytes("plain reason"));
        account.execute(address(target), 0, data, 2, deadline, r, s);
        assertFalse(account.nonceUsed(1));
    }

    function test_highSFails() public {
        bytes memory data = abi.encodeCall(Target.ping, (1));
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) = _signed(address(target), 0, data, 1, deadline);
        vm.expectRevert(IBoxAccount.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, r, bytes32(P256_N - uint256(s)));
    }

    function test_wrongKeyFails() public {
        bytes memory data = abi.encodeCall(Target.ping, (1));
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) =
            p256Sign(p256Key("egb-test-not-the-box"), account.executeDigest(address(target), 0, data, 1, deadline));
        vm.expectRevert(IBoxAccount.InvalidSignature.selector);
        account.execute(address(target), 0, data, 1, deadline, r, s);
    }

    function test_changedCallFails() public {
        bytes memory data = abi.encodeCall(Target.ping, (1));
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) = _signed(address(target), 0, data, 1, deadline);
        vm.expectRevert(IBoxAccount.InvalidSignature.selector);
        account.execute(address(target), 0, abi.encodeCall(Target.ping, (2)), 1, deadline, r, s);
    }

    function test_selfCallFails() public {
        bytes memory data = abi.encodeCall(Target.ping, (1));
        uint256 deadline = block.timestamp + 60;
        (bytes32 r, bytes32 s) = _signed(address(account), 0, data, 1, deadline);
        vm.expectRevert(IBoxAccount.SelfCall.selector);
        account.execute(address(account), 0, data, 1, deadline, r, s);
    }

    function test_publicKeyAndDomain() public view {
        (bytes32 qx, bytes32 qy) = p256Public(key);
        (bytes32 ax, bytes32 ay) = account.publicKey();
        assertEq(ax, qx);
        assertEq(ay, qy);
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = account.eip712Domain();
        assertEq(name, "Game Box");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(account));
    }
}
