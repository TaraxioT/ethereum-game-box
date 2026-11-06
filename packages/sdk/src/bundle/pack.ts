// The packer, and the only one: a bundle's files into the one zip shape read.ts accepts. Everything that could vary is
// fixed (order, time, mode, flags, level), so the same files make the same bytes and the same hash on any machine.
//
// fflate does the deflating because it is plain JavaScript at a pinned version. CompressionStream's output belongs to
// each runtime's zlib and no standard fixes it, and the reader packs a bundle's files again to compare the bytes.
import { deflateSync } from "fflate";
import { BUNDLE_LIMITS, judgeFiles, refuse } from "./format.ts";

export const SIGNATURE = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 } as const;

/** The fixed fields: zip 2.0, UTF-8 names, no time (1980-01-01), a plain file with mode 0644, made on Unix. */
export const FIXED = { madeBy: 0x0314, needs: 20, flags: 0x0800, time: 0, date: 0x21, attributes: (0o100644 << 16) >>> 0 } as const;

export const METHOD = { stored: 0, deflated: 8 } as const;

/** Text is deflated. Every other kind of asset is compressed already, so it is stored. */
export function methodOf(name: string): number {
  return /\.(?:html|css|js|svg|json)$/.test(name) ? METHOD.deflated : METHOD.stored;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Field = readonly [width: 2 | 4, value: number];

/** Little-endian fields, one after the other. */
function record(fields: readonly Field[]): Uint8Array {
  const out = new Uint8Array(fields.reduce((sum, [width]) => sum + width, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [width, value] of fields) {
    if (width === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    at += width;
  }
  return out;
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The zip of `files`, whatever they hold: names sorted by byte, each entry written the one way it can be. */
export function zipFiles(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let at = 0;
  for (const file of [...files.keys()].sort()) {
    const body = files.get(file) as Uint8Array;
    const name = new TextEncoder().encode(file);
    const method = methodOf(file);
    const data = method === METHOD.deflated ? deflateSync(body, { level: 9 }) : body;
    const shared: Field[] = [[2, FIXED.flags], [2, method], [2, FIXED.time], [2, FIXED.date], [4, crc32(body)], [4, data.length], [4, body.length], [2, name.length], [2, 0]];
    const local = record([[4, SIGNATURE.local], [2, FIXED.needs], ...shared]);
    directory.push(record([[4, SIGNATURE.central], [2, FIXED.madeBy], [2, FIXED.needs], ...shared, [2, 0], [2, 0], [2, 0], [4, FIXED.attributes], [4, at]]), name);
    entries.push(local, name, data);
    at += local.length + name.length + data.length;
  }
  const list = joined(directory);
  const end = record([[4, SIGNATURE.end], [2, 0], [2, 0], [2, files.size], [2, files.size], [4, list.length], [4, at], [2, 0]]);
  return joined([...entries, list, end]);
}

/** A bundle's files, by name, as its zip. Refuses what the reader would, so a bad folder fails here and not at the store. */
export function packBundle(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  judgeFiles(files);
  const zip = zipFiles(files);
  if (zip.length > BUNDLE_LIMITS.zipBytes) refuse(`the zip is ${zip.length} B: at most ${BUNDLE_LIMITS.zipBytes} B`);
  return zip;
}
