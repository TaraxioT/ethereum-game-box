// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {BoxCheck} from "./BoxCheck.sol";
import {IBoxSeats} from "./IBoxSeats.sol";
import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title BoxSeats
/// @notice Player names for badges a live Box vouched for with its P-256 key (see `IBoxSeats`).
contract BoxSeats is IBoxSeats, EIP712 {
    /// @inheritdoc IBoxSeats
    bytes32 public constant SEAT_TYPEHASH = keccak256("Seat(string label,address badge,string box,uint256 deadline)");

    /// @inheritdoc IBoxSeats
    IGameBoxNames public immutable NAMES;

    /// @param names The registrar; this contract needs its `SEATER_ROLE`.
    constructor(IGameBoxNames names) EIP712("Game Box Seats", "1") {
        NAMES = names;
    }

    /// @inheritdoc IBoxSeats
    function claim(Seat calldata seat, bytes32 r, bytes32 s) external returns (address resolver) {
        BoxCheck.before(seat.deadline);
        (bytes32 qx, bytes32 qy) = BoxCheck.liveKey(NAMES, seat.box);
        BoxCheck.verify(seatDigest(seat), r, s, qx, qy);
        resolver = NAMES.claimPlayerFor(seat.label, seat.badge);
        emit Seated(seat.box, seat.label, seat.badge, resolver);
    }

    /// @inheritdoc IBoxSeats
    function seatDigest(Seat calldata seat) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SEAT_TYPEHASH, keccak256(bytes(seat.label)), seat.badge, keccak256(bytes(seat.box)), seat.deadline
                )
            )
        );
    }
}
