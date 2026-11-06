// Commands waiting on their answer, by the id they carried: buzz → buzz_ok / buzz_fail, screen → screen_ok /
// screen_fail, press → c3_ack / c3_fail. Each settles once (its answer, a timeout, or the port closing); late or
// unknown answers are ignored. Times are taken with performance.now(), for the bench.
import { performance } from "node:perf_hooks";
import type { Clock, TimerHandle } from "../core/ports.ts";
import type { ReceiverEvent } from "./lines.ts";

export type Ack = Extract<ReceiverEvent, { ev: "buzz_ok" | "buzz_fail" | "screen_ok" | "screen_fail" | "c3_ack" | "c3_fail" }>;

export interface Answer {
  /** The answer, or null when it timed out or the port closed first. */
  readonly event: Ack | null;
  readonly why: "answered" | "timeout" | "closed";
  /** Pi ms from the write to the answer. */
  readonly piMs: number;
}

interface Waiting {
  readonly sentAt: number;
  readonly timer: TimerHandle;
  readonly done: (a: Answer) => void;
}

export class Acks {
  private readonly clock: Clock;
  private readonly waiting = new Map<number, Waiting>();

  constructor(clock: Clock) {
    this.clock = clock;
  }

  /** Waits for the answer to the command just sent with `id`. */
  wait(id: number, timeoutMs: number): Promise<Answer> {
    const sentAt = performance.now();
    return new Promise((resolve) => {
      const timer = this.clock.after(timeoutMs, () => this.settle(id, null, "timeout"));
      this.waiting.set(id, { sentAt, timer, done: resolve });
    });
  }

  answer(event: Ack): void {
    this.settle(event.id, event, "answered");
  }

  /** The port closed: nothing waiting will be answered. */
  closed(): void {
    for (const id of [...this.waiting.keys()]) this.settle(id, null, "closed");
  }

  private settle(id: number, event: Ack | null, why: Answer["why"]): void {
    const w = this.waiting.get(id);
    if (!w) return;
    this.waiting.delete(id);
    this.clock.cancel(w.timer);
    w.done({ event, why, piMs: performance.now() - w.sentAt });
  }
}
