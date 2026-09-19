import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import { Platform } from 'react-native';
import { MAX_BRIEF_BYTES } from '@shared/constants';

export type PickedFile = {
  name: string;
  size: number | null;
  mimeType: string | null;
  uri: string;
  /** Web only: the browser File to upload. */
  file?: File;
};

/** Checked before uploading so an 18 MB scan isn't sent over mobile data just to be refused. */
export const BRIEF_MAX_BYTES = MAX_BRIEF_BYTES;

/** Any file type: the server explains unsupported ones (UNSUPPORTED_TYPE) better than a greyed-out picker. */
export async function pickBriefFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  return {
    name: asset.name,
    size: asset.size ?? asset.file?.size ?? null,
    mimeType: asset.mimeType ?? asset.file?.type ?? null,
    uri: asset.uri,
    file: asset.file,
  };
}

/**
 * Multipart body: field "file" plus "fileName" (the original name, UTF-8 in the body — multipart
 * headers may percent-encode or reject non-ASCII names like 「作业说明.pdf」).
 * Native: Expo's fetch only accepts Blob-like parts, not RN's {uri,name,type}, so the picked file is
 * wrapped in expo-file-system's File (which implements Blob). Web: the browser File itself.
 */
export function briefForm(f: PickedFile): FormData {
  const form = new FormData();
  if (Platform.OS === 'web' && f.file) form.append('file', f.file, f.name);
  else form.append('file', new FsFile(f.uri) as unknown as Blob, f.name);
  form.append('fileName', f.name);
  return form;
}

/** 2.1 MB / 340 KB / 10 MB */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

export type FileSort = 'image' | 'pdf' | 'other';

export function fileSort(name: string | null, mimeType?: string | null): FileSort {
  const ext = name?.toLowerCase().split('.').pop() ?? '';
  if (mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif'].includes(ext)) return 'image';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'other';
}
