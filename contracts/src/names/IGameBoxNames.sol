// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

import {IPermissionedRegistry} from "./IENSv2.sol";

/// @title IGameBoxNames
/// @notice The registrar of `gamebox.eth`. It holds `REGISTRAR | RENEW | SET_PARENT` on the root of `gamebox.eth`'s
///         own `UserRegistry` and nothing else, so that registry is emancipated. It registers:
///         - Box names (`<box>.gamebox.eth`), which expire with the Box's licence. Each gets its own
///           `PermissionedResolver`. `GameBoxNames` writes `boxKey` and `status`, the operator writes `commission`,
///           `location`, `description` and `games`, and the Box writes `lastSeen` and `game`.
///         - Player names (`<player>.gamebox.eth`), which never expire. Each gets its own resolver, on which the badge
///           holds every role and `PlayerStats` holds `SET_TEXT` on `stats` alone. `GameBoxNames` holds nothing on it.
///         - Game names (`<game>.gamebox.eth`), each with its own title registry holding the soulbound title
///           `champion.<game>.gamebox.eth`.
/// @dev Roles (OpenZeppelin `AccessControl`): `DEFAULT_ADMIN_ROLE` adds games and sets the stats writer,
///      `LICENSOR_ROLE` issues and manages Box licences, `REFEREE_ROLE` crowns champions (and is the role
///      `PlayerStats` takes results from). The badge's consent to a name is EIP-712
///      `ClaimName(string label,address badge,uint256 deadline)`, domain `Game Box Names`, version `1`.
interface IGameBoxNames is IAccessControl, IERC5267 {
    /// @notice A Box's standing. `None` means the label was never a Box.
    enum BoxStatus {
        None,
        Active,
        Suspended,
        Revoked
    }

    /// @notice A Box licence.
    /// @param operator Owns the Box's name and writes its four operator keys.
    /// @param account The Box's `BoxAccount`: the name's `addr`, and the writer of `lastSeen` and `game`.
    /// @param qx The x coordinate of the Box's P-256 key.
    /// @param qy The y coordinate of the Box's P-256 key.
    /// @param status The Box's standing.
    /// @param resolver The name's own `PermissionedResolver`.
    /// @param expiry When the licence (and the name) lapses, read from the registry.
    struct Box {
        address operator;
        address account;
        bytes32 qx;
        bytes32 qy;
        BoxStatus status;
        address resolver;
        uint64 expiry;
    }

    /// @notice A game and its title.
    /// @param titleRegistry The game's own registry, which holds `champion`.
    /// @param titleTerm How long a title lasts after the holder's last win, in seconds.
    struct Game {
        address titleRegistry;
        uint64 titleTerm;
    }

    /// @notice A game's champion title, `champion.<game>.gamebox.eth`.
    /// @param holder The champion's badge, or zero if the title was never won.
    /// @param start When the current holder's streak began.
    /// @param streak The holder's consecutive wins.
    /// @param round The round of the holder's last win.
    /// @param expiry When the title lapses (`term` after the last win). After that the next winner takes it.
    struct Title {
        address holder;
        uint64 start;
        uint64 streak;
        uint256 round;
        uint64 expiry;
    }

    /// @notice A Box licence was issued (or issued again after it lapsed), with a fresh resolver.
    event BoxRegistered(
        string label,
        address indexed operator,
        address indexed account,
        address resolver,
        bytes32 qx,
        bytes32 qy,
        uint64 expiry
    );
    /// @notice A Box licence's expiry moved.
    event BoxRenewed(string label, uint64 expiry);
    /// @notice A Box's standing changed.
    event BoxStatusChanged(string label, BoxStatus status);
    /// @notice A Box's account and P-256 key changed.
    event BoxKeyChanged(string label, address indexed account, bytes32 qx, bytes32 qy);
    /// @notice A badge claimed a player name.
    event PlayerClaimed(string label, address indexed badge, address resolver);
    /// @notice A game was added with its title registry.
    event GameAdded(string label, address titleRegistry, uint64 titleTerm);
    /// @notice A champion won: crowned, kept the title (a higher `streak`), or took it from `previous`.
    event Crowned(
        string game, address indexed winner, address indexed previous, uint256 round, uint64 streak, uint64 expiry
    );
    /// @notice The `stats` writer that new player resolvers trust changed.
    event StatsWriterSet(address stats);

    /// @notice The label breaks the rule: 3 to 32 of `a-z`, `0-9` and `-`, no hyphen at either end.
    error InvalidLabel(string label);
    /// @notice The claim's deadline has passed.
    error DeadlineExpired(uint256 deadline);
    /// @notice The claim was not signed by the badge (neither ECDSA nor ERC-1271).
    error InvalidClaimSignature();
    /// @notice The badge already holds a player name.
    error BadgeHasName(address badge, string label);
    /// @notice No Box was ever registered under the label.
    error UnknownBox(string label);
    /// @notice The account holds no player name.
    error NotAPlayer(address account);
    /// @notice No game is registered under the label.
    error UnknownGame(string label);
    /// @notice The game already exists.
    error GameExists(string label);
    /// @notice `None` is not a status a Box can be set to.
    error InvalidStatus();
    /// @notice A required address or value is zero.
    error ZeroValue();
    /// @notice No `stats` writer has been set, so no player resolver can be made.
    error StatsWriterNotSet();

    /// @notice The licensor role: issues and manages Box licences.
    function LICENSOR_ROLE() external view returns (bytes32);
    /// @notice The referee role: crowns champions and records results.
    function REFEREE_ROLE() external view returns (bytes32);
    /// @notice The EIP-712 type hash of `ClaimName`.
    function CLAIM_TYPEHASH() external view returns (bytes32);
    /// @notice `gamebox.eth`'s own registry, created by the constructor.
    function REGISTRY() external view returns (IPermissionedRegistry);
    /// @notice The resolver of every champion title, created by the constructor. Only `GameBoxNames` writes it.
    function TITLE_RESOLVER() external view returns (address);
    /// @notice The resolver of every game name, created by the constructor. Only `GameBoxNames` writes it. It is
    ///         separate from `TITLE_RESOLVER`, so a lapsed title has no records to fall back to.
    function GAME_RESOLVER() external view returns (address);

    /// @notice Issues a Box licence: registers `<label>.gamebox.eth` to `operator` until `expiry`, with a new
    ///         resolver. `GameBoxNames` writes `addr` (the Box account), `boxKey` and `status` (`active`), and grants
    ///         the operator's four keys to `operator` and `lastSeen` and `game` to `account`. The token is
    ///         non-transferable, and the operator can't re-point its resolver or subregistry. Works again on a label
    ///         whose licence has lapsed. Needs `LICENSOR_ROLE`.
    /// @param label The Box's label.
    /// @param operator The operator.
    /// @param account The Box's `BoxAccount`.
    /// @param qx The x coordinate of the Box's P-256 key.
    /// @param qy The y coordinate of the Box's P-256 key.
    /// @param expiry When the licence lapses.
    /// @return resolver The name's new resolver.
    function registerBox(
        string calldata label,
        address operator,
        address account,
        bytes32 qx,
        bytes32 qy,
        uint64 expiry
    ) external returns (address resolver);

    /// @notice Moves a Box licence's expiry later. Also revives a lapsed licence nobody has registered again.
    ///         Needs `LICENSOR_ROLE`.
    /// @param label The Box's label.
    /// @param expiry The new expiry. Never earlier than the current one.
    function renewBox(string calldata label, uint64 expiry) external;

    /// @notice Sets a Box's standing and writes it to `status`. A Box that is not `Active` is refused as a
    ///         referee, but its name still resolves. Needs `LICENSOR_ROLE`.
    /// @param label The Box's label.
    /// @param status `Active`, `Suspended` or `Revoked`.
    function setBoxStatus(string calldata label, BoxStatus status) external;

    /// @notice Moves a Box to a new account and P-256 key: rewrites `addr` and `boxKey`, and moves `lastSeen` and
    ///         `game` from the old account to the new one. Needs `LICENSOR_ROLE`.
    /// @param label The Box's label.
    /// @param account The new `BoxAccount`.
    /// @param qx The x coordinate of the new key.
    /// @param qy The y coordinate of the new key.
    function setBoxKey(string calldata label, address account, bytes32 qx, bytes32 qy) external;

    /// @notice A Box's P-256 key.
    /// @param label The Box's label.
    /// @return qx The x coordinate.
    /// @return qy The y coordinate.
    function boxKey(string calldata label) external view returns (bytes32 qx, bytes32 qy);

    /// @notice A Box's licence. `status` is `None` for a label that was never a Box.
    /// @param label The Box's label.
    /// @return The licence, with its expiry read from the registry.
    function getBox(string calldata label) external view returns (Box memory);

    /// @notice Registers `<label>.gamebox.eth` to `badge` forever, with its own resolver: `addr` is the badge, the
    ///         badge holds every role, and `PlayerStats` holds `SET_TEXT` on `stats` alone. `GameBoxNames` holds no
    ///         role on the name or the resolver afterwards. Open to anyone; the badge's consent is its signature.
    /// @param label The player's label.
    /// @param badge The badge (any wallet that signs EIP-712).
    /// @param deadline The last timestamp the claim may run at.
    /// @param signature The badge's `ClaimName` signature: ECDSA, or ERC-1271 for a contract wallet.
    /// @return resolver The name's resolver.
    function claimPlayer(string calldata label, address badge, uint256 deadline, bytes calldata signature)
        external
        returns (address resolver);

    /// @notice The EIP-712 digest a badge signs to claim `label`.
    /// @param label The player's label.
    /// @param badge The badge.
    /// @param deadline The deadline.
    /// @return The digest.
    function claimDigest(string calldata label, address badge, uint256 deadline) external view returns (bytes32);

    /// @notice The label of the player name `badge` holds, or empty if it holds none (never claimed, or moved
    ///         away).
    /// @param badge The badge.
    /// @return The label.
    function labelOf(address badge) external view returns (string memory);

    /// @notice The full player name `badge` holds (`<label>.gamebox.eth`), or empty.
    /// @param badge The badge.
    /// @return The name.
    function nameOf(address badge) external view returns (string memory);

    /// @notice Adds `<label>.gamebox.eth`, its title registry, and its title term. Needs `DEFAULT_ADMIN_ROLE`.
    /// @param label The game's label.
    /// @param titleTerm How long the title lasts after the holder's last win, in seconds.
    /// @return titleRegistry The game's title registry.
    function addGame(string calldata label, uint64 titleTerm) external returns (address titleRegistry);

    /// @notice A game. `titleRegistry` is zero for an unknown game.
    /// @param label The game's label.
    /// @return The game.
    function getGame(string calldata label) external view returns (Game memory);

    /// @notice Gives `champion.<game>.gamebox.eth` to `winner`. The holder's win extends the streak and the term.
    ///         Anyone else's win, or a win after the title lapsed, moves the title: the old token is unregistered and
    ///         a new one is registered to the winner, non-transferable. Needs `REFEREE_ROLE`.
    /// @param game The game's label.
    /// @param winner The winner's badge. It must hold a player name.
    /// @param round The round that was won.
    function crown(string calldata game, address winner, uint256 round) external;

    /// @notice A game's title.
    /// @param game The game's label.
    /// @return The title.
    function getTitle(string calldata game) external view returns (Title memory);

    /// @notice Sets the `stats` writer that new player resolvers grant `SET_TEXT` on `stats` to. Existing names keep
    ///         theirs. Needs `DEFAULT_ADMIN_ROLE`.
    /// @param stats The `PlayerStats` contract.
    function setStatsWriter(address stats) external;

    /// @notice The `stats` writer new player resolvers trust.
    function statsWriter() external view returns (address);
}
