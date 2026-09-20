import type { ReactNode } from 'react';
import { cx, formatStat, isEmptyMetric } from './ui';

/**
 * A number over its label, and nothing else. `lg` is the hero metric
 * (`.t-metric`, 32–44 px, the one place type gets big: the Workouts week
 * strip, Progress); `md` is a 20 px counter (a gym header's posts · members ·
 * this week); `sm` is Instagram's 16 px profile stat.
 *
 * Zero is never drawn. When `value` is 0, null or undefined the whole metric
 * gives way to `fallback` — the next action, in the caller's words — or to
 * nothing, so the caller's box keeps its geometry and the eye reads "not yet"
 * rather than "0". A string value ("a few", "1 min") renders as given.
 */
export type MetricProps = {
  value?: number | string | null;
  label: ReactNode;
  unit?: string;
  /** Rendered in the metric's place when `value` is not a metric. */
  fallback?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  align?: 'start' | 'center';
  /** Compact thousands (12.4k) for tight cells. */
  compact?: boolean;
  className?: string;
};

const NUMBER: Record<NonNullable<MetricProps['size']>, string> = {
  sm: 'text-md font-semibold leading-5',
  md: 'text-lg font-bold leading-6',
  lg: 't-metric',
};

export function Metric({ value, label, unit, fallback, size = 'lg', align = 'start', compact = false, className }: MetricProps) {
  if (isEmptyMetric(value)) return fallback === undefined ? null : <>{fallback}</>;
  const text = typeof value === 'number' ? formatStat(value, { compact }) : value;
  return (
    <div className={cx('flex min-w-0 flex-col', align === 'center' ? 'items-center text-center' : 'items-start', className)}>
      <span className={cx('tabular block max-w-full truncate text-text-1', NUMBER[size])}>
        {text}
        {unit ? <span className="ml-1 align-baseline text-xs font-semibold tracking-normal text-text-2 [font-variation-settings:'wdth'_100]">{unit}</span> : null}
      </span>
      <span className="t-meta block max-w-full truncate">{label}</span>
    </div>
  );
}
