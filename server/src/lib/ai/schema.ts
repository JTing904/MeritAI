// Output schemas: one zod schema per request validates the answer and becomes the structured-output schema
// each provider asks for. Every field is required (optional ones are nullable), which is what OpenAI's
// strict mode needs; Gemini gets its OpenAPI-style subset (toGeminiSchema).
import { z } from "zod";

type Json = { [k: string]: unknown };

/** JSON Schema (draft 2020-12, no $schema key) of `schema`: objects closed, every property required. */
export function jsonSchemaOf(schema: z.ZodType): Json {
  const out = z.toJSONSchema(schema) as Json;
  delete out.$schema;
  return out;
}

const GEMINI_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "items",
  "minimum",
  "maximum",
  "propertyOrdering",
]);

/**
 * Gemini's responseSchema (an OpenAPI 3 subset): upper-case types, `nullable` instead of a null type or
 * an anyOf with null, no additionalProperties, properties kept in order (propertyOrdering).
 */
export function toGeminiSchema(node: unknown): Json {
  if (!node || typeof node !== "object") return { type: "STRING" };
  const src = node as Json;
  // anyOf [X, {type: null}] → X, nullable
  if (Array.isArray(src.anyOf)) {
    const branches = (src.anyOf as Json[]).filter((b) => b.type !== "null");
    const nullable = branches.length < (src.anyOf as Json[]).length;
    const inner = toGeminiSchema(branches[0] ?? {});
    return nullable ? { ...inner, nullable: true } : inner;
  }
  const out: Json = {};
  let type = src.type;
  if (Array.isArray(type)) {
    const real = (type as string[]).filter((t) => t !== "null");
    if (real.length < type.length) out.nullable = true;
    type = real[0] ?? "string";
  }
  out.type = String(type ?? "string").toUpperCase();
  for (const [k, v] of Object.entries(src)) {
    if (k === "type" || !GEMINI_KEYS.has(k)) continue;
    if (k === "properties") {
      const props = v as Json;
      out.properties = Object.fromEntries(Object.entries(props).map(([name, p]) => [name, toGeminiSchema(p)]));
      out.propertyOrdering = Object.keys(props);
    } else if (k === "items") out.items = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

/** Parses a model's JSON text (tolerating a ```json fence around it). Throws on anything else. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}
