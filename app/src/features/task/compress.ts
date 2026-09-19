// Photos are shrunk to ≤ 500 KB before they are uploaded as evidence (REQUIREMENTS §13 「文件空间」).
import { requireOptionalNativeModule } from 'expo';
import { File as FsFile } from 'expo-file-system';
import { Platform } from 'react-native';
import { fileSort, type PickedFile } from '@/features/wizard/upload';

/** What a photo is compressed to (at most). */
export const PHOTO_TARGET_BYTES = 500 * 1024;

// Tried in order until one is small enough: the longest side in pixels and the JPEG quality.
const STEPS = [
  { side: 2048, quality: 0.8 },
  { side: 1600, quality: 0.7 },
  { side: 1280, quality: 0.6 },
  { side: 1024, quality: 0.5 },
  { side: 800, quality: 0.45 },
];

type Manipulator = typeof import('expo-image-manipulator');

/**
 * expo-image-manipulator is a native module: an APK built before it was added doesn't have it, and importing
 * it there would throw. Load it only when it exists (on the web it runs on a canvas).
 */
function loadManipulator(): Manipulator | null {
  if (Platform.OS !== 'web' && !requireOptionalNativeModule('ExpoImageManipulator')) return null;
  try {
    return require('expo-image-manipulator') as Manipulator;
  } catch {
    return null;
  }
}

/** A photo worth compressing: an image, but not an animated GIF. */
export function isPhoto(f: Pick<PickedFile, 'name' | 'mimeType'>): boolean {
  const gif = f.mimeType === 'image/gif' || /\.gif$/i.test(f.name);
  return !gif && fileSort(f.name, f.mimeType) === 'image';
}

/** A photo that will be compressed before it is sent (so the row can say 正在压缩照片…). */
export const needsCompressing = (f: PickedFile): boolean => isPhoto(f) && (f.size === null || f.size > PHOTO_TARGET_BYTES);

const jpgName = (name: string) => `${name.replace(/\.[^./\\]+$/, '') || 'photo'}.jpg`;

async function asPicked(uri: string, name: string): Promise<PickedFile> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const file = new File([blob], name, { type: 'image/jpeg' });
    return { name, size: blob.size, mimeType: 'image/jpeg', uri, file };
  }
  return { name, size: new FsFile(uri).size ?? null, mimeType: 'image/jpeg', uri };
}

/**
 * The photo as a JPEG of at most 500 KB (smaller sides and quality until it fits). Anything that isn't a big
 * photo, or can't be decoded here (HEIC in a browser, an APK without the module), is returned unchanged:
 * the server still enforces its own limits.
 */
export async function compressPhoto(f: PickedFile): Promise<PickedFile> {
  if (!needsCompressing(f)) return f;
  const lib = loadManipulator();
  if (!lib) return f;
  try {
    const { ImageManipulator, SaveFormat } = lib;
    const original = await ImageManipulator.manipulate(f.uri).renderAsync();
    const wide = original.width >= original.height;
    const longest = Math.max(original.width, original.height);
    let best: PickedFile | null = null;
    for (const step of STEPS) {
      const ctx = ImageManipulator.manipulate(original);
      if (longest > step.side) ctx.resize(wide ? { width: step.side } : { height: step.side });
      const image = await ctx.renderAsync();
      const saved = await image.saveAsync({ compress: step.quality, format: SaveFormat.JPEG });
      best = await asPicked(saved.uri, jpgName(f.name));
      if (best.size !== null && best.size <= PHOTO_TARGET_BYTES) break;
    }
    // Never send something bigger than what was picked.
    if (!best || best.size === null || (f.size !== null && best.size >= f.size)) return f;
    return best;
  } catch (err) {
    if (__DEV__) console.warn('[compress] kept the original photo:', err);
    return f;
  }
}
