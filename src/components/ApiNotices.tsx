import { useEffect } from 'react';
import { useToast } from './ui';
import { rateLimitedCopy } from '../lib/apiError';
import { isInlineErrorSurface, onRateLimited } from '../lib/clientPolicy';

/**
 * App-wide notices for answers the API client sees on any request. Today:
 * every 429 becomes one toast ("Too many attempts, try again in N s"),
 * keyed so a burst replaces the live toast instead of stacking. The forms
 * that show the same error inline (sign-in, sign-up, password reset,
 * support) are skipped so nobody reads it twice. Mounted once, inside
 * <ToastProvider>.
 */
export function ApiNotices() {
  const toast = useToast();
  useEffect(
    () =>
      onRateLimited((event) => {
        if (isInlineErrorSurface(event.url)) return;
        toast.error(rateLimitedCopy(event.retryAfterSec), undefined, { key: 'rate-limited' });
      }),
    [toast],
  );
  return null;
}
