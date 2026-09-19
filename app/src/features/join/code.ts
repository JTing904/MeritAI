/**
 * What the code field keeps from typed or pasted text: a pasted invite link keeps only its last
 * segment (meritai://join/CS302-7Q4P → CS302-7Q4P); spaces go and letters are upper-cased
 * (the server also matches case-insensitively and ignores spaces).
 */
export function normalizeCode(text: string): string {
  const last = text.trim().split('/').filter(Boolean).pop() ?? '';
  let segment = last;
  try {
    segment = decodeURIComponent(last);
  } catch {
    // Not URI-encoded after all: keep it as typed.
  }
  return segment.replace(/\s+/g, '').toUpperCase();
}

/** Invite codes look like CS302-7Q4P: a 1–6 character prefix, a dash, 4 characters. */
export function looksComplete(code: string): boolean {
  return /^[A-Z0-9]{1,6}-[A-Z0-9]{4}$/.test(code);
}
