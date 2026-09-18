/**
 * Small, dependency-free formatting helpers shared by the staff console and
 * the consumer app. Kept free of React so they can be unit-tested under
 * `node --test` through tests/ts-loader.mjs.
 */

/** "1 like", "2 likes", "1,204 reports". Pass `many` for irregular plurals. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

export type StampOptions = {
  /** Include seconds (audit trails). Default false. */
  seconds?: boolean;
  /** Omit the clock entirely (join dates). Default false. */
  dateOnly?: boolean;
  /** Force a zone (tests, or a UTC toggle). Default: the browser's zone. */
  timeZone?: string;
  /** Locale override; default: the browser's. */
  locale?: string;
};

/**
 * Human timestamp WITH its zone: "Sep 18, 2026, 12:17:47 EDT". Two staff in
 * different zones reading the same audit row used to see different bare
 * clock times with no way to tell which zone either was in.
 */
export function fmtStamp(iso?: string | number | Date | null, opts: StampOptions = {}): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const base: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  };
  if (opts.dateOnly) return new Intl.DateTimeFormat(opts.locale, base).format(date);
  return new Intl.DateTimeFormat(opts.locale, {
    ...base,
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(date);
}

/** The ISO form for `title=` / `dateTime=`, or undefined when unparseable. */
export function isoStamp(iso?: string | number | Date | null): string | undefined {
  if (iso === null || iso === undefined || iso === '') return undefined;
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Make a server message read as its own sentence before guidance is appended:
 * "Report target is no longer available" -> "Report target is no longer available."
 */
export function ensureSentence(message?: string | null): string {
  const trimmed = String(message ?? '').trim();
  if (!trimmed) return '';
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
