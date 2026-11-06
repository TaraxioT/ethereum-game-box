// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

import {IBoxSigned} from "./IBoxSigned.sol";
import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title IBoxSeats
/// @notice Box-vouched player names. A HaLo badge can't sign a `ClaimName` (it signs only `sign_random`), so the Box
///         it tapped vouches for it: the Box signs `Seat` with its P-256 key, and this contract, which holds
///         `GameBoxNames`' `SEATER_ROLE`, calls `claimPlayerFor`. The name is exactly what `claimPlayer` gives: the
///         same label rule, one name per badge, the badge holding every role on its own resolver, and `PlayerStats`
///         holding `stats` alone.
/// @dev The signed message is EIP-712 `Seat(string label,address badge,string box,uint256 deadline)`, domain
///      `Game Box Seats`, version `1`, chain id and this contract, signed by a live, `Active` Box's P-256 key over the
///      raw digest, low `s`. A seat can't be replayed: the badge then holds a name (`BadgeHasName`). Anyone may submit
///      a signed seat; the relayer does.
interface IBoxSeats is IBoxSigned, IERC5267 {
    /// @notice What a Box signs to give a badge that tapped it a player name.
    /// @param label The player's label.
    /// @param badge The badge (its key-2 address, as the Box's roster has it).
    /// @param box The Box's label.
    /// @param deadline The last timestamp the seat may be claimed at.
    struct Seat {
        string label;
        address badge;
        string box;
        uint256 deadline;
    }

    /// @notice A Box gave a badge its player name.
    event Seated(string box, string label, address indexed badge, address resolver);

    /// @notice Checks a Box-signed seat and claims `<label>.gamebox.eth` for the badge (`claimPlayerFor`).
    /// @param seat The seat.
    /// @param r The P-256 signature's `r`.
    /// @param s The P-256 signature's `s` (low).
    /// @return resolver The name's new resolver.
    function claim(Seat calldata seat, bytes32 r, bytes32 s) external returns (address resolver);

    /// @notice The EIP-712 digest a Box signs for `seat`.
    function seatDigest(Seat calldata seat) external view returns (bytes32);

    /// @notice The EIP-712 type hash of `Seat`.
    function SEAT_TYPEHASH() external view returns (bytes32);
    /// @notice The registrar this contract claims through and reads Boxes from.
    function NAMES() external view returns (IGameBoxNames);
}
