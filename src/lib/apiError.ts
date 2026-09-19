/**
 * One reader for every error the API client can hand back.
 *
 * The API answers in several shapes and this module knows all of them, so no
 * page has to (docs/api-contract.md, "Errors"; utils/logger.js on the API):
 *
 *   { error: { code, message, requestId } }        the final envelope (404, body
 *                                                  parser 4xx, every 5xx)
 *   { message }                                    legacy routes, protect's 401,
 *                                                  the auth rate limiter's 429
 *   { success:false, message, error:'<string>' }   dev/test diagnostics; note
 *                                                  `error` is a STRING here and an
 *                                                  OBJECT in the envelope
 *   { errors: [{ msg, path }] }                    express-validator
 *   { errors: { field: 'msg' } }                   per-field 400s
 *   { success:false, code, message, field? }       C1 guardrails
 *   { code:'RATE_LIMITED', message, retryAfterSec } per-account write limits
 *   { success:false, code:'CLIENT_UPDATE_REQUIRED', message, platform, ... }  426
 *   a text/html string                             the global per-IP limiter
 *
 * Two rules hold everywhere: axios's own text ("Request failed with status
 * code 500", "timeout of 30000ms exceeded") is never shown to a person, and
 * the function never throws, whatever it is given. Import-free on purpose so
 * tests can load it directly and nothing in the client can cycle through it.
 */

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'cancelled' | 'unknown';

export type ParsedApiError = {
  kind: ApiErrorKind;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  /** UPPER_SNAKE code from the body; RATE_LIMITED is synthesised for any 429. */
  code: string | null;
  /** Copy safe to show a person. Never axios text, never HTML. */
  message: string;
  /** Correlation id from the envelope or the X-Request-Id header, for support. */
  requestId: string | null;
  /** Seconds until a 429 clears, from the body or the Retry-After header. */
  retryAfterSec: number | null;
  /** The field a validation or guardrail error points at, when the API named one. */
  field: string | null;
  /** Per-field messages from `{ errors: { field: 'msg' } }`. */
  fieldErrors: Record<string, string>;
  /** A 426 that carries CLIENT_UPDATE_REQUIRED: this build is below the floor. */
  updateRequired: boolean;
  /** The raw response body, for callers that read a route-specific field. */
  body: unknown;
};

export const OFFLINE_COPY = 'Could not reach Vybe. Check your connection and try again.';
export const TIMEOUT_COPY = 'Vybe took too long to answer. Try again.';
export const SERVER_COPY = 'Something went wrong on our side.';
export const RATE_LIMITED_CODE = 'RATE_LIMITED';
export const UPDATE_REQUIRED_CODE = 'CLIENT_UPDATE_REQUIRED';

/**
 * How long until a 429 clears, for a person: "in 45 seconds", "in about
 * 12 minutes", "in about 2 hours" (always rounded up, so the wait is never
 * understated), or "in a moment" when the API named no wait. The per-account
 * write limiters run hour- and day-long windows, so a bare count of seconds
 * would routinely read "3542 s". Duplicated verbatim in authRedirect.ts
 * (which must stay import-free); tests/client-policy.test.mjs pins them equal.
 */
export function retryWaitCopy(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return 'in a moment';
  const seconds = Math.ceil(sec);
  if (seconds < 90) return `in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  if (seconds < 90 * 60) {
    const minutes = Math.ceil(seconds / 60);
    return `in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.ceil(seconds / 3600);
  return `in about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/**
 * What a 429 limited: credential `attempts` (sign-in, sign-up, password
 * reset, re-auth, the admin console's sign-in) or ordinary `actions` (posts,
 * follows, searches, support messages).
 */
export type RateLimitedSubject = 'attempts' | 'actions';

/**
 * The one sentence for a 429. "Too many attempts" is accurate only where a
 * person was trying to get in; a member who posted twenty times in an hour
 * attempted nothing, so everywhere else the verb is neutral. authRedirect.ts
 * repeats the `attempts` form for sign-in; tests/client-policy.test.mjs pins
 * the two equal.
 */
export function rateLimitedCopy(sec: number | null | undefined, subject: RateLimitedSubject = 'actions'): string {
  const lead = subject === 'attempts' ? 'Too many attempts.' : 'You’re doing that too often.';
  return `${lead} Try again ${retryWaitCopy(sec)}.`;
}

const RATE_LIMITED_LEADS = ['Too many attempts. Try again ', 'You’re doing that too often. Try again '];

/** The toast key every 429 shares, so a page's own toast and the app-wide one (components/ApiNotices.tsx) replace each other instead of stacking. */
export const RATE_LIMITED_TOAST_KEY = 'rate-limited';

/** True for any sentence rateLimitedCopy can produce, whichever module produced it. */
export function isRateLimitedCopy(message: unknown): boolean {
  return typeof message === 'string' && RATE_LIMITED_LEADS.some((lead) => message.startsWith(lead));
}

/**
 * The API path of a request URL as axios saw it, without an origin, the /api
 * prefix, a query or a hash: an absolute `<origin>/api/auth/login?x=1` and a
 * bare `auth/login` both give `/auth/login`.
 */
export function apiPathOf(url: string): string {
  let path = url.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return path;
    }
  }
  path = path.split(/[?#]/)[0];
  if (!path.startsWith('/')) path = `/${path}`;
  return path.replace(/^\/api(?=\/|$)/, '');
}

/** Routes where a 429 counts credential attempts, so "Too many attempts" is the honest lead. */
const ATTEMPT_PATH_PREFIXES = ['/auth/', '/admins/login', '/admins/request-reset', '/admins/reset-password'];

export function isAttemptPath(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || !url) return false;
  const path = apiPathOf(url);
  return ATTEMPT_PATH_PREFIXES.some((prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)));
}

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** A positive whole number of seconds, from a number or a digit string; anything else is null. */
const seconds = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : null;
  }
  return null;
};

/** Read one response header from an AxiosHeaders instance or a plain object, case-insensitively. */
const headerValue = (headers: unknown, name: string): string | null => {
  if (!headers || typeof headers !== 'object') return null;
  const record = headers as Dict & { get?: (name: string) => unknown };
  try {
    if (typeof record.get === 'function') {
      const got = record.get(name);
      if (typeof got === 'string' || typeof got === 'number') return String(got);
    }
  } catch {
    // Fall through to the plain lookup.
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) {
      const value = record[key];
      if (typeof value === 'string' || typeof value === 'number') return String(value);
      if (Array.isArray(value) && value.length) return String(value[0]);
    }
  }
  return null;
};

const AXIOS_CODES = new Set(['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED', 'ERR_BAD_RESPONSE', 'ERR_BAD_REQUEST', 'ERR_BAD_OPTION', 'ERR_BAD_OPTION_VALUE', 'ERR_FR_TOO_MANY_REDIRECTS', 'ERR_DEPRECATED', 'ERR_NOT_SUPPORT', 'ERR_INVALID_URL']);

/** Anything axios produced, or anything shaped like it; its `message` is never copy. */
const looksLikeTransportError = (failure: Dict): boolean =>
  failure.isAxiosError === true ||
  'response' in failure ||
  'request' in failure ||
  'config' in failure ||
  (typeof failure.code === 'string' && AXIOS_CODES.has(failure.code));

const unknownError = (fallback: string, body: unknown = undefined): ParsedApiError => ({
  kind: 'unknown',
  status: null,
  code: null,
  message: fallback,
  requestId: null,
  retryAfterSec: null,
  field: null,
  fieldErrors: {},
  updateRequired: false,
  body,
});

function parse(e: unknown, fallback: string): ParsedApiError {
  if (!e || typeof e !== 'object') return unknownError(fallback);
  const failure = e as Dict;
  // A response whose status is 0 is the fetch/XHR convention for "the API was
  // never reached" (src/lib/lifecycleApi.ts builds one for a network failure
  // or a timeout); it is read as a transport error, not as an HTTP answer.
  const response = isDict(failure.response) && failure.response.status !== 0 ? failure.response : null;
  const status = response && typeof response.status === 'number' ? response.status : null;
  const body = response ? response.data : undefined;
  const headers = response ? response.headers : undefined;
  const transportCode = typeof failure.code === 'string' ? failure.code : null;
  const requestUrl = isDict(failure.config) && typeof failure.config.url === 'string' ? failure.config.url : null;

  if (!response) {
    if (transportCode === 'ERR_NETWORK') return { ...unknownError(OFFLINE_COPY), kind: 'network', code: transportCode };
    if (transportCode === 'ECONNABORTED' || transportCode === 'ETIMEDOUT') {
      return { ...unknownError(TIMEOUT_COPY), kind: 'timeout', code: transportCode };
    }
    if (transportCode === 'ERR_CANCELED') return { ...unknownError(fallback), kind: 'cancelled', code: transportCode };
    // An error the app threw itself ("Give the meal a name") carries copy
    // written for a person; an axios error without a response does not.
    const own = looksLikeTransportError(failure) ? null : text(failure.message);
    return unknownError(own ?? fallback);
  }

  const record = isDict(body) ? body : null;
  const envelope = record && isDict(record.error) ? record.error : null;

  const code =
    text(envelope?.code) ??
    text(record?.code) ??
    (status === 429 ? RATE_LIMITED_CODE : null);

  const retryAfterSec =
    seconds(record?.retryAfterSec) ??
    seconds(record?.retryAfter) ??
    seconds(headerValue(headers, 'retry-after'));

  const requestId = text(envelope?.requestId) ?? text(record?.requestId) ?? text(headerValue(headers, 'x-request-id'));

  const validatorList = record && Array.isArray(record.errors) ? (record.errors as unknown[]) : null;
  const firstValidator = validatorList && isDict(validatorList[0]) ? validatorList[0] : null;
  const fieldMap = record && isDict(record.errors) ? record.errors : null;
  const fieldErrors: Record<string, string> = {};
  if (fieldMap) {
    for (const [key, value] of Object.entries(fieldMap)) {
      const message = text(value);
      if (message) fieldErrors[key] = message;
    }
  }
  const field =
    text(record?.field) ??
    text(firstValidator?.path) ??
    text(firstValidator?.param) ??
    (Object.keys(fieldErrors)[0] ?? null);

  // A response object without a status (a hand-made error, an odd adapter)
  // is still read for its body; only the status-keyed copy is skipped.
  let message: string;
  if (status === 429) {
    // Every limiter answers with its own family label; members see one
    // sentence, worded for attempts on the auth routes and for actions elsewhere.
    message = rateLimitedCopy(retryAfterSec, isAttemptPath(requestUrl) ? 'attempts' : 'actions');
  } else {
    message =
      text(envelope?.message) ??
      text(record?.message) ??
      text(record?.error) ??
      text(firstValidator?.msg) ??
      (status !== null && status >= 500 ? SERVER_COPY : fallback);
  }

  return {
    kind: status === null ? 'unknown' : 'http',
    status,
    code,
    message,
    requestId,
    retryAfterSec,
    field,
    fieldErrors,
    updateRequired: status === 426 && code === UPDATE_REQUIRED_CODE,
    body,
  };
}

/**
 * Read any thrown value into one shape. `fallback` is the copy for a failure
 * that carried nothing a person can act on.
 */
export function parseApiError(e: unknown, fallback = 'Something went wrong'): ParsedApiError {
  try {
    return parse(e, fallback);
  } catch {
    return unknownError(fallback);
  }
}
