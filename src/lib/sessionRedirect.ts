/**
 * Where a revoked session lands. The API revokes tokens on password change
 * and on sign-out from another device; the 401 interceptor in api.ts sends
 * the user here with a reason (Login shows a notice for `expired`; none when
 * there was no session to expire) and, when they were somewhere specific, a
 * `next` so a successful sign-in takes them back. Pure so it can be unit
 * tested without a DOM.
 */
export function signInRedirect(pathname: string, search = '', reason: 'expired' | null = 'expired'): string {
  const params = new URLSearchParams();
  if (reason) params.set('reason', reason);
  if (pathname && pathname !== '/' && !pathname.startsWith('/login')) params.set('next', `${pathname}${search}`);
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}
