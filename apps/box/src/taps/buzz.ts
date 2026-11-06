// The stations' motors: one short buzz for an accepted tap, two short for a refused one. Each buzz carries its own id
// and is answered by buzz_ok or buzz_fail; the answers are counted, never waited on by a game.
import type { Acks, Answer } from "./acks.ts";
import type { ReceiverCommand, StationId } from "./lines.ts";

export type BuzzKind = "ok" | "no";

/** A short pulse, and the gap-separated pair for "no" (the receiver spaces pulses 60 ms apart). */
const PULSE_MS = 80;
const PULSES: Readonly<Record<BuzzKind, 1 | 2>> = { ok: 1, no: 2 };
/** The receiver fails a buzz after a second without the station's ack. */
const ACK_MS = 1500;
/** The bench's buzz: as short as the motor takes, so 200 of them stay quiet. */
const PROBE_MS = 1;

export interface BuzzDeps {
  readonly acks: Acks;
  readonly nextId: () => number;
  readonly send: (cmd: ReceiverCommand) => boolean;
}

export class Buzzer {
  private readonly deps: BuzzDeps;
  readonly counts = { sent: 0, ok: 0, failed: 0 };

  constructor(deps: BuzzDeps) {
    this.deps = deps;
  }

  buzz(st: StationId, kind: BuzzKind): void {
    void this.run(st, PULSE_MS, PULSES[kind]);
  }

  /** A 1 ms buzz and its answer (the bench's buzz → buzz_ok). */
  probe(st: StationId): Promise<Answer> {
    return this.run(st, PROBE_MS, 1);
  }

  private run(st: StationId, ms: number, pulses: 1 | 2): Promise<Answer> {
    const id = this.deps.nextId();
    const answer = this.deps.acks.wait(id, ACK_MS);
    if (this.deps.send({ cmd: "buzz", st, id, ms, pulses })) this.counts.sent++;
    return answer.then((a) => {
      if (a.event?.ev === "buzz_ok") this.counts.ok++;
      else this.counts.failed++;
      return a;
    });
  }
}
