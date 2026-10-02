// Keys never reach a log line (M6 spec §1): anything logged about a provider call goes through here.

const HEADER_NAMES = ["x-goog-api-key", "authorization", "x-api-key"];

/** Key-shaped strings: Google (AIza…), OpenAI (sk-…, sk-proj-…), Anthropic (sk-ant-…). */
const KEY_PATTERNS = [/AIza[0-9A-Za-z_-]{20,}/g, /sk-ant-[0-9A-Za-z_-]{10,}/g, /sk-[0-9A-Za-z_-]{16,}/g];

/** Removes `secrets` (the key in use) and anything key-shaped from `text`, and caps its length. */
export function redact(text: string, secrets: (string | null | undefined)[] = [], max = 300): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  for (const re of KEY_PATTERNS) out = out.replace(re, "[redacted]");
  // "x-goog-api-key: …", "Authorization: Bearer …" in echoed request dumps.
  for (const name of HEADER_NAMES) out = out.replace(new RegExp(`(${name}["']?\\s*[:=]\\s*["']?)[^"'\\s,}]+`, "gi"), "$1[redacted]");
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** A plain copy of request headers with the key headers blanked, for debugging output. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, HEADER_NAMES.includes(k.toLowerCase()) ? "[redacted]" : v]));
}
