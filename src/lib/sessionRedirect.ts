/**
 * Where a revoked session lands. The API revokes tokens on password change
 * and on sign-out from another device; the 401 interceptor in api.ts sends
 * the user here with a reason (Login shows a notice for `expired`) and, when
 * they were somewhere specific, a `next` so a successful sign-in takes them
 * back. Pure so it can be unit tested without a DOM.
 */
export function signInRedirect(pathname: string, search = ''): string {
  const params = new URLSearchParams({ reason: 'expired' });
  if (pathname && pathname !== '/' && !pathname.startsWith('/login')) params.set('next', `${pathname}${search}`);
  return `/login?${params.toString()}`;
}
