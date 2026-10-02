// Leaders' AI keys at rest (M6 spec §1): AES-256-GCM with a random 12-byte IV and the 16-byte auth tag,
// keyed by AI_KEY_SECRET (32 random bytes, base64 or base64url). The user's id is the additional
// authenticated data, so a cipher copied onto another account doesn't decrypt. Stored as
// "v1:<base64(iv | tag | ciphertext)>". The plain key only ever exists in memory while a call is made.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isProductionLike } from "../dev-gate";

const PREFIX = "v1:";
/** Development and tests only: a fixed secret, so keys saved locally survive restarts. Never in production. */
const DEV_SECRET = Buffer.alloc(32, "meritai-dev-ai-key-secret");

let cached: Buffer | null = null;
let warned = false;

/** AI_KEY_SECRET decoded to 32 bytes, or null when unset or malformed. */
export function parseSecret(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  const bytes = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return bytes.length === 32 ? bytes : null;
}

/**
 * Throws (the server must not start) in production without a valid AI_KEY_SECRET. createApp calls it, so
 * every entry point checks it before serving anything.
 */
export function assertAiSecretInProduction(env: Record<string, string | undefined> = process.env): void {
  if (isProductionLike(env) && parseSecret(env.AI_KEY_SECRET) === null) {
    throw new Error(
      "AI_KEY_SECRET must be set to 32 random bytes (base64) in production: it encrypts leaders' AI keys. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
}

function secret(): Buffer {
  if (cached) return cached;
  const parsed = parseSecret(process.env.AI_KEY_SECRET);
  if (parsed) {
    cached = parsed;
    return parsed;
  }
  assertAiSecretInProduction();
  if (!warned && process.env.AI_KEY_SECRET?.trim()) console.warn("AI_KEY_SECRET is not 32 bytes of base64; using the development secret");
  else if (!warned && !process.env.VITEST) console.warn("AI_KEY_SECRET is not set; using the development secret (never do this in production)");
  warned = true;
  cached = DEV_SECRET;
  return cached;
}

/** Tests: read AI_KEY_SECRET again. */
export function resetAiSecretForTests(): void {
  cached = null;
}

export function encryptKey(plain: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** The plain key, or null when the cipher is malformed, tampered with, or from another secret / account. */
export function decryptKey(stored: string, userId: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    if (raw.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv("aes-256-gcm", secret(), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(userId, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The last 4 characters shown on the 我 page. */
export const last4 = (key: string): string => key.trim().slice(-4);
