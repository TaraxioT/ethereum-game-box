// Every record key the Game Box names use, grouped by who may write it (Enhanced Access Control: each name has its
// own resolver, and each writer holds `SET_TEXT` on its own keys only).

/** ENSIP-9 coin type of the `addr` record (Ethereum). */
export const COIN_TYPE_ETH = 60n;

/** Box names (`<box>.gamebox.eth`). `addr` is the Box's `P256Account`. A pop-up (`popup-<x>.gamebox.eth`) is linked
 *  to its Box's record, so it has the same keys and values. */
export const BOX_KEYS = {
  /** Written by `GameBoxNames`. The Box's P-256 key, uncompressed: `0x04` + x + y (65 bytes, hex). */
  boxKey: 'boxKey',
  /** Written by `GameBoxNames`. One of `BOX_STATUS`. */
  status: 'status',
  /** Written by the operator. The operator's commission, in basis points, from `COMMISSION_MIN_BPS` to
   *  `COMMISSION_MAX_BPS`. */
  commission: 'commission',
  /** Written by the operator. Where the Box stands. */
  location: 'location',
  /** Written by the operator. */
  description: 'description',
  /** Written by the operator. Comma-separated game labels the Box offers. */
  games: 'games',
  /** Written by the Box. Unix seconds of its last heartbeat. */
  lastSeen: 'lastSeen',
  /** Written by the Box. The label of the game it is running now. */
  game: 'game',
} as const;

export const BOX_REGISTRAR_KEYS = [BOX_KEYS.boxKey, BOX_KEYS.status] as const;
export const BOX_OPERATOR_KEYS = [
  BOX_KEYS.commission,
  BOX_KEYS.location,
  BOX_KEYS.description,
  BOX_KEYS.games,
] as const;
/** The operator's commission bounds, in basis points of the Box's half: 10% to 90% (`plan/README.md`). */
export const COMMISSION_MIN_BPS = 1_000;
export const COMMISSION_MAX_BPS = 9_000;

export const BOX_DEVICE_KEYS = [BOX_KEYS.lastSeen, BOX_KEYS.game] as const;

/** The values of a Box's `status`. */
export const BOX_STATUS = ['active', 'suspended', 'revoked'] as const;
export type BoxStatus = (typeof BOX_STATUS)[number];

/** The default record on `gamebox.eth`'s own resolver, which every unregistered or expired `*.gamebox.eth` name
 *  resolves to (wildcard). It has no `addr`. Written by `gamebox.eth`'s owner. */
export const DEFAULT_KEYS = {
  /** Where the name can be claimed. */
  url: 'url',
  /** `This Game Box name is free.` */
  description: 'description',
} as const;

/** Player names (`<player>.gamebox.eth`). `addr` is the badge, which may write every key. */
export const PLAYER_KEYS = {
  /** Written by `PlayerStats` only, until the badge revokes it. JSON: `{"<game>":{"wins":n,"losses":n,"draws":n}}`. */
  stats: 'stats',
} as const;

/** Game names (`<game>.gamebox.eth`), written by `GameBoxNames`. */
export const GAME_KEYS = {
  /** The game's title name, `champion.<game>.gamebox.eth`. */
  title: 'title',
  /** How long the title lasts after the holder's last win, in seconds. */
  titleTerm: 'titleTerm',
} as const;

/** Titles (`champion.<game>.gamebox.eth`), written by `GameBoxNames` only. `addr` is the holder's badge. */
export const TITLE_KEYS = {
  /** The holder's player name, `<player>.gamebox.eth`. */
  holder: 'holder',
  /** Unix seconds when the holder's streak began. */
  start: 'start',
  /** The holder's consecutive wins. */
  streak: 'streak',
  /** The round of the holder's last win. */
  round: 'round',
} as const;

/** ENSIP-26 agent text records, used by `bot.gamebox.eth` and written by the agent itself. */
export const AGENT_KEYS = {
  /** What the agent is and how to reach it: plain text, Markdown, YAML or JSON. */
  context: 'agent-context',
} as const;

/** The ENSIP-26 protocols named with ERC-8004's services. */
export const AGENT_PROTOCOLS = ['mcp', 'a2a', 'web'] as const;
export type AgentProtocol = (typeof AGENT_PROTOCOLS)[number];

/** ENSIP-26 `agent-endpoint[<protocol>]`: a URL for that protocol. */
export function agentEndpointKey(protocol: AgentProtocol): `agent-endpoint[${AgentProtocol}]` {
  return `agent-endpoint[${protocol}]`;
}
