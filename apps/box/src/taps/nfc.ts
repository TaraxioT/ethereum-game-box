// NFC requests to a station's reader, by caller id: `nfc <st> <id> …` out, `nfc_res` / `nfc_fail` back. The receiver
// keeps one request in flight per station (a new one replaces it), so each station gets a queue here and the next
// request goes out only when the last one is answered or timed out.
import { performance } from "node:perf_hooks";
import type { Clock, TimerHandle } from "../core/ports.ts";
import { NfcError } from "./errors.ts";
import type { ReceiverCommand, ReceiverEvent, StationId, TagLine } from "./lines.ts";

export type NfcRequest =
  | { readonly op: "apdu" | "sign"; readonly hex: string }
  | { readonly op: "reselect" | "list" }
  | { readonly op: "select"; readonly uid: string };

export interface NfcReply {
  /** `apdu` / `sign`: the chip's answer, status word included (upper-case hex); else "". */
  readonly hex: string;
  /** `reselect` / `select` / `list`: the chips that answered. */
  readonly tags: readonly TagLine[];
  /** `reselect`: the HaLo applet select's status word, when the station sent one. */
  readonly sel: string | null;
  /** The station's time on it, the part spent on the PN532 and chip, and the receiver's round trip (µs). */
  readonly us: number;
  readonly waitUs: number;
  readonly rttUs: number;
  readonly tries: number;
  /** Pi ms from the write to the answer. */
  readonly piMs: number;
}

type NfcAnswer = Extract<ReceiverEvent, { ev: "nfc_res" | "nfc_fail" }>;

/** A request waits this long for its answer; the receiver itself gives up after 3 s (`no reply`). */
export const REQUEST_MS = 4000;

const ERRS: Readonly<Record<number, [NfcError["kind"], string]>> = {
  1: ["no-chip", "no chip answered"],
  2: ["transport", "RF error"],
  3: ["no-chip", "no chip on the reader"],
  4: ["reader-dead", "the PN532 isn't answering"],
  5: ["bad-request", "the station refused the request"],
};

export interface NfcDeps {
  readonly clock: Clock;
  readonly nextId: () => number;
  readonly send: (cmd: ReceiverCommand) => boolean;
}

interface Job {
  readonly st: StationId;
  readonly req: NfcRequest;
  readonly resolve: (r: NfcReply) => void;
  readonly reject: (e: Error) => void;
}

interface Flight {
  readonly job: Job;
  readonly id: number;
  readonly sentAt: number;
  readonly timer: TimerHandle;
}

export class Nfc {
  private readonly deps: NfcDeps;
  private readonly queues = new Map<StationId, Job[]>();
  private readonly flights = new Map<StationId, Flight>();

  constructor(deps: NfcDeps) {
    this.deps = deps;
  }

  request(st: StationId, req: NfcRequest): Promise<NfcReply> {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(st) ?? [];
      this.queues.set(st, queue);
      queue.push({ st, req, resolve, reject });
      if (!this.flights.has(st)) this.next(st);
    });
  }

  answer(event: NfcAnswer): void {
    const flight = this.flights.get(event.st);
    if (!flight || flight.id !== event.id) return; // a late answer to a request already timed out
    const piMs = performance.now() - flight.sentAt;
    if (event.ev === "nfc_fail") {
      const kind = event.why === "no such station linked" ? "link" : event.why === "bad request" ? "bad-request" : "transport";
      this.finish(flight, new NfcError(kind, `station ${event.st}: ${event.why}`));
      return;
    }
    const reply: NfcReply = {
      hex: event.hex?.toUpperCase() ?? "",
      tags: event.tags ?? [],
      sel: event.sel ?? null,
      us: event.us,
      waitUs: event.wait_us,
      rttUs: event.rtt_us,
      tries: event.tries,
      piMs,
    };
    // An empty reader answers `list` with err 1: that is an answer (no chips), not a failure.
    if (event.ok || (event.op === "list" && event.err === 1)) {
      this.finish(flight, reply);
      return;
    }
    const [kind, text] = ERRS[event.err] ?? ["transport", `station error ${event.err}`];
    const status = event.pn532 === undefined ? "" : ` (PN532 status 0x${event.pn532.toString(16).padStart(2, "0")})`;
    this.finish(flight, new NfcError(kind, `station ${event.st}: ${text}${status}`));
  }

  /** The port closed: every request fails now. */
  closed(): void {
    const e = () => new NfcError("closed", "the receiver closed");
    for (const flight of this.flights.values()) {
      this.deps.clock.cancel(flight.timer);
      flight.job.reject(e());
    }
    this.flights.clear();
    for (const queue of this.queues.values()) for (const job of queue.splice(0)) job.reject(e());
  }

  private next(st: StationId): void {
    const job = this.queues.get(st)?.shift();
    if (!job) return;
    const id = this.deps.nextId();
    const sentAt = performance.now();
    if (!this.deps.send(command(st, id, job.req))) {
      job.reject(new NfcError("closed", "the receiver is not open"));
      this.next(st);
      return;
    }
    const timer = this.deps.clock.after(REQUEST_MS, () => {
      const flight = this.flights.get(st);
      if (flight?.id === id) this.finish(flight, new NfcError("transport", `station ${st}: no answer in ${REQUEST_MS} ms`));
    });
    this.flights.set(st, { job, id, sentAt, timer });
  }

  private finish(flight: Flight, result: NfcReply | NfcError): void {
    this.deps.clock.cancel(flight.timer);
    this.flights.delete(flight.job.st);
    if (result instanceof NfcError) flight.job.reject(result);
    else flight.job.resolve(result);
    this.next(flight.job.st);
  }
}

function command(st: StationId, id: number, req: NfcRequest): ReceiverCommand {
  switch (req.op) {
    case "apdu":
    case "sign":
      return { cmd: "nfc", st, id, op: req.op, hex: req.hex };
    case "select":
      return { cmd: "nfc", st, id, op: "select", uid: req.uid };
    default:
      return { cmd: "nfc", st, id, op: req.op };
  }
}
