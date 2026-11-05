// What the hostile game aims at. The sandbox test writes this file again in its own copy of the game, with paths in
// a temp folder and the ports of its canary listeners.
export interface Targets {
  /** A file outside the bundle. */
  readonly secret: string;
  /** The folder it is in. */
  readonly dir: string;
  /** Where a write would land. */
  readonly written: string;
  /** Where a database would be made. */
  readonly sqlite: string;
  /** A TCP listener on 127.0.0.1 that counts connections. */
  readonly port: number;
  /** A UDP socket on 127.0.0.1 that counts datagrams. */
  readonly udpPort: number;
}

export const TARGETS: Targets = { secret: "", dir: "", written: "", sqlite: "", port: 0, udpPort: 0 };
