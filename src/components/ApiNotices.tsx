import { useEffect } from 'react';
import { useToast } from './ui';
import { RATE_LIMITED_TOAST_KEY, isAttemptPath, rateLimitedCopy } from '../lib/apiError';
import { isInlineErrorSurface, onRateLimited } from '../lib/clientPolicy';

/**
 * App-wide notices for answers the API client sees on any request. Today:
 * every 429 becomes one toast naming the wait, keyed so a burst replaces the
 * live toast instead of stacking; ToastProvider.error puts the same key on a
 * page's own 429 toast, so the two collapse into one. The surfaces that show
 * the error inline (sign-in, sign-up, password reset, support, the food
 * search) are skipped so nobody reads it twice. Mounted once, inside
 * <ToastProvider>.
 */
export function ApiNotices() {
  const toast = useToast();
  useEffect(
    () =>
      onRateLimited((event) => {
        if (isInlineErrorSurface(event.url)) return;
        toast.error(rateLimitedCopy(event.retryAfterSec, isAttemptPath(event.url) ? 'attempts' : 'actions'), undefined, { key: RATE_LIMITED_TOAST_KEY });
      }),
    [toast],
  );
  return null;
}
