import { API_BASE, tokenStore } from './api';
import { lifecycleStatusCopy, type CancelDeletionResult, type DeletionStatus, type ReauthResult } from './accountLifecycle';

/**
 * The re-auth and deletion routes go over `fetch` rather than the shared axios
 * instance on purpose (the precedent is revokeSession in api.ts); every other
 * lifecycle call uses `api`. The contracts snapshot lists these routes (the
 * scanner follows the named routers in routes/accountLifecycle.js), so this is
 * not a workaround for the audit but for two behaviours `api` must not have:
 *   - a 401 here never signs the member out: REAUTH_REQUIRED means "prove it
 *     is you", and an account in its deletion grace period is refused by
 *     every ordinary route but allowed on these;
 *   - errors carry `response: { status, data, headers }` and `config: { url }`
 *     so isReauthRequired, reauthErrorCopy and errMsg (lib/apiError) read them
 *     exactly like an AxiosError: a 429 on /auth/reauth is worded as attempts
 *     and names the Retry-After wait;
 *   - a body that is not the API's JSON (a gateway's HTML page, the global
 *     limiter's plain text) is dropped, never shown: `data` is null and the
 *     message is a sentence for the status.
 */
export class LifecycleHttpError extends Error {
  code?: string;
  response: { status: number; data: unknown; headers?: Record<string, string> };
  /** The request URL, so the shared reader can tell a credential attempt from an ordinary action. */
  config: { url: string };

  constructor(status: number, data: unknown, code?: string, url = '', headers?: Record<string, string>) {
    const message = (data as { message?: unknown } | null)?.message;
    super(typeof message === 'string' && message.trim() ? message : lifecycleStatusCopy(status));
    this.name = 'LifecycleHttpError';
    this.response = headers ? { status, data, headers } : { status, data };
    this.config = { url };
    if (code) this.code = code;
  }
}

/** Response headers as a plain record (lower-case names), the shape lib/apiError reads Retry-After and X-Request-Id from. */
const headersOf = (response: Response): Record<string, string> => {
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
};

const REQUEST_TIMEOUT_MS = 30_000;

async function lifecycleRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Platform': 'web',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...extraHeaders,
  };
  const url = `${API_BASE.replace(/\/$/, '')}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
    });
  } catch (error) {
    const aborted = (error as { name?: string } | null)?.name === 'TimeoutError';
    throw new LifecycleHttpError(0, null, aborted ? 'ECONNABORTED' : 'ERR_NETWORK', url);
  }
  const text = await response.text();
  let data: unknown = null;
  let parsed = !text;
  if (text) {
    try {
      data = JSON.parse(text);
      parsed = true;
    } catch {
      // Not the API's JSON: nothing in it is for the person, so the status speaks.
      data = null;
    }
  }
  if (!response.ok) throw new LifecycleHttpError(response.status, data, undefined, url, headersOf(response));
  if (!parsed) throw new LifecycleHttpError(response.status, null, 'ERR_BAD_RESPONSE', url, headersOf(response));
  return data as T;
}

/** GET /users/me/deletion: pending state, grace days and the re-auth methods (allowed for a pending account). */
export const getDeletionStatus = (): Promise<DeletionStatus> => lifecycleRequest<DeletionStatus>('GET', '/users/me/deletion');

/** POST /auth/reauth with exactly one proof. 400 REAUTH_FAILED, 409 REAUTH_METHOD_UNAVAILABLE, 429 RATE_LIMITED. */
export const reauthenticate = (proof: { password: string } | { code: string }): Promise<ReauthResult> =>
  lifecycleRequest<ReauthResult>('POST', '/auth/reauth', proof);

/** POST /users/me/deletion/cancel: "Keep my account". Idempotent; works for a pending account. */
export const cancelScheduledDeletion = (): Promise<CancelDeletionResult> =>
  lifecycleRequest<CancelDeletionResult>('POST', '/users/me/deletion/cancel', {});
