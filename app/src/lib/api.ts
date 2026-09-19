import type { ApiEnvelope, ErrorCode } from '@shared/api';

/** Inlined at build time. On the tablet, `adb reverse tcp:3000 tcp:3000` makes localhost reach the PC. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type ClientErrorCode = ErrorCode | 'NETWORK' | 'BAD_RESPONSE';

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

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON body, or a FormData for file uploads (sent as multipart). */
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
};

/** Calls the MeritAI API and unwraps the `{ success, data, error }` envelope. */
export async function api<T>(path: string, { method = 'GET', body, token, signal }: RequestOptions = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  // Multipart: let fetch set the Content-Type with its boundary.
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Offline, server down, or aborted by a timeout: all mean "can't reach the server".
    if (__DEV__ && !signal?.aborted) console.warn(`[api] ${method} ${path} failed:`, err);
    throw new ApiClientError('NETWORK', `Network request to ${API_URL} failed`);
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError('BAD_RESPONSE', `Non-JSON response (HTTP ${res.status})`, res.status);
  }
  if (!envelope || typeof envelope !== 'object' || !('success' in envelope)) {
    throw new ApiClientError('BAD_RESPONSE', `Unexpected response shape (HTTP ${res.status})`, res.status);
  }
  if (!envelope.success) {
    throw new ApiClientError(envelope.error.code, envelope.error.message, res.status, envelope.error.details);
  }
  return envelope.data;
}

export function errorCode(err: unknown): ClientErrorCode {
  return err instanceof ApiClientError ? err.code : 'INTERNAL';
}
