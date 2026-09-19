/**
 * Pure shaping for the System and Dashboard cards of the staff console:
 * GET /api/admin/notifications/health, GET /api/admin/performance,
 * GET /api/admin/analytics (clientAdoption) and GET /api/version. No imports,
 * no React, so it is unit tested under node --test
 * (tests/admin-ops-formatters.test.mjs).
 */

/* ----------------------------------------------------------- helpers */

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** Keeps `null` as null: the API sends null for minTime/p50/p95 until a request completes. */
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------- notification health */

export const JOB_STATES = ['queued', 'processing', 'retry', 'completed', 'dead'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const JOB_STATE_LABELS: Record<JobState, string> = {
  queued: 'Queued',
  processing: 'Processing',
  retry: 'Retry',
  completed: 'Completed',
  dead: 'Dead',
};

export type NotificationHealth = {
  success?: boolean;
  jobs?: Partial<Record<JobState, number>>;
  oldestPendingAt?: string | null;
  lastCompletedAt?: string | null;
  lastWorkerActivityAt?: string | null;
  deadByErrorCode?: Array<{ code: string; count: number; lastFailedAt?: string | null }>;
  kinds?: string[];
  push?: Array<{ type: string; outcome: string; code: string; count: number }>;
};

export type QueueTone = 'success' | 'warning' | 'danger' | 'neutral';

/** A queued or retrying job older than this means the worker is not keeping up. */
export const STALE_QUEUE_MS = 10 * 60_000;

/** Zero-filled, in the API's own state order, whatever the payload left out. */
export function jobCounts(h: NotificationHealth | null | undefined): Array<{ state: JobState; count: number }> {
  const jobs = isRecord(h?.jobs) ? h.jobs : {};
  return JOB_STATES.map((state) => ({ state, count: Math.max(0, Math.round(num(jobs[state]))) }));
}

/** Whole seconds since `iso`, or null when it is missing or unparseable. */
export function ageSeconds(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

/**
 * dead > 0 -> danger; work waiting longer than STALE_QUEUE_MS -> warning;
 * a payload with counts -> success; no payload -> neutral.
 */
export function queueTone(h: NotificationHealth | null | undefined, now: number = Date.now()): QueueTone {
  if (!h || !isRecord(h.jobs)) return 'neutral';
  const counts = Object.fromEntries(jobCounts(h).map((r) => [r.state, r.count])) as Record<JobState, number>;
  if (counts.dead > 0) return 'danger';
  const age = ageSeconds(h.oldestPendingAt, now);
  if (counts.queued + counts.retry > 0 && age !== null && age * 1000 > STALE_QUEUE_MS) return 'warning';
  return 'success';
}

export type PushSummary = { delivered: number; failed: number; other: number; total: number };

/** failed = failed + retryable + invalid_token; everything else that is not delivered is "other". */
export function pushSummary(h: NotificationHealth | null | undefined): PushSummary {
  const out: PushSummary = { delivered: 0, failed: 0, other: 0, total: 0 };
  for (const row of Array.isArray(h?.push) ? h.push : []) {
    if (!isRecord(row)) continue;
    const count = Math.max(0, num(row.count));
    out.total += count;
    if (row.outcome === 'delivered') out.delivered += count;
    else if (row.outcome === 'failed' || row.outcome === 'retryable' || row.outcome === 'invalid_token') out.failed += count;
    else out.other += count;
  }
  return out;
}

/* --------------------------------------------------------- performance */

export type PerfEntry = {
  count?: number;
  avgTime?: number;
  minTime?: number | null;
  maxTime?: number;
  totalTime?: number;
  p50Time?: number | null;
  p95Time?: number | null;
};

export type PerfRow = {
  key: string;
  count: number;
  avgTime: number;
  minTime: number | null;
  maxTime: number;
  totalTime: number;
  p50Time: number | null;
  p95Time: number | null;
};

/** One row per route key, sorted by request volume; non-object entries are dropped. */
export function perfRows(stats: Record<string, PerfEntry> | null | undefined): PerfRow[] {
  if (!isRecord(stats)) return [];
  return Object.entries(stats)
    .filter((entry): entry is [string, PerfEntry] => isRecord(entry[1]))
    .map(([key, v]) => ({
      key,
      count: num(v.count),
      avgTime: num(v.avgTime),
      minTime: numOrNull(v.minTime),
      maxTime: num(v.maxTime),
      totalTime: num(v.totalTime),
      p50Time: numOrNull(v.p50Time),
      p95Time: numOrNull(v.p95Time),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Slowest p95 first, routes without a p95 sample last, ties by volume. */
export function rankByP95(rows: PerfRow[], n?: number): PerfRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.p95Time === null && b.p95Time === null) return b.count - a.count || a.key.localeCompare(b.key);
    if (a.p95Time === null) return 1;
    if (b.p95Time === null) return -1;
    return b.p95Time - a.p95Time || b.count - a.count || a.key.localeCompare(b.key);
  });
  return typeof n === 'number' ? sorted.slice(0, Math.max(0, n)) : sorted;
}

export type PerfTotals = {
  requests: number;
  avg: number;
  slowestKey: string;
  slowestMax: number;
  endpoints: number;
  worstP95Key: string | null;
  worstP95: number | null;
};

/** Order-independent aggregates for the throughput tiles; null for an empty map. There is no overall p50/p95 in the payload, so none is invented here. */
export function perfTotals(rows: PerfRow[]): PerfTotals | null {
  if (rows.length === 0) return null;
  const requests = rows.reduce((n, r) => n + r.count, 0);
  const totalTime = rows.reduce((n, r) => n + r.totalTime, 0);
  const slowest = rows.reduce((a, b) => (b.maxTime > a.maxTime ? b : a), rows[0]);
  const [worst] = rankByP95(rows, 1);
  return {
    requests,
    avg: requests > 0 ? totalTime / requests : 0,
    slowestKey: slowest.key,
    slowestMax: slowest.maxTime,
    endpoints: rows.length,
    worstP95Key: worst && worst.p95Time !== null ? worst.key : null,
    worstP95: worst && worst.p95Time !== null ? worst.p95Time : null,
  };
}

/* ----------------------------------------------------- client adoption */

export type ClientRelease = { version: string; build: string | null; release: string; users: number; share: number };

export type ClientAdoption = {
  windowDays?: number;
  since?: string;
  /** Built with Object.fromEntries on the API, so any header-grammar name ("constructor" included) can be a key. */
  platforms?: Record<string, { users: number; releases: ClientRelease[] }>;
  daily?: Array<{ date: string; platform: string; release: string; users: number }>;
};

export type AdoptionRow = {
  platform: string;
  release: string;
  version: string;
  build: string | null;
  users: number;
  share: number;
  /** The platform's total for the window; the same on every row of that platform. */
  platformUsers: number;
  /** True on the first row of each platform, for a grouped table. */
  first: boolean;
};

/**
 * Flattens platforms -> releases into table rows. Platforms sort by name;
 * release order is the API's (newest first). Only Object.entries touches the
 * map, so a platform named like an Object.prototype member cannot be misread.
 */
export function adoptionRows(a: ClientAdoption | null | undefined): AdoptionRow[] {
  const platforms = a?.platforms;
  if (!isRecord(platforms)) return [];
  return Object.entries(platforms)
    .filter((entry): entry is [string, { users: number; releases: ClientRelease[] }] => isRecord(entry[1]))
    .sort(([x], [y]) => x.localeCompare(y))
    .flatMap(([platform, p]) => {
      const platformUsers = Math.max(0, num(p.users));
      const releases = Array.isArray(p.releases) ? p.releases.filter(isRecord) : [];
      if (releases.length === 0) {
        return platformUsers > 0
          ? [{ platform, release: 'unknown', version: '', build: null, users: platformUsers, share: 100, platformUsers, first: true }]
          : [];
      }
      return releases.map((r, i) => {
        const version = typeof r.version === 'string' ? r.version : '';
        const build = r.build === null || r.build === undefined ? null : String(r.build);
        const release = typeof r.release === 'string' && r.release ? r.release : [version, build].filter(Boolean).join('+') || 'unknown';
        return { platform, release, version, build, users: Math.max(0, num(r.users)), share: num(r.share), platformUsers, first: i === 0 };
      });
    });
}

/** '90%' or '12.5%': one decimal only when the API sent one. */
export function formatShare(share: number): string {
  if (typeof share !== 'number' || !Number.isFinite(share)) return '—';
  const rounded = Math.round(share * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/* ------------------------------------------------------------ version */

/** The first seven characters of a commit sha; 'not set' when the deploy did not stamp one. */
export function shortSha(sha: string | null | undefined): string {
  const s = typeof sha === 'string' ? sha.trim() : '';
  return s ? s.slice(0, 7) : 'not set';
}
