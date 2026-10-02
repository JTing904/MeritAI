// fetch for the provider adapters: a timeout, JSON in and out, and errors that never carry the key.
import { AiError, type AiErrorKind } from "./types";
import { redact } from "./redact";

export type ProviderResponse = { status: number; body: unknown; text: string };

/** Network failures and timeouts are TRANSIENT; the caller classifies HTTP statuses. */
export async function send(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown; timeoutMs: number },
  key: string,
): Promise<ProviderResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (err) {
    const name = (err as Error)?.name ?? "Error";
    throw new AiError("TRANSIENT", name === "TimeoutError" ? "request timed out" : redact(`network error: ${(err as Error)?.message ?? name}`, [key]));
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

/** An AiError for a failed response, its message a short redacted summary. */
export function httpError(kind: AiErrorKind, provider: string, res: ProviderResponse, key: string): AiError {
  return new AiError(kind, redact(`${provider} ${res.status}: ${res.text}`, [key], 240), res.status);
}

/** Environment override or the default. */
export function envModel(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
