// What an evidence upload really is, from its first bytes (M4 spec §5). The client's MIME type is never
// trusted; the extension only tells apart formats that share a container (zip, OLE) and marks CSV.
import type { EvidenceExtension } from "../../../shared/constants";
import { fileExtension } from "./file-name";

/** Language-neutral family (the app shows its own words: Word / PDF / PPT / 图片 / Excel / CSV). */
export type EvidenceFamily = "Word" | "PDF" | "PowerPoint" | "Image" | "Excel" | "CSV";

export type EvidenceType = {
  /** The storage key's extension. */
  ext: EvidenceExtension;
  /** Canonical MIME type of the detected format (stored on the Evidence row, sent when serving). */
  mimeType: string;
  label: EvidenceFamily;
};

/** How many leading bytes detectEvidenceType looks at. */
export const SNIFF_BYTES = 4096;

const TYPES: Record<EvidenceExtension, Omit<EvidenceType, "ext">> = {
  pdf: { mimeType: "application/pdf", label: "PDF" },
  png: { mimeType: "image/png", label: "Image" },
  jpg: { mimeType: "image/jpeg", label: "Image" },
  jpeg: { mimeType: "image/jpeg", label: "Image" },
  webp: { mimeType: "image/webp", label: "Image" },
  heic: { mimeType: "image/heic", label: "Image" },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word" },
  pptx: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint" },
  xlsx: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
  doc: { mimeType: "application/msword", label: "Word" },
  ppt: { mimeType: "application/vnd.ms-powerpoint", label: "PowerPoint" },
  xls: { mimeType: "application/vnd.ms-excel", label: "Excel" },
  csv: { mimeType: "text/csv", label: "CSV" },
};

const typeOf = (ext: EvidenceExtension): EvidenceType => ({ ext, ...TYPES[ext] });

const ZIP_EXTS = new Set(["docx", "pptx", "xlsx"]);
const OLE_EXTS = new Set(["doc", "ppt", "xls"]);

/**
 * The evidence type of an upload from its first bytes (`head`, up to SNIFF_BYTES) and its sanitised
 * name, or null when it isn't one the app accepts (FILE_TYPE_UNSUPPORTED). PDF and images are known
 * by their signature whatever they are called; Office files by their container plus the extension;
 * CSV by the extension plus text that decodes (UTF-16 with a BOM, else UTF-8 or GB18030 without NULs).
 */
export function detectEvidenceType(head: Uint8Array, fileName: string): EvidenceType | null {
  const bytes = head.subarray(0, SNIFF_BYTES);
  const ext = fileExtension(fileName);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  const startsWith = (sig: number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

  if (ascii(0, 1024).includes("%PDF-")) return typeOf("pdf");
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return typeOf("png");
  if (startsWith([0xff, 0xd8, 0xff])) return typeOf("jpg");
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return typeOf("webp");
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(8, 12))) return typeOf("heic");
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return ZIP_EXTS.has(ext) ? typeOf(ext as EvidenceExtension) : null;
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0])) return OLE_EXTS.has(ext) ? typeOf(ext as EvidenceExtension) : null;
  if (ext === "csv" && isText(bytes)) return typeOf("csv");
  return null;
}

/** Text a spreadsheet exported as CSV: UTF-16 with a byte-order mark, or UTF-8 / GB18030 without NUL bytes. */
function isText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  // UTF-16 has a NUL in every other byte for ASCII text, so the BOM alone decides.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  if (bytes.includes(0)) return false;
  // `stream: true`: the head may end in the middle of a character.
  for (const encoding of ["utf-8", "gb18030"]) {
    try {
      new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: true });
      return true;
    } catch {
      // Not this encoding (or not supported by this runtime): try the next.
    }
  }
  return false;
}

/**
 * Browsers show these in place (`Content-Disposition: inline`); everything else downloads, the legacy
 * .doc/.xls/.ppt and every Office or CSV file included (an allow-list, so a new type downloads by default).
 */
const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"]);
export const isInlineType = (mimeType: string): boolean => INLINE_TYPES.has(mimeType);
