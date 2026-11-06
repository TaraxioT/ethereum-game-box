// The Box's own log: every line the server logs also goes to `$EGB_DATA/logs/YYYY-MM-DD.log` with its time, because
// the Pi keeps no user journal. Appends are queued in order and never block the caller (a tap is never held up by
// the disk); a write that fails is reported once on the console and the Box carries on.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface LogFile {
  log(text: string): void;
  /** Resolves once every line logged so far is on the disk. */
  flush(): Promise<void>;
}

/** The local date, as the log file's name. */
function day(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function createLogFile(dataDir: string, echo: (text: string) => void, now: () => Date = () => new Date()): LogFile {
  const dir = join(dataDir, "logs");
  let tail: Promise<void> = mkdir(dir, { recursive: true }).then(() => undefined);
  let failed = false;
  return {
    log(text) {
      echo(text);
      const at = now();
      const line = `${at.toISOString()} ${text}\n`;
      tail = tail
        .then(() => appendFile(join(dir, `${day(at)}.log`), line))
        .catch((error: unknown) => {
          if (failed) return;
          failed = true;
          echo(`log: can't write ${dir}: ${error instanceof Error ? error.message : String(error)}`);
        });
    },
    flush: () => tail,
  };
}
