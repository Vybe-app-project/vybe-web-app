/**
 * Reset-link handling shared by the password reset pages.
 *
 * Import-free on purpose: the node:test suite transpiles this file in memory
 * and imports the result directly, so it must not depend on anything else.
 */

/**
 * The API mints reset tokens as 32 random bytes rendered as hex and validates
 * the presented token with isHexadecimal().isLength({ min: 64, max: 64 }).
 * Anything else can be refused before a request is made.
 */
export const RESET_TOKEN_RE = /^[0-9a-f]{64}$/i;

export const isResetToken = (value: string | null | undefined): boolean =>
  typeof value === 'string' && RESET_TOKEN_RE.test(value);

/** Reads `?token=` the way the reset mailers write it (URL.searchParams.set). */
export function readResetToken(params: { get(name: string): string | null }): string {
  return (params.get('token') ?? '').trim();
}

export type ResetFailure =
  | { kind: 'network' }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'invalid-token' }
  | { kind: 'rejected'; message: string };

/** The subset of an Axios error this module reads; typed structurally to stay import-free. */
type HttpFailure = {
  code?: string;
  response?: { status?: number; data?: unknown };
};

const RATE_LIMIT_FALLBACK = 'Too many attempts. Wait a few minutes and try again.';

/**
 * Sorts a failed reset request into the handful of states the pages render.
 *
 * - No response (or the browser reports offline): a connectivity problem.
 * - 429: the route allows five attempts per 15 minutes per address.
 * - 400 mentioning "expired": the API's 'Invalid or expired reset token'. Its
 *   other 400, 'Invalid token or password', is a validation failure the
 *   client-side policy should have caught, so it falls through and is shown
 *   verbatim rather than being mistaken for a dead link.
 * - Anything else: shown verbatim when the API sent a message, else `fallback`.
 */
export function classifyResetFailure(
  error: unknown,
  { online = true, fallback }: { online?: boolean; fallback: string },
): ResetFailure {
  const failure = (error && typeof error === 'object' ? error : {}) as HttpFailure;
  const status = failure.response?.status;
  const data = failure.response?.data as { message?: unknown } | undefined;
  const message = typeof data?.message === 'string' ? data.message.trim() : '';

  if (online === false || failure.code === 'ERR_NETWORK' || (!status && failure.code === 'ECONNABORTED')) {
    return { kind: 'network' };
  }
  if (status === 429) return { kind: 'rate-limited', message: message || RATE_LIMIT_FALLBACK };
  if (status === 400 && /expired/i.test(message)) return { kind: 'invalid-token' };
  return { kind: 'rejected', message: message || fallback };
}

export function resetFailureMessage(failure: ResetFailure): string {
  switch (failure.kind) {
    case 'network':
      return 'Could not reach Vybe. Check your connection and try again.';
    case 'invalid-token':
      return 'This reset link is invalid or has expired.';
    case 'rate-limited':
    case 'rejected':
      return failure.message;
  }
}
