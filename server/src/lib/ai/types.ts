// The one interface every AI provider implements (M6 spec §2).
import type { z } from "zod";
import type { AiProviderName } from "../../../../shared/constants";

export type AiTier = "light" | "good";

/** A text block, or a file sent as-is (PDF and images). */
export type AiPart = { text: string } | { mimeType: string; bytes: Uint8Array; name: string };

/** What the request is for: providers ignore it; the mock provider answers by it. */
/** brief-fix: the one light call that translates strings of a brief analysis into the project's language. */
export type AiPurpose = "brief" | "brief-fix" | "howto" | "grade" | "check";

export type GenerateInput<T> = {
  tier: AiTier;
  /** The model id to call (lib/ai/usage.ts lightModel / goodChain). */
  model: string;
  system: string;
  parts: AiPart[];
  /** Validates (and types) the answer. Its JSON schema also goes to the provider as structured output. */
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  purpose: AiPurpose;
};

export type GenerateResult<T> = {
  data: T;
  /** The model that answered, as the provider reports it (e.g. "gemini-3.8-flash"), else the id asked for. */
  model: string;
};

/**
 * QUOTA: this model's quota is used up (daily); INVALID: the key was refused; TRANSIENT: try again later
 * (5xx, timeout, network, a per-minute limit); BAD_OUTPUT: the answer didn't parse or validate (retried
 * like TRANSIENT); MODEL_GONE: the provider doesn't know the model id (404), so it is skipped.
 */
export type AiErrorKind = "QUOTA" | "INVALID" | "TRANSIENT" | "BAD_OUTPUT" | "MODEL_GONE";

/** Never carries the key: messages are built from the status and a redacted, shortened body. */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiProvider {
  readonly name: AiProviderName;
  /** One cheap call (list models). Throws AiError INVALID / TRANSIENT / QUOTA. */
  checkKey(key: string): Promise<void>;
  generate<T>(key: string, input: GenerateInput<T>): Promise<GenerateResult<T>>;
  /** The model a tier starts with (light: the light model; good: the first of the chain). */
  model(tier: AiTier): string;
}
