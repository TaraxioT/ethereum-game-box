// The receiver's serial lines, as types: firmware/tap-station/protocol.md is the spec, and its example lines are the
// parser's test vectors.

/** A station: the last three bytes of its MAC, lower-case hex (`e4ba70`). */
export type StationId = string;

export interface TagLine {
  readonly uid: string;
  readonly atqa: string;
  readonly sak: string;
  readonly ats: string;
}

/** Receiver → Pi. `at_us` is the receiver's micros() (wraps at 2^32). */
export type ReceiverEvent =
  | { readonly ev: "ready"; readonly mac: string; readonly fw: string }
  | {
      readonly ev: "state";
      readonly stations: readonly {
        readonly st: StationId;
        readonly up: boolean;
        readonly nfc: boolean;
        readonly uid: string | null;
        readonly rssi: number;
      }[];
    }
  | { readonly ev: "link"; readonly st: StationId; readonly up: boolean }
  | {
      readonly ev: "ping";
      readonly st: StationId;
      readonly rtt_us: number;
      readonly rssi: number;
      readonly nfc: boolean;
      readonly s3_led: number;
      readonly c3_led: number;
    }
  | { readonly ev: "nfc"; readonly st: StationId; readonly ok: boolean }
  | { readonly ev: "bad"; readonly why: string; readonly line: string }
  | (TagLine & {
      readonly ev: "tap";
      readonly st: StationId;
      readonly id: number;
      readonly read_us: number;
      readonly gap_us: number;
      /** The HaLo applet select's answer, when the station selected it on detection. */
      readonly sel?: string;
      readonly sel_us?: number;
      readonly tries: number;
      readonly at_us: number;
    })
  | { readonly ev: "gone"; readonly st: StationId; readonly id: number; readonly uid: string; readonly at_us: number }
  | {
      readonly ev: "signed";
      readonly st: StationId;
      readonly id: number;
      readonly tap: number;
      readonly uid: string;
      readonly ok: boolean;
      readonly chip_us: number;
      readonly total_us: number;
      readonly at_us: number;
    }
  | { readonly ev: "buzz_ok"; readonly st: StationId; readonly id: number; readonly tries: number; readonly rtt_us: number }
  | { readonly ev: "buzz_fail"; readonly st: StationId | "all"; readonly id: number; readonly why: string }
  | { readonly ev: "screen_ok"; readonly st: StationId; readonly id: number; readonly tries: number; readonly rtt_us: number }
  | { readonly ev: "screen_fail"; readonly st: StationId; readonly id: number; readonly why: string }
  | {
      readonly ev: "nfc_res";
      readonly st: StationId;
      readonly id: number;
      readonly op: NfcOp;
      readonly ok: boolean;
      /** 0 ok; 1 no chip answered; 2 RF error; 3 APDU with no chip; 4 PN532 not answering; 5 bad request. */
      readonly err: number;
      readonly pn532?: number;
      readonly hex?: string;
      readonly tags?: readonly TagLine[];
      readonly sel?: string;
      readonly us: number;
      readonly wait_us: number;
      readonly rtt_us: number;
      readonly tries: number;
    }
  | { readonly ev: "nfc_fail"; readonly st: StationId; readonly id: number; readonly why: string }
  | { readonly ev: "c3_press"; readonly id: number; readonly at_us: number }
  | {
      readonly ev: "c3_ack";
      readonly st: StationId;
      readonly id: number;
      readonly rtt_us: number;
      readonly tries: number;
      readonly s3_led: number;
    }
  | { readonly ev: "c3_fail"; readonly id: number; readonly tries: number }
  | {
      readonly ev: "s3_press";
      readonly st: StationId;
      readonly id: number;
      readonly tries: number;
      readonly c3_led: number;
      readonly at_us: number;
    }
  | { readonly ev: "s3_report"; readonly st: StationId; readonly id: number; readonly rtt_us: number; readonly tries: number }
  | { readonly ev: "button"; readonly board: "s3" | "c3"; readonly st?: StationId; readonly down: boolean }
  | {
      readonly ev: "stats";
      readonly board: "s3" | "c3";
      readonly st?: StationId;
      readonly stack: Readonly<Record<string, number>>;
      readonly dropped: number;
      readonly send_fails: number;
      readonly up_ms: number;
    };

export type NfcOp = "apdu" | "sign" | "reselect" | "select" | "list";

/** Pi → receiver. */
export type ReceiverCommand =
  | { readonly cmd: "state" }
  | { readonly cmd: "press"; readonly id: number }
  | { readonly cmd: "buzz"; readonly st: StationId | "all"; readonly id: number; readonly ms: number; readonly pulses: 1 | 2 | 3 }
  /** `payload` is the screen's text (`key=value` lines); the command line carries it as hex. */
  | { readonly cmd: "screen"; readonly st: StationId | "all"; readonly id: number; readonly payload: string }
  | { readonly cmd: "nfc"; readonly st: StationId; readonly id: number; readonly op: "apdu" | "sign"; readonly hex: string }
  | { readonly cmd: "nfc"; readonly st: StationId; readonly id: number; readonly op: "reselect" | "list" }
  | { readonly cmd: "nfc"; readonly st: StationId; readonly id: number; readonly op: "select"; readonly uid: string }
  | { readonly cmd: "stats"; readonly st?: StationId };
