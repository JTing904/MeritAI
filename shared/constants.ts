// Constants shared by the server and the app.

/** Highlighter ("荧光笔") colour names, in assignment order. The first six come from the prototype. */
export const HIGHLIGHTERS = ['lemon', 'gum', 'mint', 'sky', 'tang', 'lilac', 'lime', 'aqua'] as const;
export type Highlighter = (typeof HIGHLIGHTERS)[number];

/** A stable colour for a person outside any project (profile avatar), derived from their id. */
export function profileColor(userId: string): Highlighter {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return HIGHLIGHTERS[h % HIGHLIGHTERS.length]!;
}

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Largest brief file (wizard step 2 upload). The app checks it before uploading; the server enforces it. */
export const MAX_BRIEF_BYTES = 10 * 1024 * 1024;
