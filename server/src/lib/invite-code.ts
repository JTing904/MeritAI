import { randomInt } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";

/** No 0/O or 1/I: codes are read aloud and typed from screenshots. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PREFIX_MAX = 6;
const SUFFIX_LENGTH = 4;
const MAX_ATTEMPTS = 20;

export function randomCodeChars(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** "cs-302" → "CS302"; nothing usable (e.g. only Chinese characters) → 6 random characters. */
export function codePrefix(shortCode: string | null | undefined): string {
  const cleaned = (shortCode ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, PREFIX_MAX);
  return cleaned || randomCodeChars(PREFIX_MAX);
}

/** e.g. "CS302-7Q4P". */
export function makeInviteCode(shortCode: string | null | undefined): string {
  return `${codePrefix(shortCode)}-${randomCodeChars(SUFFIX_LENGTH)}`;
}

/** What people type or paste: any case, stray spaces, full-width characters from a Chinese keyboard. */
export function normalizeInviteCode(input: string): string {
  return input.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

/** Key of the Postgres advisory lock that serialises invite-code allocation. */
const ALLOCATE_LOCK_KEY = 730_917_302n;

/**
 * A code no project uses now or used before (retired codes must keep answering "expired"). Call it
 * inside the transaction that writes the code: the advisory lock (held until that transaction ends)
 * makes check-then-write safe, so two projects confirming at the same moment can't both pick the same
 * free code; the second waits and then sees the first one's code as taken.
 */
export async function allocateInviteCode(
  db: Prisma.TransactionClient,
  shortCode: string | null,
  nextCode: () => string = () => makeInviteCode(shortCode),
): Promise<string> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${ALLOCATE_LOCK_KEY})`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = nextCode();
    // Sequential on purpose: inside an interactive transaction the queries share one connection.
    const live = await db.project.findUnique({ where: { inviteCode: code }, select: { id: true } });
    if (live) continue;
    const retired = await db.retiredInviteCode.findUnique({ where: { code }, select: { code: true } });
    if (!retired) return code;
  }
  throw new Error("Could not find a free invite code");
}
