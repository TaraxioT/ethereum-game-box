// A zip writer that does what it is told, field by field, for bundles no honest packer makes. With no overrides its
// output is byte for byte the packer's, which the control test proves, so each hostile zip is wrong in exactly one way.
import { crc32 } from "node:zlib";
import { deflateSync } from "fflate";

export interface Raw {
  name: string;
  body: Uint8Array;
  /** Compressed bytes to write instead of deflating `body`. */
  data?: Uint8Array;
  method?: number;
  flags?: number;
  time?: number;
  date?: number;
  madeBy?: number;
  needs?: number;
  attributes?: number;
  crc?: number;
  /** What the central directory claims. */
  size?: number;
  packed?: number;
  localName?: string;
  localMethod?: number;
  localFlags?: number;
  localCrc?: number;
  localSize?: number;
  localPacked?: number;
  extra?: Uint8Array;
  localExtra?: Uint8Array;
  comment?: string;
  /** Writes the central record at this entry's local offset, and no local entry of its own. */
  sharesBodyOf?: string;
  /** Bytes inserted before this entry's local header. */
  gapBefore?: Uint8Array;
  /** Written in the directory only. */
  noLocal?: boolean;
}

export interface Whole {
  prefix?: Uint8Array;
  /** Bytes between the last entry and the directory. */
  beforeDirectory?: Uint8Array;
  suffix?: Uint8Array;
  comment?: string;
  disk?: number;
  countOverride?: number;
  /** A second end record just before the real one. */
  doubleEnd?: boolean;
  /** Directory offset moved by this much. */
  dirShift?: number;
  /** ZIP64 markers in the end record, with a ZIP64 end and locator before it. */
  zip64?: boolean;
}

const isText = (name: string) => /\.(?:html|css|js|svg|json)$/.test(name);

export function rawZip(entries: readonly Raw[], w: Whole = {}): Buffer {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const offsets = new Map<string, number>();
  let offset = w.prefix?.length ?? 0;
  if (w.prefix) parts.push(w.prefix);
  for (const e of entries) {
    const method = e.method ?? (isText(e.name) ? 8 : 0);
    const data = e.data ?? (method === 8 ? deflateSync(e.body, { level: 9 }) : e.body);
    const crc = e.crc ?? crc32(e.body);
    const size = e.size ?? e.body.length;
    const packed = e.packed ?? data.length;
    const name = Buffer.from(e.name, "utf8");
    const localName = Buffer.from(e.localName ?? e.name, "utf8");
    const extra = e.extra ?? Buffer.alloc(0);
    const localExtra = e.localExtra ?? Buffer.alloc(0);
    const comment = Buffer.from(e.comment ?? "");
    let at = offset;
    if (e.sharesBodyOf) {
      at = offsets.get(e.sharesBodyOf) as number;
    } else if (!e.noLocal) {
      if (e.gapBefore) {
        parts.push(e.gapBefore);
        offset += e.gapBefore.length;
        at = offset;
      }
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(e.needs ?? 20, 4);
      local.writeUInt16LE(e.localFlags ?? e.flags ?? 0x0800, 6);
      local.writeUInt16LE(e.localMethod ?? method, 8);
      local.writeUInt16LE(e.time ?? 0, 10);
      local.writeUInt16LE(e.date ?? 0x21, 12);
      local.writeUInt32LE((e.localCrc ?? crc) >>> 0, 14);
      local.writeUInt32LE(e.localPacked ?? packed, 18);
      local.writeUInt32LE(e.localSize ?? size, 22);
      local.writeUInt16LE(localName.length, 26);
      local.writeUInt16LE(localExtra.length, 28);
      parts.push(local, localName, localExtra, data);
      offsets.set(e.name, at);
      offset += local.length + localName.length + localExtra.length + data.length;
    }
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(e.madeBy ?? 0x0314, 4);
    head.writeUInt16LE(e.needs ?? 20, 6);
    head.writeUInt16LE(e.flags ?? 0x0800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(e.time ?? 0, 12);
    head.writeUInt16LE(e.date ?? 0x21, 14);
    head.writeUInt32LE(crc >>> 0, 16);
    head.writeUInt32LE(packed, 20);
    head.writeUInt32LE(size, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt16LE(extra.length, 30);
    head.writeUInt16LE(comment.length, 32);
    head.writeUInt32LE((e.attributes ?? 0o100644 << 16) >>> 0, 38);
    head.writeUInt32LE(at, 42);
    central.push(head, name, extra, comment);
  }
  if (w.beforeDirectory) {
    parts.push(w.beforeDirectory);
    offset += w.beforeDirectory.length;
  }
  const directory = Buffer.concat(central);
  const count = w.countOverride ?? entries.length;
  const comment = Buffer.from(w.comment ?? "");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(w.disk ?? 0, 4);
  end.writeUInt16LE(w.disk ?? 0, 6);
  end.writeUInt16LE(w.zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(w.zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(w.zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(w.zip64 ? 0xffffffff : offset + (w.dirShift ?? 0), 16);
  end.writeUInt16LE(comment.length, 20);
  const tail: Uint8Array[] = [directory];
  if (w.zip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeUInt16LE(45, 12);
    z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(count), 24);
    z.writeBigUInt64LE(BigInt(count), 32);
    z.writeBigUInt64LE(BigInt(directory.length), 40);
    z.writeBigUInt64LE(BigInt(offset), 48);
    const l = Buffer.alloc(20);
    l.writeUInt32LE(0x07064b50, 0);
    l.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    l.writeUInt32LE(1, 16);
    tail.push(z, l);
  }
  if (w.doubleEnd) tail.push(end);
  tail.push(end, comment);
  if (w.suffix) tail.push(w.suffix);
  return Buffer.concat([...parts, ...tail]);
}
