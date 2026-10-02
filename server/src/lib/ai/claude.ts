// Anthropic Claude (REST Messages API, M6 spec §2). 测试版: written from the docs, not tried with a real key.
// Plain fetch on purpose (the leader's own key per request, no SDK dependency). Structured output: one tool
// whose input_schema is the answer's JSON schema, forced with tool_choice. The default models accept a
// forced tool; if an env override picks a model that refuses it, the 400 fails the job (ERROR).
import { jsonSchemaOf } from "./schema";
import { b64, httpError, send, type ProviderResponse } from "./http";
import { goodChain, lightModel } from "./usage";
import { AiError, type AiProvider, type AiTier, type GenerateInput, type GenerateResult } from "./types";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";
const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TOOL = "submit_result";

type ClaudeError = { error?: { type?: string; message?: string } };

function classify(res: ProviderResponse, key: string): AiError {
  const err = (res.body as ClaudeError | null)?.error;
  if (res.status === 404 || err?.type === "not_found_error") return httpError("MODEL_GONE", "claude", res, key);
  if (res.status === 401 || res.status === 403 || err?.type === "authentication_error" || err?.type === "permission_error") {
    return httpError("INVALID", "claude", res, key);
  }
  // 402 billing_error, or "credit balance is too low" on a 400: the account has nothing left to spend.
  if (res.status === 402 || err?.type === "billing_error" || /credit balance/i.test(err?.message ?? "")) return httpError("QUOTA", "claude", res, key);
  // 429 is Anthropic's per-minute rate limit, not a daily quota: wait and retry.
  if (res.status === 429 || res.status === 529 || res.status >= 500 || res.status === 408) return httpError("TRANSIENT", "claude", res, key);
  return httpError("BAD_OUTPUT", "claude", res, key);
}

export const claude: AiProvider = {
  name: "CLAUDE",
  model(tier: AiTier) {
    return tier === "good" ? goodChain("CLAUDE")[0]! : lightModel("CLAUDE");
  },
  async checkKey(key) {
    const res = await send(`${BASE}/models?limit=1`, { method: "GET", headers: { "x-api-key": key, "anthropic-version": VERSION }, timeoutMs: 15_000 }, key);
    if (res.status !== 200) throw classify(res, key);
  },
  async generate<T>(key: string, input: GenerateInput<T>): Promise<GenerateResult<T>> {
    const model = input.model;
    // Files first, then the text (the documented order for PDFs and images).
    const files = input.parts.flatMap((p): Record<string, unknown>[] => {
      if ("text" in p) return [];
      if (p.mimeType === "application/pdf") return [{ type: "document", source: { type: "base64", media_type: p.mimeType, data: b64(p.bytes) } }];
      if (IMAGES.has(p.mimeType)) return [{ type: "image", source: { type: "base64", media_type: p.mimeType, data: b64(p.bytes) } }];
      return [{ type: "text", text: `[${p.name}: this file type can't be sent to the model]` }];
    });
    const texts = input.parts.flatMap((p) => ("text" in p ? [{ type: "text", text: p.text }] : []));
    const res = await send(
      `${BASE}/messages`,
      {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": VERSION },
        body: {
          model,
          // Non-streaming requests stay under ~16K output tokens (longer ones risk HTTP timeouts).
          max_tokens: Math.min(input.maxOutputTokens, 16_000),
          system: input.system,
          messages: [{ role: "user", content: [...files, ...texts] }],
          tools: [{ name: TOOL, description: "Submit the answer in exactly this structure.", input_schema: jsonSchemaOf(input.schema) }],
          tool_choice: { type: "tool", name: TOOL },
        },
        timeoutMs: input.tier === "good" ? 120_000 : 90_000,
      },
      key,
    );
    if (res.status !== 200) throw classify(res, key);
    const body = res.body as { content?: { type: string; name?: string; input?: unknown }[]; stop_reason?: string; model?: string } | null;
    if (body?.stop_reason === "max_tokens") throw new AiError("BAD_OUTPUT", "claude: the answer was cut off (max_tokens)");
    if (body?.stop_reason === "refusal") throw new AiError("BAD_OUTPUT", "claude: refused");
    const use = body?.content?.find((c) => c.type === "tool_use" && c.name === TOOL);
    if (!use) throw new AiError("BAD_OUTPUT", "claude: no structured answer");
    const parsed = input.schema.safeParse(use.input);
    if (!parsed.success) throw new AiError("BAD_OUTPUT", `claude: the answer didn't match the schema (${parsed.error.issues[0]?.message ?? "?"})`);
    return { data: parsed.data, model: body?.model ?? model };
  },
};
