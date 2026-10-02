// What of an attempt's evidence the AI gets (M6 spec §6): PDF and images as files; Word, PowerPoint, Excel
// and CSV as text read by the extraction worker (lib/plan/extract.ts, with its limits); links as their URL
// text only — the server never fetches a link (SSRF). Embedded images inside Word / PowerPoint are not sent.
import type { Evidence } from "../../generated/prisma/client";
import { extractEvidenceText } from "../plan/extract";
import { getStorage } from "../storage";
import type { EvidencePiece } from "./prompts";

/** Text of one file the model gets at most (characters); longer text is cut with a note. */
export const MAX_EVIDENCE_TEXT_CHARS = 60_000;

const FILE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"]);

const extOf = (key: string) => /\.([a-z0-9]+)$/.exec(key)?.[1] ?? "";

export async function readStored(key: string): Promise<Uint8Array | null> {
  const obj = await getStorage().get(key);
  if (!obj) return null;
  const chunks: Uint8Array[] = [];
  const reader = obj.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * The pieces in hand-in order. `readable` counts pieces the model can actually look at (files and text,
 * not links or unreadable files).
 */
export async function readEvidence(items: Evidence[]): Promise<{ pieces: EvidencePiece[]; readable: number }> {
  const pieces: EvidencePiece[] = [];
  let readable = 0;
  for (const e of items) {
    if (e.kind === "LINK") {
      pieces.push({ kind: "link", url: e.url ?? e.name });
      continue;
    }
    const bytes = e.storageKey ? await readStored(e.storageKey).catch(() => null) : null;
    if (!bytes) {
      pieces.push({ kind: "unreadable", name: e.name });
      continue;
    }
    const mime = e.mimeType ?? "";
    if (FILE_TYPES.has(mime)) {
      pieces.push({ kind: "file", name: e.name, mimeType: mime, bytes });
      readable++;
      continue;
    }
    const text = await extractEvidenceText(bytes, extOf(e.storageKey!));
    if (!text.ok) {
      pieces.push({ kind: "unreadable", name: e.name });
      continue;
    }
    const cut = text.text.length > MAX_EVIDENCE_TEXT_CHARS;
    pieces.push({
      kind: "text",
      name: e.name,
      text: cut ? text.text.slice(0, MAX_EVIDENCE_TEXT_CHARS) : text.text,
      note: cut ? "only the first part; the file is longer" : undefined,
    });
    readable++;
  }
  return { pieces, readable };
}
