// The serial read path's one byte scanner: splits the port's Buffers on `\n` as they arrive, with no readline or
// stream-parser chain and no copying of complete lines. Only a line cut across two chunks is copied, once.

/** The receiver writes at most 1024 bytes a line; anything this long without a newline is junk (a replug mid-line). */
const LINE_MAX = 4096;
const NL = 0x0a;
const CR = 0x0d;

export class LineScanner {
  /** The start of a line whose end hasn't arrived yet. */
  private rest: Buffer | null = null;
  /** Lines dropped for being longer than LINE_MAX. */
  overlong = 0;

  /** Calls `line` for each complete line in `chunk` (without `\n` and a trailing `\r`), in order. */
  push(chunk: Buffer, line: (text: string) => void): void {
    let start = 0;
    if (this.rest) {
      const nl = chunk.indexOf(NL);
      if (nl < 0) {
        this.keep(Buffer.concat([this.rest, chunk]));
        return;
      }
      const joined = Buffer.concat([this.rest, chunk.subarray(0, nl)]);
      this.rest = null;
      emit(joined, 0, joined.length, line);
      start = nl + 1;
    }
    for (let nl = chunk.indexOf(NL, start); nl >= 0; nl = chunk.indexOf(NL, start)) {
      emit(chunk, start, nl, line);
      start = nl + 1;
    }
    // Copied: the port's read pool may be reused once this callback returns.
    if (start < chunk.length) this.keep(Buffer.from(chunk.subarray(start)));
  }

  /** Forgets a partial line (the port closed). */
  reset(): void {
    this.rest = null;
  }

  private keep(partial: Buffer): void {
    if (partial.length > LINE_MAX) {
      this.overlong++;
      this.rest = null;
    } else {
      this.rest = partial;
    }
  }
}

function emit(buf: Buffer, start: number, end: number, line: (text: string) => void): void {
  if (end > start && buf[end - 1] === CR) end--;
  if (end > start) line(buf.toString("utf8", start, end));
}
