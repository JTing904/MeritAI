import type { ApiEnvelope, ErrorCode } from '@shared/api';
import { APP_VERSION } from '@shared/constants';
import { zh } from '@/i18n/zh';

/** Inlined at build time. On the tablet, `adb reverse tcp:3000 tcp:3000` makes localhost reach the PC. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Server codes plus the client's own: NETWORK (can't reach it), BAD_RESPONSE (not our JSON), TIMEOUT (too
 * slow). RETRY (a transient database error, retried once here) and UPDATE_REQUIRED (426: this build is too old)
 * are listed too so the app compiles whether or not shared/api.ts has them yet.
 */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'BAD_RESPONSE' | 'TIMEOUT' | 'RETRY' | 'UPDATE_REQUIRED';

export class ApiClientError extends Error {
  constructor(
    public readonly code: ClientErrorCode,
    message: string,
    public readonly status = 0,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON body, or a FormData for file uploads (sent as multipart). */
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  /** Give up after this long (TIMEOUT). Default: 15 s for JSON, 120 s for uploads. */
  timeoutMs?: number;
  /** Sent as Idempotency-Key on creates, so a retry of the same action can't create it twice (newIdempotencyKey). */
  idempotencyKey?: string;
};

export const JSON_TIMEOUT_MS = 15_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
/** Wait before the one automatic retry of a 503 RETRY. */
const RETRY_DELAY_MS = 600;

// ── 426 UPDATE_REQUIRED: the root layout swaps the whole app for the 「请更新 App」 screen ──────────

type Listener = () => void;
const updateListeners = new Set<Listener>();
let updateRequired = false;

/** True once any response said this build is too old (stays true until the app restarts). */
export const isUpdateRequired = () => updateRequired;

export function onUpdateRequired(listener: Listener): () => void {
  updateListeners.add(listener);
  return () => void updateListeners.delete(listener);
}

function flagUpdateRequired() {
  if (updateRequired) return;
  updateRequired = true;
  updateListeners.forEach((l) => l());
}

// ── Idempotency keys ────────────────────────────────────────────────────────────────────────────

/** A random UUID v4 (crypto when the platform has it; Hermes may not). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // Insecure web context (http on a LAN address): fall through.
    }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── The request ─────────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function once<T>(path: string, { method = 'GET', body, token, signal, timeoutMs, idempotencyKey }: RequestOptions): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json', 'X-App-Version': APP_VERSION };
  // Multipart: let fetch set the Content-Type with its boundary.
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  // One controller for the caller's signal and our timeout; the timer covers reading the body too.
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs ?? (isForm ? UPLOAD_TIMEOUT_MS : JSON_TIMEOUT_MS));
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', onAbort);

  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (timedOut) throw new ApiClientError('TIMEOUT', `Request to ${path} timed out`);
      // Offline, server down, or aborted by the caller: all mean "can't reach the server".
      if (__DEV__ && !signal?.aborted) console.warn(`[api] ${method} ${path} failed:`, err);
      throw new ApiClientError('NETWORK', `Network request to ${API_URL} failed`);
    }

    let envelope: ApiEnvelope<T>;
    try {
      envelope = (await res.json()) as ApiEnvelope<T>;
    } catch {
      if (timedOut) throw new ApiClientError('TIMEOUT', `Request to ${path} timed out`);
      if (res.status === 426) {
        flagUpdateRequired();
        throw new ApiClientError('UPDATE_REQUIRED', 'This app version is too old', 426);
      }
      throw new ApiClientError('BAD_RESPONSE', `Non-JSON response (HTTP ${res.status})`, res.status);
    }
    if (!envelope || typeof envelope !== 'object' || !('success' in envelope)) {
      throw new ApiClientError('BAD_RESPONSE', `Unexpected response shape (HTTP ${res.status})`, res.status);
    }
    if (!envelope.success) {
      const code = envelope.error.code as ClientErrorCode;
      if (code === 'UPDATE_REQUIRED' || res.status === 426) flagUpdateRequired();
      throw new ApiClientError(code, envelope.error.message, res.status, envelope.error.details);
    }
    return envelope.data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Calls the MeritAI API and unwraps the `{ success, data, error }` envelope. Every request carries
 * X-App-Version and a timeout; a 503 RETRY (a transient database error: nothing was written) is sent once more.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await once<T>(path, options);
  } catch (err) {
    if (!(err instanceof ApiClientError) || err.code !== 'RETRY' || options.signal?.aborted) throw err;
    await sleep(RETRY_DELAY_MS);
    if (options.signal?.aborted) throw err;
    return once<T>(path, options);
  }
}

// Codes the app has words for; anything else (a newer server's code) reads as the generic INTERNAL text.
const KNOWN = new Set<string>(Object.keys(zh.errors));

/** The error's code for `t.errors[...]`: always one the app has text for. */
export function errorCode(err: unknown): ClientErrorCode {
  if (!(err instanceof ApiClientError)) return 'INTERNAL';
  return KNOWN.has(err.code) ? err.code : 'INTERNAL';
}
