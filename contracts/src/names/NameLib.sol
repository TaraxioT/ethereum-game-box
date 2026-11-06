// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title NameLib
/// @notice The label rule and the names under `gamebox.eth`, shared by the names contracts. The same rule is
///         `labelProblem` in `packages/shared/src/names/labels.ts`.
library NameLib {
    /// @notice `gamebox.eth`, DNS-encoded (with the terminating zero).
    bytes internal constant PARENT_DNS = hex"0767616d65626f780365746800";
    /// @notice The label of every game's title: `champion.<game>.gamebox.eth`.
    string internal constant TITLE_LABEL = "champion";
    uint256 internal constant MIN_LENGTH = 3;
    uint256 internal constant MAX_LENGTH = 32;

    /// @notice Whether `label` is 3 to 32 of `a-z`, `0-9` and `-`, with no hyphen at either end.
    function isValidLabel(string memory label) internal pure returns (bool) {
        bytes memory b = bytes(label);
        uint256 n = b.length;
        if (n < MIN_LENGTH || n > MAX_LENGTH || b[0] == "-" || b[n - 1] == "-") return false;
        for (uint256 i; i < n; ++i) {
            bytes1 c = b[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-")) return false;
        }
        return true;
    }

    /// @notice `<label>.gamebox.eth`, DNS-encoded, as the resolver setters take it.
    function dnsName(string memory label) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(label).length), label, PARENT_DNS);
    }

    /// @notice `champion.<game>.gamebox.eth`, DNS-encoded.
    function dnsTitleName(string memory game) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(TITLE_LABEL).length), TITLE_LABEL, dnsName(game));
    }

    /// @notice `<label>.gamebox.eth`.
    function fullName(string memory label) internal pure returns (string memory) {
        return string.concat(label, ".gamebox.eth");
    }

    /// @notice The namehash of `<label>.gamebox.eth`, the node a resolver keys its records by.
    function node(string memory label) internal pure returns (bytes32) {
        bytes32 eth = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        bytes32 gamebox = keccak256(abi.encodePacked(eth, keccak256("gamebox")));
        return keccak256(abi.encodePacked(gamebox, keccak256(bytes(label))));
    }

    /// @notice The labelhash, which a registry takes as `anyId`.
    function id(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }
}
