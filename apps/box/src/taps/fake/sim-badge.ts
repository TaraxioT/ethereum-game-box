// A simulated HaLo badge: real secp256k1 keys (deterministic per name), answering the real APDUs the Box sends — the
// applet select, get_pkeys and key 2's sign_random with its counter, signed exactly as a chip signs, so the Pi's
// verifier checks it like any other. Key 1 signs nothing here, as on the Box.
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { ISO7816_SELECT_CMDS } from "@arx-research/libhalo/api/common";
import { randomDigest } from "../chip-ops.ts";
import { addressOf, type Address } from "../eth.ts";

const SW_OK = "9000";
/** What a HaLo answers to an applet ID it doesn't have, or to a command before its applet is selected. */
const SW_NO_APPLET = "6D00";
/** HaLo error replies (0xE1 + code, with SW 9000): libhalo turns them into HaloTagError. */
const ERR_UNKNOWN_CMD = "E101";
const ERR_INVALID_KEY = "E102";
const ERR_UNSUPPORTED = "E120";
const CMD_GET_PKEYS = 0x02;
const CMD_SIGN_RANDOM = 0x08;
const HALO_CLA_INS = "B0510000";

/** Which applet IDs the chip answers to (real batches differ). */
export type SimAid = "arx" | "legacy";

export class SimBadge {
  readonly name: string;
  /** 7 bytes, upper-case hex, as a HaLo's. */
  readonly uid: string;
  readonly aid: SimAid;
  private readonly keys: readonly [Uint8Array, Uint8Array];
  private selected = false;
  private counter = 0;

  constructor(name: string, aid: SimAid = "arx") {
    this.name = name;
    this.aid = aid;
    const seed = (what: string) => sha256(new TextEncoder().encode(`egb-sim-badge:${name}:${what}`));
    this.uid = `04${bytesToHex(seed("uid").subarray(0, 6))}`.toUpperCase();
    this.keys = [seed("key1"), seed("key2")];
  }

  /** Key 2's address: the badge's identity. */
  get identity(): Address {
    return addressOf(this.publicKey(2));
  }

  /** It landed on a reader (or the field cycled): a fresh chip has nothing selected. */
  powerUp(): void {
    this.selected = false;
  }

  /** One APDU (hex) to its answer, status word included (upper-case hex). */
  apdu(hex: string): string {
    const upper = hex.toUpperCase();
    const aid = ISO7816_SELECT_CMDS.findIndex((cmd) => upper.startsWith(cmd.toUpperCase()));
    if (aid >= 0) {
      this.selected = (aid === 0 ? "arx" : "legacy") === this.aid;
      return this.selected ? SW_OK : SW_NO_APPLET;
    }
    if (!upper.startsWith(HALO_CLA_INS) || !this.selected) return SW_NO_APPLET;
    const bytes = hexToBytes(upper.slice(HALO_CLA_INS.length));
    const command = bytes.subarray(1, 1 + bytes[0]!);
    return `${this.command(command)}${SW_OK}`;
  }

  /** The station's `reselect`: the chip re-activates and the station selects the applet; the select's status word. */
  reselect(): string {
    this.powerUp();
    return this.apdu(ISO7816_SELECT_CMDS[this.aid === "arx" ? 0 : 1]!);
  }

  private command(command: Uint8Array): string {
    switch (command[0]) {
      case CMD_GET_PKEYS: {
        const keys = [this.publicKey(1), this.publicKey(2)];
        return keys.map((k) => `${byte(k.length)}${bytesToHex(k)}`).join("").toUpperCase();
      }
      case CMD_SIGN_RANDOM: {
        const keyNo = command[1];
        if (keyNo !== 1 && keyNo !== 2) return ERR_INVALID_KEY;
        // Like a real chip: only a key that refuses raw digests can roll, so the wallet key refuses.
        if (keyNo === 1) return ERR_UNSUPPORTED;
        this.counter++;
        const payload = new Uint8Array(32);
        new DataView(payload.buffer).setUint32(0, this.counter);
        payload.set(randomBytes(28), 4);
        const sig = secp256k1.sign(randomDigest(keyNo, payload), this.keys[1], { prehash: false, format: "der" });
        return bytesToHex(new Uint8Array([...payload, ...sig, ...this.publicKey(2)])).toUpperCase();
      }
      default:
        return ERR_UNKNOWN_CMD;
    }
  }

  private publicKey(keyNo: 1 | 2): Uint8Array {
    return secp256k1.getPublicKey(this.keys[keyNo - 1]!, false);
  }
}

const byte = (n: number): string => n.toString(16).padStart(2, "0");
