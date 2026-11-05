// Opens the receiver's serial port: a /dev/serial/by-id path, or `auto` for the receiver's own by-id entry. The
// stations are Espressif boards on the same USB hub with the same kind of name, so `auto` matches the receiver's USB
// serial number, never "the first Espressif port".
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { OpenPort } from "./receiver.ts";

/** The receiver ESP32-C3's USB serial number (its MAC), as its by-id name carries it. */
export const RECEIVER_SERIAL = "7C:DF:A1:D5:04:CC";
const BY_ID = "/dev/serial/by-id";

/** The by-id path of the receiver, or throws when it isn't plugged in. */
export async function findReceiver(dir = BY_ID): Promise<string> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const name = names.sort().find((n) => n.includes(RECEIVER_SERIAL));
  if (!name) throw new Error(`no receiver (${RECEIVER_SERIAL}) in ${dir}`);
  return join(dir, name);
}

/**
 * An opener for `path` (or `auto`). The port opens with nothing toggled: `hupcl: false` keeps DTR as it is on close,
 * and no set() call follows, since DTR/RTS edges on an ESP32's USB serial can reset it into its bootloader. The baud
 * rate is ignored by USB CDC; 115200 is what every tool uses.
 */
export function serialOpener(path: string): OpenPort {
  return async () => {
    const resolved = path === "auto" ? await findReceiver() : path;
    // Loaded here so laptops and tests running the fake never load the native binding.
    const { SerialPort } = await import("serialport");
    const port = new SerialPort({ path: resolved, baudRate: 115200, autoOpen: false, hupcl: false, lock: true });
    await new Promise<void>((resolve, reject) => port.open((e) => (e ? reject(e) : resolve())));
    return { stream: port, path: resolved };
  };
}
