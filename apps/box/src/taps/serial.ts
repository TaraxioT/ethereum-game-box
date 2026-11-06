// Opens the receiver's tty: a /dev/serial/by-id path (or /dev/egb-receiver), or `auto` for the receiver's own by-id
// entry. The stations are Espressif boards on the same USB hub with the same kind of name, so `auto` matches the
// receiver's USB serial number, never "the first Espressif port".
//
// Reads go through Node's own tty handle: libuv watches the descriptor in the event loop, so a line is handed over
// the moment the kernel has it, with no native addon and no thread in between. (The serialport addon's reader stopped
// after its first chunk on the Pi — Node 26, Linux arm64 — while the receiver's lines piled up in the kernel's input
// queue until the next write happened to wake it: replies a write late, 100–900 ms.) Writes go out with a plain
// non-blocking write on a second descriptor: a command is a few dozen bytes, the kernel takes it at once, and nothing
// on the event loop ever waits for USB.
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { ReadStream } from "node:tty";
import type { OpenPort } from "./receiver.ts";

/** The receiver ESP32-C3's USB serial number (its MAC), as its by-id name carries it. */
export const RECEIVER_SERIAL = "7C:DF:A1:D5:04:CC";
const BY_ID = "/dev/serial/by-id";
/** A write the kernel couldn't take whole (its buffer full) gets the rest after this long, doubling each time … */
const WRITE_RETRY_MS = 1;
const WRITE_RETRY_MAX_MS = 50;
/** … for this long at most: a receiver that stopped reading this long won't take the command in time to matter. */
const WRITE_GIVE_UP_MS = 500;

/** The by-id path of the receiver, or throws when it isn't plugged in. */
export async function findReceiver(dir = BY_ID): Promise<string> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const name = names.sort().find((n) => n.includes(RECEIVER_SERIAL));
  if (!name) throw new Error(`no receiver (${RECEIVER_SERIAL}) in ${dir}`);
  return join(dir, name);
}

/** Writes part of a buffer to the port without blocking: the bytes taken, or throws (EAGAIN when it takes none). */
export type WriteSome = (data: Buffer, offset: number, length: number) => number;

export interface TtyWriter {
  /** Writes all of `data`, waiting out a full buffer off the event loop's hot path; `done` once it's out or dropped. */
  write(data: Buffer, done: (error?: Error | null) => void): void;
  /** No more writes: a retry still waiting is cancelled (its descriptor is about to close, and may be reused). */
  close(): void;
}

/**
 * Writes to a non-blocking descriptor. A command the kernel won't take within WRITE_GIVE_UP_MS is dropped (`onDrop`),
 * not retried for ever; one cut off part way gets a newline ahead of the next, so the receiver answers the torn line
 * with `bad` instead of reading the next command into it.
 */
export function ttyWriter(writeSome: WriteSome, onDrop: () => void): TtyWriter {
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let torn = false;
  return {
    write(chunk, done) {
      if (closed) return done(new Error("the receiver's port is closed"));
      const data = torn ? Buffer.concat([Buffer.from("\n"), chunk]) : chunk;
      torn = false;
      let sent = 0;
      let waited = 0;
      let pause = WRITE_RETRY_MS;
      const step = (): void => {
        retry = null;
        if (closed) return;
        try {
          while (sent < data.length) sent += writeSome(data, sent, data.length - sent);
          done();
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EAGAIN") return done(e as Error);
          if (waited >= WRITE_GIVE_UP_MS) {
            torn = sent > 0;
            onDrop();
            return done();
          }
          retry = setTimeout(step, pause);
          waited += pause;
          pause = Math.min(WRITE_RETRY_MAX_MS, pause * 2);
        }
      };
      step();
    },
    close() {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
    },
  };
}

/**
 * The receiver's tty as one Duplex. Opening it doesn't toggle DTR or RTS (an edge on an ESP32's USB serial can reset
 * it into its bootloader); raw mode turns off echo and line editing, so the receiver's own output is never sent back
 * to it and every byte arrives as it was sent.
 */
export function openTty(path: string): Duplex {
  const readFd = openSync(path, constants.O_RDWR | constants.O_NOCTTY);
  const input = new ReadStream(readFd);
  input.setRawMode(true);
  const writeFd = openSync(path, constants.O_WRONLY | constants.O_NOCTTY | constants.O_NONBLOCK);
  const writer = ttyWriter(
    (data, offset, length) => writeSync(writeFd, data, offset, length),
    () => port.emit("drop"),
  );
  const port: Duplex = new Duplex({
    read() {
      input.resume();
    },
    write(chunk: Buffer, _encoding, done) {
      writer.write(chunk, done);
    },
    destroy(error, done) {
      writer.close();
      input.destroy();
      closeSync(writeFd);
      done(error);
    },
  });
  input.on("data", (chunk: Buffer) => {
    if (!port.push(chunk)) input.pause();
  });
  // An unplugged receiver ends the read with an error (EIO): the port closes and the receiver opens it again.
  input.on("error", (e) => port.destroy(e));
  input.on("close", () => port.destroy());
  return port;
}

/** An opener for `path` (or `auto`). */
export function serialOpener(path: string): OpenPort {
  return async () => {
    const resolved = path === "auto" ? await findReceiver() : path;
    return { stream: openTty(resolved), path: resolved };
  };
}
