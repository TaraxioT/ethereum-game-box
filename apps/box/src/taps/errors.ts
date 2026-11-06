// The ways a chip request fails, as types the tap machine can tell apart.

/**
 * - `transport`: the radio or the RF field failed mid-exchange (err 2, no reply, a bad status word); worth a reselect.
 * - `no-chip`: nothing answered (err 1, or err 3: an APDU with no chip on the reader).
 * - `reader-dead`: the station's PN532 isn't answering (err 4).
 * - `bad-request`: the receiver or station refused the request itself (err 5, `bad request`).
 * - `link`: the station isn't linked (`no such station linked`).
 * - `closed`: the receiver's port closed.
 */
export type NfcErrorKind = "transport" | "no-chip" | "reader-dead" | "bad-request" | "link" | "closed";

export class NfcError extends Error {
  readonly kind: NfcErrorKind;

  constructor(kind: NfcErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** A card answered, but it isn't a HaLo (no ISO-DEP, or neither applet ID selects). */
export class NotHaloError extends Error {}

/** A chip's answer failed its check (a roll signed by another key, a malformed reply). */
export class VerifyError extends Error {}
