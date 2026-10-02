// Google Gemini (REST v1beta, M6 spec §2). The only provider tested with a real key (tests/ai-live.test.ts).
import { jsonSchemaOf, parseJsonText, toGeminiSchema } from "./schema";
import { b64, httpError, send, type ProviderResponse } from "./http";
import { goodChain, lightModel } from "./usage";
import { AiError, type AiProvider, type AiTier, type GenerateInput, type GenerateResult } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Types Gemini takes inline (PDF and images; HEIC/HEIF included). */
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

type GeminiError = { error?: { status?: string; message?: string; details?: { reason?: string }[] } };

function classify(res: ProviderResponse, key: string): AiError {
  const err = (res.body as GeminiError | null)?.error;
  const reasons = (err?.details ?? []).map((d) => d.reason);
  // 429 RESOURCE_EXHAUSTED is both the per-minute and the per-day limit; the quota id tells them apart
  // ("…PerMinute…" waits and retries, anything else counts as the day's quota being gone).
  if (res.status === 429 || err?.status === "RESOURCE_EXHAUSTED") {
    return httpError(/PerMinute/i.test(res.text) ? "TRANSIENT" : "QUOTA", "gemini", res, key);
  }
  if (res.status === 404 || err?.status === "NOT_FOUND") return httpError("MODEL_GONE", "gemini", res, key);
  if (res.status === 401 || res.status === 403 || reasons.includes("API_KEY_INVALID") || err?.status === "PERMISSION_DENIED" || err?.status === "UNAUTHENTICATED") {
    return httpError("INVALID", "gemini", res, key);
  }
  if (res.status === 400 && /api key/i.test(err?.message ?? "")) return httpError("INVALID", "gemini", res, key);
  if (res.status >= 500 || res.status === 408) return httpError("TRANSIENT", "gemini", res, key);
  // Any other 400 (a request the model refused, an unsupported file): retrying the same thing won't help much,
  // but the job's retry limit bounds it.
  return httpError("BAD_OUTPUT", "gemini", res, key);
}

type Candidate = { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string };

export const gemini: AiProvider = {
  name: "GEMINI",
  model(tier: AiTier) {
    return tier === "good" ? goodChain("GEMINI")[0]! : lightModel("GEMINI");
  },
  async checkKey(key) {
    const res = await send(`${BASE}/models?pageSize=1`, { method: "GET", headers: { "x-goog-api-key": key }, timeoutMs: 15_000 }, key);
    if (res.status !== 200) throw classify(res, key);
  },
  async generate<T>(key: string, input: GenerateInput<T>): Promise<GenerateResult<T>> {
    const model = input.model;
    const parts = input.parts.map((p) =>
      "text" in p
        ? { text: p.text }
        : INLINE.has(p.mimeType)
          ? { inline_data: { mime_type: p.mimeType, data: b64(p.bytes) } }
          : { text: `[${p.name}: this file type can't be sent to the model]` },
    );
    const res = await send(
      `${BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key },
        body: {
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(jsonSchemaOf(input.schema)),
            maxOutputTokens: input.maxOutputTokens,
            temperature: 0.2,
          },
        },
        timeoutMs: input.tier === "good" ? 120_000 : 90_000,
      },
      key,
    );
    if (res.status !== 200) throw classify(res, key);
    const body = res.body as { candidates?: Candidate[]; modelVersion?: string; promptFeedback?: { blockReason?: string } } | null;
    const candidate = body?.candidates?.[0];
    if (!candidate) throw new AiError("BAD_OUTPUT", `gemini: no answer (${body?.promptFeedback?.blockReason ?? "empty"})`);
    if (candidate.finishReason && candidate.finishReason !== "STOP") throw new AiError("BAD_OUTPUT", `gemini: finishReason ${candidate.finishReason}`);
    const text = (candidate.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    let json: unknown;
    try {
      json = parseJsonText(text);
    } catch {
      throw new AiError("BAD_OUTPUT", "gemini: the answer was not JSON");
    }
    const parsed = input.schema.safeParse(json);
    if (!parsed.success) throw new AiError("BAD_OUTPUT", `gemini: the answer didn't match the schema (${parsed.error.issues[0]?.message ?? "?"})`);
    return { data: parsed.data, model: body?.modelVersion ?? model };
  },
};
