// Name and tag formatting shared by the server (notification payloads, views) and the app.

// Han characters (CJK Unified Ideographs, Extension A, compatibility ideographs). Written as ranges
// rather than \p{Script=Han} so it works on every JS engine the app runs on.
const HAN = /^[㐀-䶿一-鿿豈-﫿]+$/;

/**
 * The short name used in greetings and the feed: Chinese names of 2–4 Han characters drop the
 * surname (陈思远 → 思远); anything else uses the first word (Aisyah binti Ahmad → Aisyah).
 */
export function givenName(fullName: string): string {
  const name = fullName.trim();
  const chars = Array.from(name);
  if (chars.length >= 2 && chars.length <= 4 && HAN.test(name)) return chars.slice(1).join('');
  return name.split(/\s+/)[0] || name;
}

/** The project tag (card tag, notification meta): the short code, or the first few characters of the name. */
export function projectTag(name: string, shortCode: string | null): string {
  const code = shortCode?.trim();
  if (code) return code;
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  if (chars[0] && HAN.test(chars[0])) return chars.slice(0, 4).join('');
  return Array.from(trimmed.split(/\s+/)[0] ?? '')
    .slice(0, 8)
    .join('');
}
