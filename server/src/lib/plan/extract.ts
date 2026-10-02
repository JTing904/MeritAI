// Extracts plain text from an uploaded brief. PDF (unpdf), Word .docx (mammoth), plain text.
// Images and scanned PDFs can't be read without AI: they return UNREADABLE.

import { Worker } from "node:worker_threads";
import { MAX_BRIEF_BYTES } from "../../../../shared/constants";
import { zipWithinLimits } from "./zip-limits";

// Largest brief file accepted through the API (Vercel functions cap request bodies at 4.5 MB in production; M7 revisits).
export { MAX_BRIEF_BYTES };

export type Extracted =
  | { ok: true; text: string }
  | { ok: false; reason: "UNREADABLE" | "UNSUPPORTED_TYPE" | "EMPTY" | "TOO_LARGE" };

/** A PDF with less real text than this is a scan (or a photo saved as PDF). */
const MIN_PDF_CHARS = 40;

const TEXT_EXTS = new Set(["txt", "text", "md", "markdown"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "heic", "heif", "gif", "bmp", "tif", "tiff"]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Kind = "pdf" | "docx" | "text" | "image" | "unsupported";

export async function extractBriefText(bytes: Uint8Array, fileName: string, mimeType: string): Promise<Extracted> {
  if (bytes.byteLength > MAX_BRIEF_BYTES) return { ok: false, reason: "TOO_LARGE" };
  if (bytes.byteLength === 0) return { ok: false, reason: "EMPTY" };
  const kind = detectKind(bytes, fileName, mimeType);
  try {
    switch (kind) {
      case "pdf":
        return await readPdf(bytes);
      case "docx":
        return await readDocx(bytes);
      case "text":
        return readPlainText(bytes);
      case "image":
        return { ok: false, reason: "UNREADABLE" };
      default:
        return { ok: false, reason: "UNSUPPORTED_TYPE" };
    }
  } catch {
    // Corrupt, truncated or password-protected files: the rules can't read them, so offer typing/manual.
    return { ok: false, reason: "UNREADABLE" };
  }
}

/**
 * A BMP file: "BM", then the file size (little-endian) and a header size a real BMP has. "BM" alone is
 * not enough — a text brief can start with a course code like "BMCS2203".
 */
function isBmp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(2, true);
  const header = view.getUint32(14, true);
  return size === bytes.byteLength && [12, 40, 52, 56, 64, 108, 124].includes(header);
}

/** File type from the content first (a renamed file still opens), then the extension, then the MIME type. */
function detectKind(bytes: Uint8Array, fileName: string, mimeType: string): Kind {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase() ?? "";
  const mime = mimeType.toLowerCase().split(";")[0]!.trim();
  const head = (n: number) => Array.from(bytes.subarray(0, n));
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);

  if (ascii(0, 1024).includes("%PDF-")) return "pdf";
  if (startsWith([0x89, 0x50, 0x4e, 0x47]) || startsWith([0xff, 0xd8, 0xff]) || ascii(0, 4) === "GIF8" || isBmp(bytes)) return "image";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|avif)$/.test(ascii(8, 12))) return "image";
  if (startsWith([0x49, 0x49, 0x2a, 0x00]) || startsWith([0x4d, 0x4d, 0x00, 0x2a])) return "image";
  // Old binary Office files (.doc, .ppt, .xls) share one container format.
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0])) return "unsupported";
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) {
    // A zip: .docx, .pptx, .xlsx, .odt… The central directory lists "word/document.xml" for Word files.
    if (ext === "docx" || mime === DOCX_MIME) return "docx";
    if (ext === "" && Buffer.from(bytes).includes("word/document.xml")) return "docx";
    return "unsupported";
  }
  if (head(5).join() === [0x7b, 0x5c, 0x72, 0x74, 0x66].join()) return "unsupported"; // {\rtf

  if (IMAGE_EXTS.has(ext) || (ext === "" && mime.startsWith("image/"))) return "image";
  if (ext === "pdf" || (ext === "" && mime === "application/pdf")) return "pdf";
  if (ext === "docx") return "docx";
  if (TEXT_EXTS.has(ext) || (ext === "" && (mime === "text/plain" || mime === "text/markdown"))) return "text";
  return "unsupported";
}

/** Common clean-up: line endings, stray control characters, trailing spaces, runs of blank lines. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    // The lookbehind starts one match per run: `[ \t]+$` alone rescans a long inner run from every position.
    .replace(/(?<![ \t])[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const nonSpaceChars = (s: string) => s.replace(/\s/g, "").length;

// ─── Worker ───────────────────────────────────────────────────────────────────

type WorkerResult =
  | { kind: "pdf"; pages: PdfItem[][] }
  | { kind: "html"; html: string }
  | { kind: "raw"; text: string };

/** What the worker parses: briefs (pdf, docx) and, since M6, evidence for the AI (pptx, xlsx too). */
type WorkerKind = "pdf" | "docx" | "pptx" | "xlsx";

/** Heap and time one extraction may use; a file that needs more is reported UNREADABLE. */
export const EXTRACT_LIMITS = { heapMb: 256, timeoutMs: 20_000 };
/** Extractions running at once; the rest wait, so a burst of uploads can't hold N × 256 MB. */
const MAX_RUNNING = 2;
let running = 0;
const waiting: (() => void)[] = [];

const WORKER_URL = new URL("./extract-worker.mjs", import.meta.url);

/** Parses a PDF, .docx, .pptx or .xlsx in a worker thread (extract-worker.mjs); rejects on a crash, the heap limit or the timeout. */
async function inWorker(kind: WorkerKind, bytes: Uint8Array): Promise<WorkerResult> {
  if (running >= MAX_RUNNING) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await runWorker(kind, bytes);
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function runWorker(kind: WorkerKind, bytes: Uint8Array): Promise<WorkerResult> {
  // A copy the worker owns (moved, not cloned); the caller keeps its own bytes.
  const copy = new Uint8Array(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, {
      workerData: { kind, bytes: copy },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: EXTRACT_LIMITS.heapMb, maxYoungGenerationSizeMb: 32 },
      // Keep the parent's loaders (tsx) out: the worker is plain JavaScript.
      execArgv: [],
    });
    let settled = false;
    const finish = (err: Error | null, result?: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (err) reject(err);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error("extraction timed out")), EXTRACT_LIMITS.timeoutMs);
    worker.on("message", (msg: { ok: boolean; result?: WorkerResult }) => {
      if (msg.ok && msg.result) finish(null, msg.result);
      else finish(new Error("extraction failed"));
    });
    worker.on("error", (err) => finish(err));
    worker.on("exit", (code) => finish(new Error(`extraction worker exited (${code})`)));
  });
}

// ─── Plain text ───────────────────────────────────────────────────────────────

function readPlainText(bytes: Uint8Array): Extracted {
  const decoded = decodeText(bytes);
  if (decoded === null) return { ok: false, reason: "UNSUPPORTED_TYPE" };
  const text = tidy(decoded);
  return text ? { ok: true, text } : { ok: false, reason: "EMPTY" };
}

/** UTF-8 (with or without BOM), UTF-16 with BOM, or GB18030/GBK (Chinese Windows Notepad). Null for binary data. */
function decodeText(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      text = new TextDecoder("gb18030", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("utf-8").decode(bytes);
    }
  }
  text = text.replace(/^\uFEFF/, "");
  const nuls = (text.match(/\u0000/g) ?? []).length;
  if (nuls > 0 && nuls > text.length / 100) return null;
  return text;
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

type PdfItem = { str: string; x: number; y: number; width: number; height: number; fontSize: number };

const CJK_END = /[\u3000-\u303F\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]$/;
const CJK_START = /^[\u3000-\u303F\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

async function readPdf(bytes: Uint8Array): Promise<Extracted> {
  const result = await inWorker("pdf", bytes);
  if (result.kind !== "pdf") throw new Error("unexpected worker result");
  const pages = result.pages.map((page) => pageText(page.filter((it) => it.str.trim() !== "")));
  const text = tidy(pages.filter((p) => p).join("\n\n"));
  if (nonSpaceChars(text) < MIN_PDF_CHARS) return { ok: false, reason: "UNREADABLE" };
  return { ok: true, text };
}

/**
 * Rebuilds one page's reading order: items grouped into lines by their baseline (top to bottom),
 * each line read left to right. Wide gaps become tabs (table columns), the left margin becomes
 * indentation (nested lists), and a tall gap between lines becomes a blank line (paragraphs).
 */
function pageText(items: PdfItem[]): string {
  if (items.length === 0) return "";
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; items: PdfItem[] }[] = [];
  for (const it of sorted) {
    const size = it.fontSize || it.height || 10;
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - it.y) <= Math.max(2, Math.min(line.size, size) * 0.45)) {
      line.items.push(it);
      line.size = Math.max(line.size, size);
    } else {
      lines.push({ y: it.y, size, items: [it] });
    }
  }
  const left = Math.min(...lines.map((l) => Math.min(...l.items.map((it) => it.x))));
  const out: string[] = [];
  let prev: { y: number; size: number } | null = null;
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let text = "";
    let end = 0;
    for (const it of line.items) {
      const str = it.str.replace(/\s+/g, " ");
      if (text) {
        const gap = it.x - end;
        if (gap > line.size * 1.5) text = `${text.trimEnd()}\t${str.trimStart()}`;
        else if (gap > line.size * 0.2 && !text.endsWith(" ") && !str.startsWith(" ") && !(CJK_END.test(text) && CJK_START.test(str))) {
          text += ` ${str}`;
        } else text += str;
      } else text = str;
      end = Math.max(end, it.x + it.width);
    }
    if (prev && prev.y - line.y > Math.max(prev.size, line.size) * 1.9) out.push("");
    const indent = Math.round((line.items[0]!.x - left) / (line.size * 0.5));
    out.push((indent >= 2 ? " ".repeat(Math.min(indent, 24)) : "") + text.trim());
    prev = line;
  }
  return out.join("\n");
}

// ─── Word ─────────────────────────────────────────────────────────────────────

async function readDocx(bytes: Uint8Array): Promise<Extracted> {
  if (!zipWithinLimits(bytes)) return { ok: false, reason: "UNREADABLE" };
  const result = await inWorker("docx", bytes);
  let text: string;
  let hasImages = false;
  if (result.kind === "html") {
    hasImages = /<img\b/i.test(result.html);
    text = htmlToText(result.html);
  } else if (result.kind === "raw") text = result.text;
  else throw new Error("unexpected worker result");
  text = tidy(text);
  if (!text) return { ok: false, reason: hasImages ? "UNREADABLE" : "EMPTY" };
  if (hasImages && nonSpaceChars(text) < MIN_PDF_CHARS) return { ok: false, reason: "UNREADABLE" };
  return { ok: true, text };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * mammoth's HTML → text the rule parser understands: list items get "1." or "•" and two spaces of
 * indent per nesting level, table rows become "cell | cell", headings stand on their own line.
 */
function htmlToText(html: string): string {
  const out: string[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  let line = "";
  let indent = "";
  let cells: string[] | null = null;
  let cell = "";
  const flush = () => {
    const t = line.replace(/[ \t]+/g, " ").trim();
    if (t) out.push(indent + t);
    line = "";
    indent = "";
  };
  for (const token of html.split(/(<[^>]+>)/)) {
    if (!token) continue;
    if (!token.startsWith("<")) {
      const text = decodeEntities(token);
      if (cells) cell += text;
      else line += text;
      continue;
    }
    const m = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(token);
    if (!m) continue;
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    if (cells && tag !== "tr" && tag !== "td" && tag !== "th" && tag !== "table") {
      if (tag === "p" || tag === "br" || tag === "li") cell += " ";
      continue;
    }
    switch (tag) {
      case "ol":
      case "ul":
        flush();
        if (closing) lists.pop();
        else lists.push({ ordered: tag === "ol", n: 0 });
        break;
      case "li":
        flush();
        if (!closing && lists.length) {
          const list = lists[lists.length - 1]!;
          list.n++;
          indent = "  ".repeat(lists.length - 1);
          line = `${list.ordered ? `${list.n}.` : "•"} `;
        }
        break;
      case "table":
        flush();
        if (!closing) out.push("");
        break;
      case "tr":
        if (closing && cells) {
          const row = cells.map((c) => c.replace(/\s+/g, " ").trim());
          if (row.some((c) => c)) out.push(row.join(" | "));
          cells = null;
        } else if (!closing) cells = [];
        break;
      case "td":
      case "th":
        if (!cells) cells = [];
        if (closing) {
          cells.push(cell);
          cell = "";
        }
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        flush();
        if (!closing) out.push("");
        break;
      case "p":
      case "br":
      case "div":
        flush();
        break;
      default:
        break;
    }
  }
  flush();
  return out.join("\n");
}

// ─── Evidence for the AI (M6 spec §6) ─────────────────────────────────────────

/**
 * Text of an evidence file the AI can't take as a file: Word (.docx), PowerPoint (.pptx), Excel (.xlsx)
 * and CSV. Same worker, heap, time and zip limits as briefs. Embedded images are not read. Legacy
 * .doc / .ppt / .xls and anything else → UNSUPPORTED_TYPE; a broken or hostile file → UNREADABLE.
 */
export async function extractEvidenceText(bytes: Uint8Array, ext: string): Promise<Extracted> {
  if (bytes.byteLength > MAX_BRIEF_BYTES) return { ok: false, reason: "TOO_LARGE" };
  if (bytes.byteLength === 0) return { ok: false, reason: "EMPTY" };
  try {
    switch (ext) {
      case "docx":
        return await readDocx(bytes);
      case "csv":
        return readPlainText(bytes);
      case "pptx":
      case "xlsx": {
        if (!zipWithinLimits(bytes)) return { ok: false, reason: "UNREADABLE" };
        const result = await inWorker(ext, bytes);
        if (result.kind !== "raw") throw new Error("unexpected worker result");
        const text = tidy(result.text);
        return text ? { ok: true, text } : { ok: false, reason: "EMPTY" };
      }
      default:
        return { ok: false, reason: "UNSUPPORTED_TYPE" };
    }
  } catch {
    return { ok: false, reason: "UNREADABLE" };
  }
}
