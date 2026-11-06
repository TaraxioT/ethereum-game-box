// The rules child's memory cap. V8's --max-old-space-size bounds only the JS heap: ArrayBuffers and typed arrays live
// outside it, so a game can allocate gigabytes under a 64 MB heap. The guard reads the child's resident memory from
// /proc and SIGKILLs it over the cap, so a game can't starve the kiosk on the Pi.
//
// Resident memory, not address space: RLIMIT_AS would have to sit above the ~1 GB V8 reserves before it runs any code
// (Node 26 on the Pi starts at about 900 MB of address space and 40 MB resident), a margin that moves with every Node
// release; a Node that reserved more would refuse to start every built game. Pages count once they are touched, so a
// game that fills memory as fast as the Pi can write gets one poll's worth past the cap before it dies.
//
// Linux only (/proc). On macOS, where only development runs games, the heap cap alone applies.
import { readFile } from "node:fs/promises";

/** A rules child may hold this much: Node's own ~40 MB, the 64 MB heap with its young generation, and room to spare. */
export const MEMORY_CAP_BYTES = 256 * 1024 * 1024;
/** How often the child's memory is read. */
export const MEMORY_POLL_MS = 25;

/** VmRSS from a /proc/<pid>/status text, in bytes; null when it isn't there (a zombie, another OS). */
export function residentBytes(status: string): number | null {
  const kb = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1];
  return kb === undefined ? null : Number(kb) * 1024;
}

/** Reads a process's resident memory; null when it can't (no /proc, the process is gone). */
export async function readResident(pid: number): Promise<number | null> {
  try {
    return residentBytes(await readFile(`/proc/${pid}/status`, "utf8"));
  } catch {
    return null;
  }
}

export interface MemoryGuardOptions {
  readonly capBytes?: number;
  readonly everyMs?: number;
  /** How the memory is read (tests: a stand-in). */
  readonly read?: (pid: number) => Promise<number | null>;
  /** The child went over the cap: the caller kills it. Called once. */
  over(bytes: number): void;
}

export interface MemoryGuard {
  stop(): void;
}

/** Whether this OS can guard a child's memory. */
export const canGuardMemory = (): boolean => process.platform === "linux";

/** Watches `pid` until stopped or over the cap. One read at a time: a slow read never stacks up behind itself. */
export function guardMemory(pid: number, options: MemoryGuardOptions): MemoryGuard {
  const cap = options.capBytes ?? MEMORY_CAP_BYTES;
  const read = options.read ?? readResident;
  let stopped = false;
  let reading = false;
  const timer = setInterval(() => {
    if (reading || stopped) return;
    reading = true;
    void read(pid).then((bytes) => {
      reading = false;
      if (stopped || bytes === null || bytes <= cap) return;
      stop();
      options.over(bytes);
    });
  }, options.everyMs ?? MEMORY_POLL_MS);
  // A child that lives on doesn't keep the server's tests or shutdown waiting on the guard.
  timer.unref();
  function stop(): void {
    stopped = true;
    clearInterval(timer);
  }
  return { stop };
}
