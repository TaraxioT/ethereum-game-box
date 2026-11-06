// The one zip reader, on the Box, in the store and in a browser alike. A bundle is a zip of one exact shape, which only
// pack.ts makes, and anything else is refused rather than repaired: there is no second way to read a file that has only
// one reading.
//
// Every header field is either fixed or must agree with the other copy of it. Entries tile the file from byte 0 to the
// central directory with no gaps, no overlaps and nothing after the end record, so no bytes can hide, be read twice, or
// mean something else to another tool. Every file is stored, so a compressed one is refused at its header, before a
// byte is inflated, which is all a zip bomb gets. Each file's CRC is then checked. A read costs one pass over the zip,
// whatever it holds.
import { BUNDLE_LIMITS, BundleRefused, judgeFiles, nameProblem, refuse, type OpenedBundle } from "./format.ts";
import { crc32, FIXED, SIGNATURE } from "./pack.ts";

const LOCAL_BYTES = 30;
const CENTRAL_BYTES = 46;
const END_BYTES = 22;

interface Entry {
  readonly name: string;
  readonly crc: number;
  readonly size: number;
  readonly dataAt: number;
}

/** Walks the central directory, checks each entry's local header against it, and returns the entries in file order. */
function walk(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const end = bytes.length - END_BYTES;
  if (end < 0 || u32(end) !== SIGNATURE.end) refuse("the file doesn't end in a zip's end record");
  const count = u16(end + 10);
  const dirBytes = u32(end + 12);
  const dirAt = u32(end + 16);
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count || u16(end + 20) !== 0) refuse("a split zip, or one with a comment");
  if (count < 2 || count > BUNDLE_LIMITS.files) refuse(`${count} files: at least 2 and at most ${BUNDLE_LIMITS.files}`);
  if (dirAt + dirBytes !== end) refuse("the directory doesn't end where the end record starts");

  const entries: Entry[] = [];
  let cursor = 0;
  let at = dirAt;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_BYTES > end || u32(at) !== SIGNATURE.central) refuse("the directory is broken");
    const nameBytes = u16(at + 28);
    if (nameBytes > BUNDLE_LIMITS.nameBytes) refuse(`a name over ${BUNDLE_LIMITS.nameBytes} bytes`);
    if (at + CENTRAL_BYTES + nameBytes > end) refuse("the directory is broken");
    const nameRaw = bytes.subarray(at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameBytes);
    const name = String.fromCharCode(...nameRaw);
    const problem = nameProblem(name);
    if (problem) refuse(problem);
    const before = entries.at(-1)?.name;
    if (before !== undefined && name <= before) refuse(name === before ? `${name} is named twice` : `${name} is out of order`);
    if (u16(at + 4) !== FIXED.madeBy || u16(at + 6) !== FIXED.needs || u16(at + 8) !== FIXED.flags || u16(at + 12) !== FIXED.time || u16(at + 14) !== FIXED.date) {
      refuse(`${name}: not written by the format's packer`);
    }
    if (u16(at + 30) !== 0 || u16(at + 32) !== 0 || u16(at + 34) !== 0 || u16(at + 36) !== 0) refuse(`${name}: an extra field, comment or split`);
    if (u32(at + 38) !== FIXED.attributes) refuse(`${name}: not a plain file`);
    if (u32(at + 42) !== cursor) refuse(`${name}: the entries don't follow each other exactly`);

    const method = u16(at + 10);
    const crc = u32(at + 16);
    const size = u32(at + 24);
    if (method !== FIXED.method) refuse(`${name}: compression method ${method}`);
    if (u32(at + 20) !== size) refuse(`${name}: stored, but its sizes differ`);

    const dataAt = cursor + LOCAL_BYTES + nameBytes;
    if (dataAt + size > dirAt) refuse(`${name} runs past the entries`);
    const same =
      u32(cursor) === SIGNATURE.local && u16(cursor + 4) === FIXED.needs && u16(cursor + 6) === FIXED.flags && u16(cursor + 8) === method && u16(cursor + 10) === FIXED.time &&
      u16(cursor + 12) === FIXED.date && u32(cursor + 14) === crc && u32(cursor + 18) === size && u32(cursor + 22) === size && u16(cursor + 26) === nameBytes && u16(cursor + 28) === 0;
    if (!same || !nameRaw.every((b, k) => b === bytes[cursor + LOCAL_BYTES + k])) refuse(`${name}: its local header disagrees with the directory`);

    entries.push({ name, crc, size, dataAt });
    cursor = dataAt + size;
    at += CENTRAL_BYTES + nameBytes;
  }
  if (at !== end || cursor !== dirAt) refuse("bytes between the entries and the directory");
  return entries;
}

async function sha256(bytes: Uint8Array): Promise<`0x${string}`> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return `0x${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** A bundle's manifest, files and hash, or a BundleRefused saying why not. Writes nothing. */
export async function readBundle(bytes: Uint8Array): Promise<OpenedBundle> {
  if (bytes.length > BUNDLE_LIMITS.zipBytes) refuse(`the zip is ${bytes.length} B: at most ${BUNDLE_LIMITS.zipBytes} B`);
  let entries: Entry[];
  try {
    entries = walk(bytes);
  } catch (error) {
    throw error instanceof BundleRefused ? error : new BundleRefused("not a bundle: a header runs off the end of the file");
  }
  const files = new Map<string, Uint8Array>();
  for (const e of entries) {
    const body = new Uint8Array(bytes.subarray(e.dataAt, e.dataAt + e.size));
    if (crc32(body) !== e.crc) refuse(`${e.name}: its CRC doesn't match`);
    files.set(e.name, body);
  }
  return { manifest: judgeFiles(files), files, hash: await sha256(bytes) };
}
