// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

import {IBoxSigned} from "../names/IBoxSigned.sol";
import {IGameBoxNames} from "../names/IGameBoxNames.sol";
import {IFakeUSDC} from "../token/IFakeUSDC.sol";

/// @title IStorePot
/// @notice The pot of one store game's match: 2 to 4 players stake the same `amount` of Store USDC. The Box vouches for
///         them with a signed `Stake`, and `open` pulls each stake (as the token's game spender, so the badges sign
///         nothing). A key with `VERIFIER_ROLE` ends the match: `settle` pays any split that adds up to exactly the pot,
///         and `voidPot` sends each stake back. If it never answers, anyone can `refund` an hour after the pot opened.
/// @dev The verifier is trusted to judge, and this contract limits what a wrong verdict can do: a verdict names players
///      only by position, so it can't pay anyone else, and it must pay out exactly what the pot took. No names, titles
///      or stats are touched, and there is no fee.
///
///      The signed messages are EIP-712, domain `Game Box Store Pots`, version `1`, chain id and this contract:
///      - `Stake(string box,bytes32 bundle,uint256 round,address[] players,uint256 amount,uint256 deadline)`, with the
///        Box's P-256 key (`GameBoxNames.boxKey`) over the raw digest, low `s`.
///      - `Verdict(string box,uint256 round,uint256[] payouts,bytes32 record,uint256 deadline)` and
///        `Void(string box,uint256 round,bytes32 record,uint256 deadline)`, with an ECDSA key, low `s`, 65 bytes.
///      Anyone may submit a signed message; the relayer does. A pot's `(box, round)` is never used twice, so a used
///      `Verdict` or `Void` can't replay.
interface IStorePot is IBoxSigned, IERC5267, IAccessControl {
    /// @notice What a Box signs to open a pot.
    /// @param box The Box's label (`mumbai-01`).
    /// @param bundle The game: its bundle's sha256, which must be listed.
    /// @param round The Box's round number.
    /// @param players Each player's badge, in seat order: 2 to 4, no repeats.
    /// @param amount Each player's stake, in USDC base units (6 decimals).
    /// @param deadline The last timestamp the stake may be opened at.
    struct Stake {
        string box;
        bytes32 bundle;
        uint256 round;
        address[] players;
        uint256 amount;
        uint256 deadline;
    }

    /// @notice What a verifier signs to pay a pot.
    /// @param box The Box's label.
    /// @param round The round.
    /// @param payouts What each of the pot's players gets, in their order. Zero is allowed.
    /// @param record The keccak256 of the audit record's exact JSON text.
    /// @param deadline The last timestamp the verdict may be used at.
    struct Verdict {
        string box;
        uint256 round;
        uint256[] payouts;
        bytes32 record;
        uint256 deadline;
    }

    /// @notice What a verifier signs to send every stake back.
    /// @param box The Box's label.
    /// @param round The round.
    /// @param record The keccak256 of the audit record's exact JSON text.
    /// @param deadline The last timestamp it may be used at.
    struct Void {
        string box;
        uint256 round;
        bytes32 record;
        uint256 deadline;
    }

    /// @notice A pot's state. `None` means `(box, round)` never had a pot.
    enum State {
        None,
        Open,
        Settled,
        Voided,
        Refunded
    }

    /// @notice A pot.
    /// @param players Each player's badge, in seat order.
    /// @param amount Each player's stake; the pot holds `amount * players.length` while open.
    /// @param opened When it opened (unix seconds).
    /// @param state Its state.
    /// @param bundle The game's bundle hash.
    /// @param record The audit record's hash, once settled or voided.
    struct Pot {
        address[] players;
        uint256 amount;
        uint64 opened;
        State state;
        bytes32 bundle;
        bytes32 record;
    }

    /// @notice A bundle may now be staked.
    event BundleListed(bytes32 indexed bundle);
    /// @notice A pot opened: `amount` was pulled from each player.
    event PotOpened(string box, bytes32 indexed bundle, uint256 indexed round, address[] players, uint256 amount);
    /// @notice A verdict paid `payouts[i]` to the pot's `players[i]`.
    event PotSettled(string box, uint256 indexed round, uint256[] payouts, bytes32 record);
    /// @notice A verifier sent each stake back: every player got `amount`.
    event PotVoided(string box, uint256 indexed round, uint256 amount, bytes32 record);
    /// @notice An unsettled pot was refunded after the delay: every player got `amount`.
    event PotRefunded(string box, uint256 indexed round, uint256 amount);

    /// @notice The bundle isn't listed.
    error NotListed(bytes32 bundle);
    /// @notice Fewer than 2 or more than 4 players.
    error PlayerCount(uint256 count);
    /// @notice A badge is in the stake twice.
    error RepeatedPlayer(address player);
    /// @notice This contract is named as a player: its stake would be other pots' money.
    error PotIsPlayer();
    /// @notice A stake of zero.
    error ZeroAmount();
    /// @notice `(box, round)` already had a pot.
    error PotExists(string box, uint256 round);
    /// @notice `(box, round)` has no open pot.
    error PotNotOpen(string box, uint256 round);
    /// @notice A verdict with a different number of payouts than the pot has players.
    error PayoutCount(uint256 players, uint256 payouts);
    /// @notice A verdict's payouts don't add up to exactly the pot.
    error PayoutSum(uint256 pot, uint256 sum);
    /// @notice The signer of a `Verdict` or `Void` doesn't hold `VERIFIER_ROLE`.
    error NotVerifier(address signer);
    /// @notice A refund before `opened + REFUND_DELAY`.
    error TooEarly(uint256 refundableAt);

    /// @notice Lets a bundle be staked. There is no way back: a listed hash stays listed. Needs `LISTER_ROLE`.
    /// @param bundle The bundle's sha256.
    function list(bytes32 bundle) external;

    /// @notice Checks a Box-signed stake and opens its pot: pulls `amount` from each player. It refuses an expired
    ///         deadline, an unknown, expired or not `Active` Box, a bad signature, an unlisted bundle, fewer than 2 or
    ///         more than 4 players, a repeated player, this contract as a player, a zero amount and a `(box, round)`
    ///         that had a pot before. A player without the balance makes it revert.
    /// @param stake The stake.
    /// @param r The P-256 signature's `r`.
    /// @param s The P-256 signature's `s` (low).
    function open(Stake calldata stake, bytes32 r, bytes32 s) external;

    /// @notice Pays an open pot: `payouts[i]` to its `players[i]`. The signer must hold `VERIFIER_ROLE` now, and there
    ///         must be one payout per player, adding up to exactly the pot. It still works after `REFUND_DELAY`, until
    ///         someone refunds.
    /// @param verdict The verdict.
    /// @param signature The ECDSA signature, `r ‖ s ‖ v`, low `s`.
    function settle(Verdict calldata verdict, bytes calldata signature) external;

    /// @notice Sends each stake of an open pot back at once, to the address it came from. The signer must hold
    ///         `VERIFIER_ROLE` now.
    /// @param voiding The void.
    /// @param signature The ECDSA signature, `r ‖ s ‖ v`, low `s`.
    function voidPot(Void calldata voiding, bytes calldata signature) external;

    /// @notice Sends each stake of an open pot back. Open to anyone from `opened + REFUND_DELAY`.
    /// @param box The Box's label.
    /// @param round The round.
    function refund(string calldata box, uint256 round) external;

    /// @notice The pot of `(box, round)`; `state` is `None` if it never had one.
    function getPot(string calldata box, uint256 round) external view returns (Pot memory);

    /// @notice Whether `bundle` may be staked.
    function listed(bytes32 bundle) external view returns (bool);

    /// @notice The EIP-712 digest a Box signs for `stake`.
    function stakeDigest(Stake calldata stake) external view returns (bytes32);

    /// @notice The EIP-712 digest a verifier signs for `verdict`.
    function verdictDigest(Verdict calldata verdict) external view returns (bytes32);

    /// @notice The EIP-712 digest a verifier signs for `voiding`.
    function voidDigest(Void calldata voiding) external view returns (bytes32);

    /// @notice The EIP-712 type hash of `Stake`.
    function STAKE_TYPEHASH() external view returns (bytes32);
    /// @notice The EIP-712 type hash of `Verdict`.
    function VERDICT_TYPEHASH() external view returns (bytes32);
    /// @notice The EIP-712 type hash of `Void`.
    function VOID_TYPEHASH() external view returns (bytes32);
    /// @notice The role that lists bundles.
    function LISTER_ROLE() external view returns (bytes32);
    /// @notice The role a `Verdict` or `Void` signer must hold.
    function VERIFIER_ROLE() external view returns (bytes32);
    /// @notice The fewest players a pot takes: 2.
    function MIN_PLAYERS() external view returns (uint256);
    /// @notice The most players a pot takes: 4.
    function MAX_PLAYERS() external view returns (uint256);
    /// @notice How long after `open` anyone may refund an open pot: one hour.
    function REFUND_DELAY() external view returns (uint64);
    /// @notice The registrar Boxes are read from.
    function NAMES() external view returns (IGameBoxNames);
    /// @notice The stake token, Store USDC.
    function USDC() external view returns (IFakeUSDC);
}
