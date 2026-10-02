// Which provider serves a key (M6 spec §2). AI_MOCK=1 swaps every provider for the mock (tests and
// development only: a production process with AI_MOCK set refuses to start, see assertAiConfig).
import type { AiProviderName } from "../../../../shared/constants";
import { isProductionLike } from "../dev-gate";
import { claude } from "./claude";
import { assertAiSecretInProduction } from "./crypto";
import { gemini } from "./gemini";
import { mockProvider } from "./mock";
import { openai } from "./openai";
import type { AiProvider } from "./types";

export const aiMockEnabled = (env: Record<string, string | undefined> = process.env): boolean => {
  const v = env.AI_MOCK?.trim().toLowerCase();
  return v === "1" || v === "true";
};

/** Throws (the server must not start) on AI settings that must never reach production. */
export function assertAiConfig(env: Record<string, string | undefined> = process.env): void {
  if (aiMockEnabled(env) && isProductionLike(env)) throw new Error("AI_MOCK must not be set in production. Remove it and redeploy.");
  assertAiSecretInProduction(env);
}

const REAL: Record<AiProviderName, AiProvider> = { GEMINI: gemini, CLAUDE: claude, OPENAI: openai };

/** The provider for a key of this kind (the real one, whatever AI_MOCK says, with `real: true`: the live test). */
export function providerFor(name: AiProviderName, opts: { real?: boolean } = {}): AiProvider {
  if (!opts.real && aiMockEnabled()) {
    if (isProductionLike()) throw new Error("AI_MOCK is refused in production");
    return mockProvider(name);
  }
  return REAL[name];
}
