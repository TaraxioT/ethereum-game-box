// libhalo over the receiver: an `exec` for execHaloCmd (@arx-research/libhalo/api/custom) whose transport is the
// station's reader, through `nfc <st> <id> apdu|sign <hex>` lines. libhalo builds each command and parses the answer;
// this selects the HaLo applet once per tap, wraps each command in its APDU, and recovers from a radio or RF error by
// re-activating the chip and trying again while it is still on the reader.
import { ISO7816_SELECT_CMDS } from "@arx-research/libhalo/api/common";
import { checkErrors, execHaloCmd } from "@arx-research/libhalo/api/custom";
import type { Clock } from "../core/ports.ts";
import { NfcError, NotHaloError } from "./errors.ts";
import type { StationId } from "./lines.ts";
import type { Nfc } from "./nfc.ts";

/** A libhalo command (`{ name: "get_pkeys" }`, `{ name: "sign_random", keyNo: 2 }`) and its parsed answer. */
export type HaloExec = (command: { readonly name: string; readonly [arg: string]: unknown }) => Promise<unknown>;

/**
 * The libhalo commands that make the chip sign. They go out as `sign`, so the station shows HOLD STILL while the chip
 * works (700–900 ms for sign_random) and reports `signed` after.
 */
const SIGNING: ReadonlySet<string> = new Set(["sign", "sign_random", "sign_challenge"]);
/** Tries of a command after the first, each after re-activating the chip. */
const RETRIES = 3;
/** A reselect keeps trying this long for the chip to answer again. */
export const RESELECT_MS = 3000;
const RESELECT_PAUSE_MS = 100;
/** ISO-DEP (ISO 14443-4) in the SAK: every HaLo has it; a card without it can't be one. */
const SAK_ISO_DEP = 0x20;

/**
 * Which applet ID each chip answered last. Chips come in batches, and an ID the chip doesn't answer (status 6D00)
 * costs a whole APDU (~50 ms), so each chip's own ID goes first, and an unseen chip tries the last one that worked.
 */
export class AidMemory {
  private readonly byUid = new Map<string, number>();
  private last = 0;

  order(uid: string): number[] {
    const first = this.byUid.get(uid) ?? this.last;
    return ISO7816_SELECT_CMDS.map((_, k) => (first + k) % ISO7816_SELECT_CMDS.length);
  }

  answered(uid: string, index: number): void {
    this.byUid.set(uid, index);
    this.last = index;
  }
}

/** The chip one tap talks to. */
export interface ChipTarget {
  readonly st: StationId;
  readonly uid: string;
  readonly sak: string;
  /** The station selected the HaLo applet when it found the chip (the tap's `sel` was 9000). */
  readonly selected: boolean;
  /** Still on the reader: no `gone` line, and no newer tap on the station. */
  present(): boolean;
  /** Waits out a dropped link; rejects when its grace runs out. */
  whenUp(): Promise<void>;
}

export class ChipSession {
  private readonly nfc: Nfc;
  private readonly aids: AidMemory;
  private readonly target: ChipTarget;
  private readonly clock: Clock;
  private selected: boolean;

  constructor(nfc: Nfc, aids: AidMemory, target: ChipTarget, clock: Clock) {
    this.nfc = nfc;
    this.aids = aids;
    this.target = target;
    this.clock = clock;
    this.selected = target.selected;
  }

  /** Runs one libhalo command on the chip, re-activating it after a radio or RF error (up to RETRIES times). */
  readonly exec: HaloExec = async (command) => {
    const sign = SIGNING.has(command.name);
    const options = { method: "pcsc" as const, exec: (bytes: Buffer) => this.transmit(bytes, sign) };
    for (let attempt = 0; ; attempt++) {
      try {
        await this.select();
        return (await execHaloCmd(command, options)) as unknown;
      } catch (e) {
        if (attempt >= RETRIES) throw e;
        await this.recover(e);
      }
    }
  };

  /**
   * Selects the HaLo applet, unless the station already did. One try, no recovery: after a tap that needed nothing
   * from the chip this is what lets the station's presence check (an ISO-DEP R(NAK), which a HaLo only answers once
   * it has exchanged a block) see the chip stay, instead of a new tap every ~200 ms.
   */
  async select(): Promise<void> {
    if (this.selected) return;
    const { st, uid, sak } = this.target;
    if ((parseInt(sak, 16) & SAK_ISO_DEP) === 0) throw new NotHaloError("not an ISO-DEP card, so not a HaLo");
    for (const i of this.aids.order(uid)) {
      const reply = await this.nfc.request(st, { op: "apdu", hex: ISO7816_SELECT_CMDS[i]! });
      if (reply.hex.endsWith("9000")) {
        this.selected = true;
        this.aids.answered(uid, i);
        return;
      }
    }
    throw new NotHaloError("the card answers neither HaLo applet ID");
  }

  /** One HaLo command in its APDU (CLA B0, INS 51), and its answer without the status word. */
  private async transmit(bytes: Buffer, sign: boolean): Promise<{ result: string; extra: Record<string, string> }> {
    const hex = `B0510000${byte(bytes.length)}${bytes.toString("hex")}00`;
    const reply = await this.nfc.request(this.target.st, { op: sign ? "sign" : "apdu", hex });
    const sw = reply.hex.slice(-4);
    if (sw !== "9000" && sw !== "9100") {
      // A chip that lost power for a moment answers 6D00: the applet has to be selected again.
      this.selected = false;
      throw new NfcError("transport", `the chip answered SW ${sw || "(none)"}`);
    }
    const data = Buffer.from(reply.hex.slice(0, -4), "hex");
    checkErrors(data);
    return { result: data.toString("hex"), extra: {} };
  }

  /** Gets the chip ready for another try, or throws when there's no point (lifted, not a HaLo, a dead reader). */
  private async recover(e: unknown): Promise<void> {
    if (!(e instanceof NfcError)) throw e;
    if (e.kind === "link") return this.target.whenUp();
    if (e.kind !== "transport" && e.kind !== "no-chip") throw e;
    await this.reselect(e);
  }

  /** `reselect` until the chip answers (RESELECT_MS at most), as long as it's still on the reader. */
  private async reselect(cause: NfcError): Promise<void> {
    const { st, uid } = this.target;
    const deadline = this.clock.now() + RESELECT_MS;
    for (;;) {
      if (!this.target.present()) throw cause;
      try {
        const reply = await this.nfc.request(st, { op: "reselect" });
        if (reply.tags.some((t) => t.uid.toUpperCase() === uid)) {
          this.selected = reply.sel === "9000";
          return;
        }
        if (reply.tags.length > 0) throw new NfcError("no-chip", "another chip is on the reader");
      } catch (e) {
        if (!(e instanceof NfcError)) throw e;
        if (e.kind === "link") {
          await this.target.whenUp();
          continue;
        }
        if (e.kind !== "transport" && e.kind !== "no-chip") throw e;
      }
      if (this.clock.now() >= deadline) throw cause;
      await new Promise<void>((resolve) => this.clock.after(RESELECT_PAUSE_MS, resolve));
    }
  }
}

const byte = (n: number): string => n.toString(16).toUpperCase().padStart(2, "0");
