import type { AxiosError } from 'axios';

/**
 * One reading of every error shape the API sends (docs/api-contract.md,
 * "Error shapes"). Routes keep their own bodies (`{ message }`,
 * `{ success: false, message }`, `{ code, message }`); the final handler
 * answers `{ error: { code, message, requestId } }`; the per-user write
 * limiter answers `{ code: 'RATE_LIMITED', message, retryAfterSec }`; the
 * global IP limiter answers text/plain with only a Retry-After header. This
 * module is pure so it can be unit tested under node --test, and it reads
 * exactly two headers (X-Request-Id, Retry-After), both in the CORS
 * exposedHeaders list.
 */
export type ApiErrorDetails = {
  status: number | null;
  /** body.error.code | body.code | 'RATE_LIMITED' for any 429 without a code. */
  code: string | null;
  /** body.error.message | body.message | text body | the error's own message | fallback. */
  message: string;
  /** body.error.requestId | body.requestId | the X-Request-Id response header. */
  requestId: string | null;
  /** body.retryAfterSec | the Retry-After header (seconds, or an HTTP date). */
  retryAfterSec: number | null;
  /** An axios error with no response at all: the API was never reached. */
  offline: boolean;
};

type LooseBody = {
  error?: unknown;
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
  retryAfterSec?: unknown;
  errors?: unknown;
};

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const finite = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Axios lower-cases response header names; a fake in a test may not. */
function header(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as Record<string, unknown> & { get?: (n: string) => unknown };
  const direct = h[name.toLowerCase()] ?? h[name];
  if (typeof direct === 'string' || typeof direct === 'number') return String(direct);
  if (typeof h.get === 'function') {
    const v = h.get(name);
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return null;
}

/** Retry-After is either delta-seconds or an HTTP date. */
function retryAfterFrom(raw: string | null, now: number): number | null {
  if (raw === null) return null;
  const seconds = finite(raw);
  if (seconds !== null) return Math.max(0, Math.round(seconds));
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - now) / 1000));
}

export function apiErrorDetails(e: unknown, fallback = 'Something went wrong', now = Date.now()): ApiErrorDetails {
  if (typeof e === 'string') {
    return { status: null, code: null, message: text(e) ?? fallback, requestId: null, retryAfterSec: null, offline: false };
  }
  const ax = e && typeof e === 'object' ? (e as Partial<AxiosError<unknown>> & { isAxiosError?: boolean }) : null;
  const response = ax?.response;
  const status = typeof response?.status === 'number' ? response.status : null;
  const data = response?.data;
  const body = data && typeof data === 'object' && !Array.isArray(data) ? (data as LooseBody) : null;
  const envelope = body?.error && typeof body.error === 'object' ? (body.error as LooseBody) : null;
  const plain = typeof data === 'string' && !/^\s*</.test(data) ? text(data) : null;
  const offline = Boolean(ax && (ax.isAxiosError === true || 'config' in ax || 'request' in ax) && !response);

  let code = text(envelope?.code) ?? text(body?.code);
  if (!code && status === 429) code = 'RATE_LIMITED';

  const validator =
    Array.isArray(body?.errors) && body.errors[0] && typeof body.errors[0] === 'object'
      ? text((body.errors[0] as { msg?: unknown }).msg)
      : null;

  const message =
    text(envelope?.message) ??
    text(body?.message) ??
    (typeof body?.error === 'string' ? text(body.error) : null) ??
    validator ??
    plain ??
    // A network failure's own message ("Network Error") says nothing an
    // operator can act on; the caller's fallback does.
    (offline || response ? null : text(ax?.message)) ??
    fallback;

  const requestId = text(envelope?.requestId) ?? text(body?.requestId) ?? header(response?.headers, 'x-request-id');
  const retryAfterSec = (() => {
    const fromBody = finite(body?.retryAfterSec);
    if (fromBody !== null) return Math.max(0, Math.round(fromBody));
    return retryAfterFrom(header(response?.headers, 'retry-after'), now);
  })();

  return { status, code, message, requestId, retryAfterSec, offline };
}

export const isRateLimited = (e: unknown): boolean => apiErrorDetails(e).status === 429;

/** "42 s" under two minutes, whole minutes above. */
function waitLabel(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  return `${Math.ceil(seconds / 60)} min`;
}

/**
 * The operator-facing line for a toast or a callout: the server's sentence
 * plus the code and the first eight characters of the request id, so a
 * report to the on-call engineer can be matched to a log line.
 *
 *   Could not decide appeal (APPEAL_REVIEWER_CONFLICT · request 3f9a1c2e)
 *   Rate limited. Try again in 42 s.
 */
export function describeAdminError(e: unknown, fallback = 'Something went wrong'): string {
  const d = apiErrorDetails(e, fallback);
  if (d.status === 429) {
    return d.retryAfterSec !== null && d.retryAfterSec > 0
      ? `Rate limited. Try again in ${waitLabel(d.retryAfterSec)}.`
      : 'Rate limited. Try again in a moment.';
  }
  if (d.code === 'CLIENT_UPDATE_REQUIRED' || d.status === 426) {
    return 'This console build is below the API minimum. Reload the page to update.';
  }
  if (d.offline) return `${d.message.replace(/[.]$/, '')}. Check the connection to the API.`;
  const ref = [d.code, d.requestId ? `request ${d.requestId.slice(0, 8)}` : null].filter(Boolean).join(' · ');
  return ref ? `${d.message.replace(/[.]$/, '')} (${ref})` : d.message;
}
