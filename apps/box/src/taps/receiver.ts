// The receiver's port: the one owner of the line to the ESP32-C3. It opens the port (a serial port, or the fake
// receiver's stream), scans and parses what arrives, hands every event over synchronously (taps first), and writes
// commands without ever waiting on them. When the port goes away (a USB replug, a reflash) it says so at once, so
// every open tap fails, and opens it again with backoff.
import { performance } from "node:perf_hooks";
import type { Duplex } from "node:stream";
import type { Clock, TimerHandle } from "../core/ports.ts";
import { formatCommand } from "./commands.ts";
import { parseEvent, type DropReason } from "./events.ts";
import type { ReceiverCommand, ReceiverEvent } from "./lines.ts";
import { LineScanner } from "./scanner.ts";

/** An open line to a receiver, and what to call it in the status. */
export interface OpenedPort {
  readonly stream: Duplex;
  readonly path: string;
}

export type OpenPort = () => Promise<OpenedPort>;

export interface ReceiverOptions {
  readonly open: OpenPort;
  readonly clock: Clock;
  /** Every event, in the order it arrived except that a chunk's taps go first; `now` is when its chunk arrived. */
  readonly onEvent: (event: ReceiverEvent, now: number) => void;
  readonly onOpen: () => void;
  /** The port closed or failed: nothing sent before this will be answered. */
  readonly onClose: () => void;
  readonly log: (line: string) => void;
}

export interface ReceiverStatus {
  readonly open: boolean;
  readonly path: string | null;
  readonly opens: number;
  readonly lastError: string | null;
}

export interface ReceiverStats {
  readonly bytes: number;
  readonly lines: number;
  readonly events: number;
  readonly dropped: Readonly<Record<DropReason | "overlong", number>>;
  /** Scan and parse time per line, µs (not the handlers'). */
  readonly parseUsPerLine: number;
  readonly writes: number;
  /** Commands not written: the port was closed, or its write backlog full. */
  readonly writeDrops: number;
}

/** USB replug: try again soon, then back off. */
const REOPEN_MIN_MS = 250;
const REOPEN_MAX_MS = 4000;
/** The receiver answers `state` at once; one that didn't (its first command after boot was once lost) gets another. */
const STATE_RETRY_MS = 1000;
const STATE_TRIES = 3;
/** A port that stopped taking bytes: drop commands rather than queue them for ever. */
const WRITE_BACKLOG_MAX = 8192;

export class Receiver {
  private readonly opts: ReceiverOptions;
  private readonly scanner = new LineScanner();
  /** Reused for every chunk: a chunk's lines, then its events. */
  private readonly lineBuf: string[] = [];
  private readonly eventBuf: ReceiverEvent[] = [];
  private readonly collect = (text: string): void => {
    this.lineBuf.push(text);
  };
  private port: OpenedPort | null = null;
  private stopped = false;
  private reopenMs = REOPEN_MIN_MS;
  private reopenTimer: TimerHandle | null = null;
  private stateTimer: TimerHandle | null = null;
  private stateTries = 0;
  private status_: { path: string | null; opens: number; lastError: string | null } = { path: null, opens: 0, lastError: null };
  // Ids start at a random point: a station answers a resend of the id it just ran with that same reply, so a restarted
  // server that began at 1 again could be handed the last run's answer.
  private id = 1 + Math.floor(Math.random() * 0x7fff_ffff);
  private readonly counts = {
    bytes: 0,
    lines: 0,
    events: 0,
    writes: 0,
    writeDrops: 0,
    parseMs: 0,
    dropped: { noise: 0, json: 0, shape: 0, unknown: 0 } as Record<DropReason, number>,
  };

  constructor(opts: ReceiverOptions) {
    this.opts = opts;
  }

  start(): void {
    void this.openPort();
  }

  get open(): boolean {
    return this.port !== null;
  }

  /** A fresh id for a command (1 … 2³²−1). */
  nextId(): number {
    const id = this.id;
    this.id = id >= 0xffff_ffff ? 1 : id + 1;
    return id;
  }

  /** Queues the command; false when it can't go out (closed, or the port isn't taking bytes). Never waits. */
  send(cmd: ReceiverCommand): boolean {
    const port = this.port;
    if (!port || port.stream.writableLength > WRITE_BACKLOG_MAX) {
      this.counts.writeDrops++;
      return false;
    }
    port.stream.write(`${formatCommand(cmd)}\n`);
    this.counts.writes++;
    return true;
  }

  status(): ReceiverStatus {
    return { open: this.open, ...this.status_ };
  }

  stats(): ReceiverStats {
    const c = this.counts;
    return {
      bytes: c.bytes,
      lines: c.lines,
      events: c.events,
      dropped: { ...c.dropped, overlong: this.scanner.overlong },
      parseUsPerLine: c.lines ? (c.parseMs * 1000) / c.lines : 0,
      writes: c.writes,
      writeDrops: c.writeDrops,
    };
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.opts.clock.cancel(this.reopenTimer);
    this.opts.clock.cancel(this.stateTimer);
    const port = this.port;
    if (!port) return;
    await new Promise<void>((resolve) => {
      port.stream.once("close", () => resolve());
      port.stream.destroy();
    });
  }

  private async openPort(): Promise<void> {
    this.reopenTimer = null;
    if (this.stopped) return;
    let opened: OpenedPort;
    try {
      opened = await this.opts.open();
    } catch (e) {
      this.failed(e instanceof Error ? e.message : String(e));
      return;
    }
    if (this.stopped) {
      opened.stream.destroy();
      return;
    }
    const { stream } = opened;
    this.port = opened;
    this.status_ = { path: opened.path, opens: this.status_.opens + 1, lastError: null };
    this.reopenMs = REOPEN_MIN_MS;
    stream.on("data", (chunk: Buffer) => this.onData(chunk));
    stream.on("error", (e: Error) => {
      this.status_ = { ...this.status_, lastError: e.message };
    });
    stream.once("close", () => this.onPortClose(opened));
    this.opts.log(`taps: receiver open on ${opened.path}`);
    this.opts.onOpen();
    this.stateTries = 0;
    this.askState();
  }

  /** `state` after every open: it reports each station, and it drains the receiver's first-command quirk. */
  private askState(): void {
    this.stateTimer = null;
    if (!this.port || this.stateTries >= STATE_TRIES) return;
    this.stateTries++;
    this.send({ cmd: "state" });
    this.stateTimer = this.opts.clock.after(STATE_RETRY_MS, () => this.askState());
  }

  private onData(chunk: Buffer): void {
    const now = this.opts.clock.now();
    const started = performance.now();
    const c = this.counts;
    c.bytes += chunk.length;
    const lines = this.lineBuf;
    const events = this.eventBuf;
    lines.length = 0;
    events.length = 0;
    this.scanner.push(chunk, this.collect);
    for (const text of lines) {
      const parsed = parseEvent(text);
      if (typeof parsed === "string") c.dropped[parsed]++;
      else events.push(parsed);
    }
    c.lines += lines.length;
    c.events += events.length;
    c.parseMs += performance.now() - started;
    // Taps first: a touch's time is already fixed by its line, but the game should hear of it before anything else.
    for (const e of events) if (e.ev === "tap") this.deliver(e, now);
    for (const e of events) if (e.ev !== "tap") this.deliver(e, now);
  }

  private deliver(event: ReceiverEvent, now: number): void {
    if (event.ev === "state") {
      this.opts.clock.cancel(this.stateTimer);
      this.stateTimer = null;
      this.stateTries = STATE_TRIES;
    }
    try {
      this.opts.onEvent(event, now);
    } catch (e) {
      this.opts.log(`taps: handling ${event.ev} failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  private onPortClose(closed: OpenedPort): void {
    if (this.port !== closed) return;
    this.port = null;
    this.scanner.reset();
    this.opts.clock.cancel(this.stateTimer);
    this.stateTimer = null;
    this.opts.log(`taps: receiver on ${closed.path} closed`);
    this.opts.onClose();
    if (!this.stopped) this.failed(this.status_.lastError ?? "closed");
  }

  private failed(why: string): void {
    // Logged when it changes: a receiver that stays unplugged would otherwise log every few seconds.
    if (why !== this.status_.lastError) this.opts.log(`taps: receiver: ${why}`);
    this.status_ = { ...this.status_, lastError: why };
    if (this.stopped) return;
    this.reopenTimer = this.opts.clock.after(this.reopenMs, () => void this.openPort());
    this.reopenMs = Math.min(REOPEN_MAX_MS, this.reopenMs * 2);
  }
}
