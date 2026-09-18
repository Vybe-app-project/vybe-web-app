import { differenceInCalendarDays, format, formatDistanceStrict, isValid, parseISO } from 'date-fns';

export type TimeLeft = { label: string; tone: 'neutral' | 'success' | 'accent'; urgent: boolean };

/**
 * Time-left chip for a challenge card.
 *
 *   closed        → "Closed"
 *   past end      → "Ended"
 *   today         → "Ends today"          (ember, urgent)
 *   1–2 days      → "2 days left"         (ember, urgent)
 *   ≤ 60 days     → "6 weeks left"        (mint)
 *   ≤ 365 days    → "5 months left"       (mint)
 *   beyond a year → "Ends Nov 2036"       (mint) — "122 months left" told nobody anything.
 */
export function challengeTimeLeft(
  { isActive, endDate }: { isActive?: boolean; endDate?: string | null },
  now: Date = new Date(),
): TimeLeft {
  if (isActive === false) return { label: 'Closed', tone: 'neutral', urgent: false };
  const d = endDate ? parseISO(endDate) : null;
  if (!d || !isValid(d)) return { label: 'Open', tone: 'success', urgent: false };
  if (d.getTime() <= now.getTime()) return { label: 'Ended', tone: 'neutral', urgent: false };
  const days = differenceInCalendarDays(d, now);
  if (days <= 0) return { label: 'Ends today', tone: 'accent', urgent: true };
  if (days <= 2) return { label: `${days} ${days === 1 ? 'day' : 'days'} left`, tone: 'accent', urgent: true };
  if (days > 365) return { label: `Ends ${format(d, 'MMM yyyy')}`, tone: 'success', urgent: false };
  if (days > 60) return { label: `${formatDistanceStrict(d, now, { unit: 'month', roundingMethod: 'round' })} left`, tone: 'success', urgent: false };
  if (days > 14) {
    const weeks = Math.round(days / 7);
    return { label: `${weeks} ${weeks === 1 ? 'week' : 'weeks'} left`, tone: 'success', urgent: false };
  }
  return { label: `${days} days left`, tone: 'success', urgent: false };
}
