// One model call for a job (M6 spec §2 and the owner's model chain, REQUIREMENTS §13 2026-09-23): the
// leader's key, the models to try in order, each model's daily limit and per-minute pacing, the usage
// counter, and the provider's errors turned into what the job does next.
//
// Light work tries the light model only. Grading walks the good chain smartest first (Gemini 3.8 → 3.7 →
// 3.6 → 3.5 Flash), then, with `lightFallback`, the light model: a model at its daily limit is skipped
// without a call; a 429 (QUOTA) marks it used up for the rest of its day and the next one is tried; a model
// the provider doesn't know (404) is skipped (logged once per process). A model with quota left but no slot
// this minute makes the job wait for it rather than spend a less capable model's quota.
import type { AiProviderName } from "../../../shared/constants";
import type { AiFailReason } from "../../../shared/types";
import { providerFor } from "../lib/ai";
import { redact } from "../lib/ai/redact";
import { AiError, type AiPart, type AiPurpose, type AiTier } from "../lib/ai/types";
import { dailyLimit, goodChain, lightModel, markExhausted, recordCall, takeSlot, usedToday } from "../lib/ai/usage";
import type { Db } from "../lib/db";
import type { z } from "zod";
import { plainKey, type AiUser } from "./ai-key";

export type CallRequest<T> = {
  purpose: AiPurpose;
  /** light: the light model. good: the good chain (then the light model with `lightFallback`). */
  tier: AiTier;
  lightFallback?: boolean;
  system: string;
  parts: AiPart[];
  schema: z.ZodType<T>;
  maxOutputTokens: number;
};

export type CallOutcome<T> =
  | { kind: "ok"; data: T; model: string; provider: AiProviderName; tier: AiTier }
  /** No slot this minute: run the job again at `until` (not counted as a try). */
  | { kind: "wait"; until: Date }
  /** `retry`: worth trying again later (a transient error); otherwise final. */
  | { kind: "fail"; reason: AiFailReason; retry: boolean; detail: string };

/** Models the provider said don't exist ("<provider>:<model>"), skipped until the process restarts. */
const gone = new Set<string>();

/** Tests: forget the models marked gone. */
export function resetGoneModels(): void {
  gone.clear();
}

/** The models to try, in order, each with its tier. */
export function modelsFor(provider: AiProviderName, tier: AiTier, lightFallback: boolean): { model: string; tier: AiTier }[] {
  const light = { model: lightModel(provider), tier: "light" as const };
  if (tier === "light") return [light];
  const chain = goodChain(provider).map((model) => ({ model, tier: "good" as const }));
  return lightFallback ? [...chain, light] : chain;
}

export async function callModel<T>(db: Db, leader: AiUser | null, req: CallRequest<T>, now: Date): Promise<CallOutcome<T>> {
  if (!leader) return { kind: "fail", reason: "NO_KEY", retry: false, detail: "no leader" };
  const plain = plainKey(leader);
  if (!plain) return { kind: "fail", reason: "NO_KEY", retry: false, detail: "no key" };
  const { provider, key } = plain;
  const ai = providerFor(provider);
  const used = await usedToday(db, leader.id, provider, now);
  let lastQuota = "every model's daily limit is reached";
  let lastTransient: string | null = null;

  for (const { model, tier } of modelsFor(provider, req.tier, req.lightFallback ?? false)) {
    if (gone.has(`${provider}:${model}`)) continue;
    const limit = dailyLimit(provider, model);
    if (limit !== null && (used.get(model) ?? 0) >= limit) continue;

    const slot = await takeSlot(db, leader.id, provider, model, now);
    if (!slot.ok) return { kind: "wait", until: slot.retryAt };
    await recordCall(db, leader.id, provider, model, now);
    try {
      const res = await ai.generate(key, {
        tier,
        model,
        system: req.system,
        parts: req.parts,
        schema: req.schema,
        maxOutputTokens: req.maxOutputTokens,
        purpose: req.purpose,
      });
      return { kind: "ok", data: res.data, model: res.model, provider, tier };
    } catch (err) {
      if (!(err instanceof AiError)) {
        console.error("ai: unexpected error from the provider", redact(String((err as Error)?.message ?? err), [key]));
        return { kind: "fail", reason: "ERROR", retry: true, detail: "unexpected error" };
      }
      const detail = redact(err.message, [key]);
      if (err.kind === "QUOTA") {
        // This model is used up for today; the next one in the chain may still have quota.
        await markExhausted(db, leader.id, provider, model, now);
        used.set(model, Math.max(used.get(model) ?? 0, limit ?? 0));
        lastQuota = detail;
        continue;
      }
      if (err.kind === "MODEL_GONE") {
        if (!gone.has(`${provider}:${model}`)) console.warn(`ai: ${provider} doesn't know the model ${model}; skipping it`);
        gone.add(`${provider}:${model}`);
        continue;
      }
      if (err.kind === "INVALID") return { kind: "fail", reason: "INVALID", retry: false, detail };
      // Busy (503) or a passing error on this model: try the next one in the chain now; only when every
      // model failed is the job retried later.
      console.warn(`ai: ${req.purpose} call to ${model} failed (${err.kind}); trying the next model`, detail);
      lastTransient = detail;
      continue;
    }
  }
  if (lastTransient !== null) return { kind: "fail", reason: "ERROR", retry: true, detail: lastTransient };
  return { kind: "fail", reason: "QUOTA", retry: false, detail: lastQuota };
}
