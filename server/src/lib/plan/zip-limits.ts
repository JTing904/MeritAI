// Decompression-bomb check for .docx briefs (security audit 2026-09-19): a 600 KB upload can inflate to
// gigabytes inside mammoth. The central directory's sizes can lie, so every entry is inflated here with
// a hard output cap before mammoth sees the file. Offsets are read exactly as JSZip (mammoth's unzipper)
// reads them, so both see the same bytes.
import { inflateRawSync } from "node:zlib";

/** Total uncompressed bytes of every entry together. */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 1000;
/** Real Word XML compresses 5–30×; a bomb reaches ~1000×. Only entries over RATIO_MIN_BYTES are judged. */
export const MAX_ZIP_RATIO = 200;
const RATIO_MIN_BYTES = 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
/** The zip comment is at most 65535 bytes, so the end record is within this many bytes of the end. */
const EOCD_SEARCH = EOCD_MIN + 0xffff;

/** Whether the zip stays within the limits above (false for anything malformed, zip64 or encrypted too). */
export function zipWithinLimits(bytes: Uint8Array): boolean {
  try {
    return check(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    return false;
  }
}

function check(buf: Buffer): boolean {
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_SEARCH); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return false;
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // 0xFFFF / 0xFFFFFFFF mean zip64 fields elsewhere: no Word file needs those.
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return false;
  if (entries === 0 || entries > MAX_ZIP_ENTRIES) return false;
  // Data in front of the archive makes JSZip shift every offset; a real .docx has none.
  if (cdOffset + cdSize !== eocd) return false;

  let total = 0;
  let at = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(at) !== CD_SIG) return false;
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const declared = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) return false; // encrypted
    if (compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff) return false;
    if (buf.readUInt32LE(local) !== LOCAL_SIG) return false;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressed > buf.length) return false;
    const budget = MAX_ZIP_UNCOMPRESSED_BYTES - total;
    let size: number;
    if (method === 0) size = compressed;
    else if (method === 8) {
      // maxOutputLength makes zlib stop (and throw) instead of allocating the whole bomb.
      size = inflateRawSync(buf.subarray(start, start + compressed), { maxOutputLength: Math.max(1, budget + 1) }).length;
    } else return false;
    if (size > budget) return false;
    if (size > RATIO_MIN_BYTES && size > compressed * MAX_ZIP_RATIO) return false;
    total += size;
  }
  return true;
}
