// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {NameLib} from "../../src/names/NameLib.sol";

contract NameLibTest is Test {
    function test_validLabels() public pure {
        assertTrue(NameLib.isValidLabel("abc"));
        assertTrue(NameLib.isValidLabel("mumbai-01"));
        assertTrue(NameLib.isValidLabel("a-b"));
        assertTrue(NameLib.isValidLabel("0x0"));
        assertTrue(NameLib.isValidLabel("abcdefghijklmnopqrstuvwxyz012345"));
    }

    function test_invalidLabels() public pure {
        assertFalse(NameLib.isValidLabel(""));
        assertFalse(NameLib.isValidLabel("ab"));
        assertFalse(NameLib.isValidLabel("abcdefghijklmnopqrstuvwxyz0123456"));
        assertFalse(NameLib.isValidLabel("-abc"));
        assertFalse(NameLib.isValidLabel("abc-"));
        assertFalse(NameLib.isValidLabel("Abc"));
        assertFalse(NameLib.isValidLabel("a.c"));
        assertFalse(NameLib.isValidLabel("a_c"));
        assertFalse(NameLib.isValidLabel("a c"));
        assertFalse(NameLib.isValidLabel(unicode"åbc"));
    }

    /// @dev The rule, written the slow way, as `labelProblem` in packages/shared states it.
    function _reference(bytes memory b) internal pure returns (bool) {
        if (b.length < 3 || b.length > 32) return false;
        bytes memory allowed = "abcdefghijklmnopqrstuvwxyz0123456789-";
        for (uint256 i; i < b.length; ++i) {
            bool found;
            for (uint256 j; j < allowed.length; ++j) {
                if (b[i] == allowed[j]) found = true;
            }
            if (!found) return false;
        }
        return b[0] != "-" && b[b.length - 1] != "-";
    }

    function testFuzz_matchesTheRule(bytes memory raw) public pure {
        assertEq(NameLib.isValidLabel(string(raw)), _reference(raw));
    }

    /// @dev Fuzz over the label alphabet too, where random bytes rarely land.
    function testFuzz_matchesTheRuleOnTheAlphabet(uint8 length, uint256 seed) public pure {
        bytes memory alphabet = "abcz09-A._";
        bytes memory b = new bytes(bound(length, 0, 34));
        for (uint256 i; i < b.length; ++i) {
            b[i] = alphabet[uint256(keccak256(abi.encode(seed, i))) % alphabet.length];
        }
        assertEq(NameLib.isValidLabel(string(b)), _reference(b));
    }

    function test_names() public pure {
        assertEq(NameLib.dnsName("alice"), hex"05616c6963650767616d65626f780365746800");
        assertEq(
            NameLib.dnsTitleName("quickdraw"),
            bytes.concat(hex"08", "champion", hex"09", "quickdraw", NameLib.PARENT_DNS)
        );
        assertEq(NameLib.fullName("alice"), "alice.gamebox.eth");
        assertEq(NameLib.id("alice"), uint256(keccak256("alice")));
    }
}
