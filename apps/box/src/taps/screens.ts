// What each station's OLED shows: sent when it changes, again when the station relinks (it drops the Pi's screen 3 s
// after its link drops and doesn't get it back on its own), and again every REFRESH_MS with a ttl of TTL_S, so a
// station that missed a send catches up within seconds and one whose Box stopped goes back to its own defaults.
// Screens are decoration: nothing here throws, and nothing waits on an answer.
import type { StationView } from "@egb/sdk";
import type { Clock, TimerHandle } from "../core/ports.ts";
import type { Acks, Answer } from "./acks.ts";
import type { ReceiverCommand, StationId } from "./lines.ts";
import { screenPayload } from "./screen-payload.ts";

export const REFRESH_MS = 5000;
export const TTL_S = 15;
/** The receiver gives up on a screen after a second without the station's ack. */
const ACK_MS = 1500;
/** After a failed screen, wait this long before the next try. */
const FAIL_RETRY_MS = 1000;
/** How often the refresh check runs. */
const TICK_MS = 1000;

export interface ScreensDeps {
  readonly clock: Clock;
  readonly acks: Acks;
  readonly nextId: () => number;
  readonly send: (cmd: ReceiverCommand) => boolean;
  readonly isUp: (st: StationId) => boolean;
}

export interface ScreenStatus {
  readonly st: StationId;
  /** The payload the station should show. */
  readonly payload: string;
  /** It acked the last send of it. */
  readonly acked: boolean;
}

interface Screen {
  payload: string;
  /** The id of the last send of `payload`, or null when it needs sending. */
  sentId: number | null;
  sentAt: number;
  retryAt: number;
  acked: boolean;
}

export class Screens {
  private readonly deps: ScreensDeps;
  private readonly screens = new Map<StationId, Screen>();
  private readonly tick: TimerHandle;

  constructor(deps: ScreensDeps) {
    this.deps = deps;
    this.tick = deps.clock.every(TICK_MS, () => {
      for (const st of this.screens.keys()) this.flush(st);
    });
  }

  show(st: StationId, view: StationView): void {
    const payload = screenPayload(view, TTL_S);
    const s = this.screens.get(st);
    if (s?.payload === payload) return;
    this.screens.set(st, { payload, sentId: null, sentAt: 0, retryAt: 0, acked: false });
    this.flush(st);
  }

  /** The station (re)linked: it shows its own defaults until it gets its screen again. */
  up(st: StationId): void {
    const s = this.screens.get(st);
    if (!s) return;
    s.sentId = null;
    s.retryAt = 0;
    this.flush(st);
  }

  /** The port closed or the link dropped: every screen goes again once it is back. */
  stale(st: StationId): void {
    const s = this.screens.get(st);
    if (s) s.sentId = null;
  }

  /** Sends the station's screen now with its own id and waits for the answer (the bench's screen → screen_ok). */
  probe(st: StationId): Promise<Answer> {
    const id = this.deps.nextId();
    const payload = this.screens.get(st)?.payload ?? "ttl=1";
    const answer = this.deps.acks.wait(id, ACK_MS);
    if (!this.deps.send({ cmd: "screen", st, id, payload })) return answer;
    const s = this.screens.get(st);
    if (s) Object.assign(s, { sentId: id, sentAt: this.deps.clock.now(), acked: false });
    return answer;
  }

  status(): ScreenStatus[] {
    return [...this.screens].map(([st, s]) => ({ st, payload: s.payload, acked: s.acked }));
  }

  stop(): void {
    this.deps.clock.cancel(this.tick);
  }

  private flush(st: StationId): void {
    const s = this.screens.get(st);
    const now = this.deps.clock.now();
    if (!s || !this.deps.isUp(st) || now < s.retryAt) return;
    if (s.sentId !== null && now - s.sentAt < REFRESH_MS) return;
    const id = this.deps.nextId();
    if (!this.deps.send({ cmd: "screen", st, id, payload: s.payload })) return;
    s.sentId = id;
    s.sentAt = now;
    void this.deps.acks.wait(id, ACK_MS).then((a) => {
      // A newer screen (or a resend) replaced this one: its answer, if any, no longer matters.
      if (s !== this.screens.get(st) || s.sentId !== id) return;
      s.acked = a.event?.ev === "screen_ok";
      if (s.acked) return;
      s.sentId = null;
      s.retryAt = this.deps.clock.now() + FAIL_RETRY_MS;
    });
  }
}
