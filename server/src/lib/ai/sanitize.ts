// Model output is validated by zod, then clamped here (M6 spec §2): lengths, counts and numbers never
// exceed what the rest of the app accepts, whatever the model sent.

/** Whitespace collapsed, control characters dropped, cut to `max` characters (with an ellipsis). */
export function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const s = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Non-empty items, each clamped, at most `maxItems`. */
export function cleanList(values: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    const s = clampText(v, maxChars).replace(/\s*\n\s*/g, " ");
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** A finite number within [min, max]; `fallback` for anything else. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Titles of tasks, milestones and features match the rules parser's limit. */
export const MAX_AI_TITLE = 120;
