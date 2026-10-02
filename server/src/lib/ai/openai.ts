// OpenAI (REST Responses API with a strict JSON-schema text format, M6 spec §2). 测试版: written from the
// current docs (developers.openai.com, checked 2026-09-23), not tried with a real key. The default model ids
// are a guess at "cheap" and "good" and are meant to be overridden: OPENAI_MODEL_LIGHT, OPENAI_MODEL_GOOD.
import { jsonSchemaOf, parseJsonText } from "./schema";
import { b64, httpError, send, type ProviderResponse } from "./http";
import { goodChain, lightModel } from "./usage";
import { AiError, type AiProvider, type AiTier, type GenerateInput, type GenerateResult } from "./types";

const BASE = "https://api.openai.com/v1";
const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type OpenAiError = { error?: { type?: string; code?: string; message?: string } };

function classify(res: ProviderResponse, key: string): AiError {
  const err = (res.body as OpenAiError | null)?.error;
  if (res.status === 404 || err?.code === "model_not_found") return httpError("MODEL_GONE", "openai", res, key);
  if (res.status === 401 || res.status === 403 || err?.code === "invalid_api_key") return httpError("INVALID", "openai", res, key);
  // insufficient_quota: no credit left (a 429 like the per-minute limit, told apart by its code).
  if (err?.code === "insufficient_quota" || err?.type === "insufficient_quota") return httpError("QUOTA", "openai", res, key);
  if (res.status === 429 || res.status >= 500 || res.status === 408) return httpError("TRANSIENT", "openai", res, key);
  return httpError("BAD_OUTPUT", "openai", res, key);
}

type Output = { type: string; content?: { type: string; text?: string; refusal?: string }[] };

export const openai: AiProvider = {
  name: "OPENAI",
  model(tier: AiTier) {
    return tier === "good" ? goodChain("OPENAI")[0]! : lightModel("OPENAI");
  },
  async checkKey(key) {
    const res = await send(`${BASE}/models`, { method: "GET", headers: { authorization: `Bearer ${key}` }, timeoutMs: 15_000 }, key);
    if (res.status !== 200) throw classify(res, key);
  },
  async generate<T>(key: string, input: GenerateInput<T>): Promise<GenerateResult<T>> {
    const model = input.model;
    const content = input.parts.map((p) => {
      if ("text" in p) return { type: "input_text", text: p.text };
      if (p.mimeType === "application/pdf") return { type: "input_file", filename: p.name, file_data: `data:${p.mimeType};base64,${b64(p.bytes)}` };
      if (IMAGES.has(p.mimeType)) return { type: "input_image", image_url: `data:${p.mimeType};base64,${b64(p.bytes)}` };
      return { type: "input_text", text: `[${p.name}: this file type can't be sent to the model]` };
    });
    const res = await send(
      `${BASE}/responses`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: {
          model,
          instructions: input.system,
          input: [{ role: "user", content }],
          max_output_tokens: input.maxOutputTokens,
          text: { format: { type: "json_schema", name: "result", strict: true, schema: jsonSchemaOf(input.schema) } },
        },
        timeoutMs: input.tier === "good" ? 120_000 : 90_000,
      },
      key,
    );
    if (res.status !== 200) throw classify(res, key);
    const body = res.body as { status?: string; output?: Output[]; model?: string } | null;
    if (body?.status && body.status !== "completed") throw new AiError("BAD_OUTPUT", `openai: status ${body.status}`);
    const parts = (body?.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
    if (parts.some((c) => c.type === "refusal")) throw new AiError("BAD_OUTPUT", "openai: refused");
    const text = parts.filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
    let json: unknown;
    try {
      json = parseJsonText(text);
    } catch {
      throw new AiError("BAD_OUTPUT", "openai: the answer was not JSON");
    }
    const parsed = input.schema.safeParse(json);
    if (!parsed.success) throw new AiError("BAD_OUTPUT", `openai: the answer didn't match the schema (${parsed.error.issues[0]?.message ?? "?"})`);
    return { data: parsed.data, model: body?.model ?? model };
  },
};
