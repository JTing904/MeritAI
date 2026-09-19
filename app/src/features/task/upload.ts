// Evidence files: picking one, the multipart body, and how a row describes a file or link (M4 spec §4).
import { MAX_EVIDENCE_FILE_BYTES } from '@shared/constants';
import type { EvidenceKind, EvidenceView } from '@shared/types';
import { briefForm, formatBytes, pickBriefFile, type PickedFile } from '@/features/wizard/upload';
import type { Messages } from '@/i18n/zh';
import { toAsciiHost } from './punycode';

export type { PickedFile };

/** Checked before uploading (toast t.errors.FILE_TOO_LARGE) so a big file isn't sent just to be refused. */
export const EVIDENCE_MAX_BYTES = MAX_EVIDENCE_FILE_BYTES;

/** Any file type: the server explains a wrong one (FILE_TYPE_UNSUPPORTED) better than a greyed-out picker. */
export function pickEvidenceFile(): Promise<PickedFile | null> {
  return pickBriefFile();
}

/** Multipart body: field "file" plus "fileName" (the original name in UTF-8), wrapped like the brief upload. */
export function evidenceForm(f: PickedFile): FormData {
  return briefForm(f);
}

export type FileFamily = keyof Messages['labels']['fileType'];

const EXT_FAMILY: Record<string, FileFamily> = {
  doc: 'word',
  docx: 'word',
  pdf: 'pdf',
  ppt: 'ppt',
  pptx: 'ppt',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  heic: 'image',
  heif: 'image',
  gif: 'image',
  xls: 'excel',
  xlsx: 'excel',
  csv: 'csv',
};

/** Word / PDF / PPT / image / Excel / CSV, from the stored (sniffed) MIME type first, then the extension. */
export function fileFamily(name: string, mimeType: string | null): FileFamily {
  const mime = mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/csv') return 'csv';
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'word';
  if (mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint') return 'ppt';
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return 'excel';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return EXT_FAMILY[ext] ?? 'file';
}

/** Word / PDF / PPT / 图片 / Excel / CSV / 文件 (en Word / PDF / PowerPoint / Image / Excel / CSV / File). */
export function fileTypeLabel(name: string, mimeType: string | null, t: Pick<Messages, 'labels'>): string {
  return t.labels.fileType[fileFamily(name, mimeType)];
}

/** 📄 documents (Word, PDF, PPT, other files), 🖼️ images, 📊 Excel / CSV, 🔗 links. */
export function evidenceEmoji(kind: EvidenceKind, name: string, mimeType: string | null): string {
  if (kind === 'LINK') return '🔗';
  const family = fileFamily(name, mimeType);
  if (family === 'image') return '🖼️';
  if (family === 'excel' || family === 'csv') return '📊';
  return '📄';
}

/**
 * forms.gle from https://forms.gle/8kQp2 (a regex: React Native's URL has no hostname). Non-ASCII names show
 * in punycode (xn--…), so a look-alike can't pass for a real site. Null when it isn't a URL.
 */
export function linkHost(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url.trim());
  return m ? toAsciiHost(m[1]!).replace(/^www\./, '') : null;
}

/** The row's second line: `1.8 MB · Word` / `640 KB · 图片` for a file, `网址 · forms.gle` for a link. */
export function evidenceMeta(evidence: Pick<EvidenceView, 'kind' | 'name' | 'url' | 'sizeBytes' | 'mimeType'>, t: Pick<Messages, 'labels'>): string {
  if (evidence.kind === 'LINK') return t.labels.linkMeta(linkHost(evidence.url ?? '') ?? evidence.name);
  const type = fileTypeLabel(evidence.name, evidence.mimeType, t);
  return evidence.sizeBytes === null ? type : `${formatBytes(evidence.sizeBytes)} · ${type}`;
}
