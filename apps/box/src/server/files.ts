// Writing files so that a power cut never leaves half of one: the Pi is unplugged, not shut down.
import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writes `file` whole or not at all: a temp file beside it, flushed to the disk, renamed over it, and the folder
 * flushed so the rename itself survives a power cut.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await syncDir(dir);
}

async function syncDir(dir: string): Promise<void> {
  // Some filesystems can't open or flush a folder; the file itself is already safe on disk by then.
  const handle = await open(dir, "r").catch(() => null);
  if (!handle) return;
  try {
    await handle.sync();
  } catch {
    // As above.
  } finally {
    await handle.close();
  }
}
