/**
 * Pure helpers for the account data lifecycle (Settings > Account): the
 * re-auth token, scheduled or immediate deletion, and the data export jobs.
 * No React and no axios so `node --test` can import it through
 * tests/ts-loader.mjs; HTTP errors are read structurally (see HttpFailure).
 *
 * Shapes mirror vybe-backend @ 4e22914:
 *   controllers/accountLifecycleController.js, services/accountLifecycle.js,
 *   controllers/dataExportController.js, services/dataExport.js.
 */

/* ------------------------------------------------------------------ types */

/** Which proofs the account can offer to POST /auth/reauth. */
export type ReauthMethods = {
  password: boolean;
  emailCode: boolean;
  /** A passwordless account may take the scheduled path with no re-auth. */
  scheduledWithoutReauth: boolean;
};

export const NO_REAUTH_METHODS: ReauthMethods = { password: false, emailCode: false, scheduledWithoutReauth: false };

/** 200 body of POST /auth/reauth. Memory only; never stored. */
export type ReauthResult = { reauthToken: string; expiresIn: number; expiresAt: string };

export type ReauthPurpose = 'delete' | 'export' | 'download' | 'ownership';

export type DeletionInfo = {
  requestedAt: string;
  scheduledFor: string;
  mode: 'scheduled' | string;
  reasons: string[];
};

/** GET /users/me/deletion. */
export type DeletionStatus = {
  pendingDeletion: boolean;
  deletion: DeletionInfo | null;
  graceDays: number;
  backupRetentionDays: number;
  reauth: ReauthMethods;
};

/** 200 (deleted) or 202 (scheduled) body of DELETE /users/me. */
export type DeletionOutcome =
  | { state: 'deleted'; message?: string; completedAt: string; backupsPurgeBy: string; receiptId: string; noticeChannel: 'email' | 'none' }
  | { state: 'processing'; message?: string }
  | { state: 'scheduled'; scheduledFor: string; graceDays: number; keepAccount: string; noticeChannel: 'email' | 'none'; reauthWaived?: string };

/** POST /users/me/deletion/cancel. */
export type CancelDeletionResult = { state: 'kept'; pendingDeletion: false; wasPending: boolean; message: string };

export type ExportJobStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'expired' | 'cancelled';

/** One row of GET /users/me/exports (presentExportJob). */
export type ExportJob = {
  id: string;
  status: ExportJobStatus;
  scopes: string[];
  requestedAt: string;
  startedAt: string | null;
  readyAt: string | null;
  expiresAt: string | null;
  archiveBytes: number | null;
  fileName: string | null;
  downloadCount: number;
  lastDownloadAt: string | null;
  downloadable: boolean;
  /** Present only while status === 'failed'. */
  error?: { code: string };
};

export type ExportPolicy = {
  windowDays: number;
  expiryDays: number;
  downloadUrlTtlMinutes: number;
  reauthRequired: boolean;
  /** Set only while the one-per-window rule blocks a new request. */
  nextAllowedAt: string | null;
  scopes: string[];
};

export type ExportList = { jobs: ExportJob[]; policy: ExportPolicy };

/** GET /users/me/exports/:id/download. */
export type ExportDownload = {
  download: { url: string; expiresAt: string | number; fileName: string | null; bytes: number | null };
  job: ExportJob;
};

/** What the sign-in page says once, right after a deletion request. */
export type LifecycleNotice =
  | { kind: 'deleted'; completedAt: string; backupsPurgeBy: string | null }
  | { kind: 'scheduled'; scheduledFor: string; graceDays: number };

export type DateFormatOptions = { locale?: string; timeZone?: string };

/* ------------------------------------------------------------------ dates */

const parseDate = (iso: string | number | Date | null | undefined): Date | null => {
  if (iso === null || iso === undefined || iso === '') return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "October 3, 2026 at 1:04 PM" (browser locale and zone by default); "—" when empty or invalid. */
export function formatDeletionDate(iso: string | number | Date | null | undefined, opts: DateFormatOptions = {}): string {
  const date = parseDate(iso);
  if (!date) return '—';
  return new Intl.DateTimeFormat(opts.locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(date);
}

/** "October 3, 2026"; "—" when empty or invalid. */
export function formatDateOnly(iso: string | number | Date | null | undefined, opts: DateFormatOptions = {}): string {
  const date = parseDate(iso);
  if (!date) return '—';
  return new Intl.DateTimeFormat(opts.locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(date);
}

/** "Sep 19, 2026" for compact rows; "—" when empty or invalid. */
export function formatShortDate(iso: string | number | Date | null | undefined, opts: DateFormatOptions = {}): string {
  const date = parseDate(iso);
  if (!date) return '—';
  return new Intl.DateTimeFormat(opts.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(date);
}

/* ------------------------------------------------------------------ exports */

export type ExportStateTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type ExportStateLabel = { label: string; tone: ExportStateTone; detail?: string };

export const EXPORT_FAILURE_COPY = 'We could not prepare your data. You can request it again.';

/** One sentence for a failed job. Never the raw code: the API's codes are for logs. */
export function exportFailureCopy(_code?: string | null): string {
  return EXPORT_FAILURE_COPY;
}

/**
 * The badge for a job row. The API already folds its internal retry state
 * (including a DISK_LOW deferral) into `queued`, so there is no "deferred"
 * label to invent; a ready job past its expiry reads as expired before the
 * sweep flips its status.
 */
export function exportStateLabel(
  job: Pick<ExportJob, 'status' | 'downloadable'> & Partial<Pick<ExportJob, 'expiresAt' | 'error'>>,
  now: number = Date.now(),
): ExportStateLabel {
  switch (job.status) {
    case 'queued':
      return { label: 'Queued', tone: 'info' };
    case 'processing':
      return { label: 'Building', tone: 'info' };
    case 'ready': {
      const expires = parseDate(job.expiresAt ?? null);
      const stillValid = job.downloadable && (!expires || expires.getTime() > now);
      return stillValid ? { label: 'Ready', tone: 'success' } : { label: 'Expired', tone: 'neutral' };
    }
    case 'expired':
      return { label: 'Expired', tone: 'neutral' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral' };
    case 'failed':
      return { label: 'Failed', tone: 'danger', detail: exportFailureCopy(job.error?.code) };
    default:
      return { label: 'Unknown', tone: 'neutral' };
  }
}

/** True while a job is still going to change on its own (poll the list). */
export const isExportActive = (job: Pick<ExportJob, 'status'>): boolean =>
  job.status === 'queued' || job.status === 'processing';

/** True while a job blocks a new request (the API answers 409 EXPORT_IN_PROGRESS). */
export const isExportBlocking = (job: Pick<ExportJob, 'status' | 'downloadable'>, now: number = Date.now()): boolean =>
  isExportActive(job) || (job.status === 'ready' && exportStateLabel(job, now).label === 'Ready');

const plainDays = (n: number): string => (n === 1 ? '1 day' : `${n} days`);

/**
 * The one-per-window rule in two sentences, plus the next allowed date while
 * the window blocks a new request.
 */
export function exportWindowCopy(
  policy: Pick<ExportPolicy, 'windowDays' | 'expiryDays' | 'nextAllowedAt'>,
  opts: DateFormatOptions & { now?: number } = {},
): { rule: string; next: string | null } {
  const rule =
    `You can request one copy every ${plainDays(policy.windowDays)}. ` +
    `Each copy stays available for ${plainDays(policy.expiryDays)} after it is ready.`;
  const nextAt = parseDate(policy.nextAllowedAt);
  const now = opts.now ?? Date.now();
  const next = nextAt && nextAt.getTime() > now ? `You can request another copy on ${formatDateOnly(nextAt, opts)}.` : null;
  return { rule, next };
}

/** "12.4 MB", "820 KB", "—" for null. */
export function formatArchiveSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ------------------------------------------------------------------ errors */

/** The subset of an HTTP failure this module reads; structural so axios and fetch errors both fit. */
export type HttpFailure = { code?: string; message?: string; response?: { status?: number; data?: unknown } };

const asFailure = (error: unknown): HttpFailure => (error && typeof error === 'object' ? (error as HttpFailure) : {});

export const httpStatusOf = (error: unknown): number | undefined => asFailure(error).response?.status;

export const httpCodeOf = (error: unknown): string | undefined => {
  const data = asFailure(error).response?.data as { code?: unknown } | undefined;
  return typeof data?.code === 'string' ? data.code : undefined;
};

export const httpMessageOf = (error: unknown): string | undefined => {
  const data = asFailure(error).response?.data as { message?: unknown } | undefined;
  return typeof data?.message === 'string' && data.message.trim() ? data.message.trim() : undefined;
};

/** The API wants a fresh X-Reauth token: open the re-auth dialog, never sign out. */
export function isReauthRequired(error: unknown): boolean {
  return httpStatusOf(error) === 401 && httpCodeOf(error) === 'REAUTH_REQUIRED';
}

/** The re-auth methods the API attached to a 401 REAUTH_REQUIRED, if any. */
export function reauthMethodsFromError(error: unknown): ReauthMethods | null {
  const data = asFailure(error).response?.data as { methods?: Partial<ReauthMethods> } | undefined;
  const methods = data?.methods;
  if (!methods || typeof methods !== 'object') return null;
  return {
    password: methods.password === true,
    emailCode: methods.emailCode === true,
    scheduledWithoutReauth: methods.scheduledWithoutReauth === true,
  };
}

export const OFFLINE_REAUTH_COPY = 'Could not reach Vybe. Check your connection and try again.';
export const RATE_LIMITED_REAUTH_COPY = 'Too many attempts. Try again in a few minutes.';
export const NO_PASSWORD_REAUTH_COPY = 'This account has no password. Use an email code instead.';

/** One sentence for the re-auth dialog from an HTTP failure. */
export function reauthErrorCopy(error: unknown, fallback = 'Could not confirm it is you. Try again.'): string {
  const failure = asFailure(error);
  const status = failure.response?.status;
  const code = httpCodeOf(error);
  const message = httpMessageOf(error);
  if (!status && (failure.code === 'ERR_NETWORK' || failure.code === 'ECONNABORTED')) return OFFLINE_REAUTH_COPY;
  if (status === 429) return RATE_LIMITED_REAUTH_COPY;
  if (status === 409 && code === 'REAUTH_METHOD_UNAVAILABLE') return NO_PASSWORD_REAUTH_COPY;
  if (status === 400 && code === 'REAUTH_FAILED') return message ? ensureFullStop(message) : 'That password is not right.';
  if (status === 400 && code === 'VALIDATION') {
    const field = (failure.response?.data as { field?: unknown } | undefined)?.field;
    if (field === 'code') return 'Enter the 6-digit code from your email.';
    if (field === 'password') return 'Enter your password.';
  }
  return message ? ensureFullStop(message) : fallback;
}

const ensureFullStop = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

export const GENERIC_FAILURE_COPY = 'Vybe could not complete that. Try again.';

/**
 * One sentence for an HTTP status whose body carried nothing for the person:
 * a gateway's HTML error page, the global limiter's plain text, or no answer
 * at all. Never the body itself.
 */
export function lifecycleStatusCopy(status: number): string {
  if (!status) return OFFLINE_REAUTH_COPY;
  if (status === 429) return RATE_LIMITED_REAUTH_COPY;
  return GENERIC_FAILURE_COPY;
}

/* ------------------------------------------------------------------ reauth gate */

export type ReauthGateInput =
  /** A guarded action is about to start. */
  | { phase: 'start'; cachedToken: string | null; waive: boolean }
  /** The action (with a cached token, a waiver, or a fresh token) failed. */
  | { phase: 'failed'; error: unknown }
  /** The person dismissed the dialog. */
  | { phase: 'cancel'; inFlight: boolean };

export type ReauthGateDecision =
  /** Call the action now, with this X-Reauth token (null = none, the waived path). */
  | { kind: 'run'; token: string | null }
  /** Open the dialog, or keep it open; `methods` are the proofs the API named on its 401. */
  | { kind: 'prompt'; methods: ReauthMethods | null; clearCache: boolean }
  /** Surface the error to the caller. */
  | { kind: 'reject' }
  /** Resolve the caller with null. */
  | { kind: 'cancelled' }
  /** The action is already on its way; the dismissal is refused. */
  | { kind: 'ignore' };

/**
 * What useReauthGate does next. Pure, so the security-relevant flow (cached
 * token first, 401 REAUTH_REQUIRED reopens instead of signing out, a refused
 * fresh token keeps the dialog open, no cancel while the request is in
 * flight) is tested under node without React.
 */
export function reauthGateDecision(input: { phase: 'start'; cachedToken: string | null; waive: boolean }): { kind: 'run'; token: string | null } | { kind: 'prompt'; methods: null; clearCache: false };
export function reauthGateDecision(input: { phase: 'failed'; error: unknown }): { kind: 'prompt'; methods: ReauthMethods | null; clearCache: true } | { kind: 'reject' };
export function reauthGateDecision(input: { phase: 'cancel'; inFlight: boolean }): { kind: 'cancelled' } | { kind: 'ignore' };
export function reauthGateDecision(input: ReauthGateInput): ReauthGateDecision;
export function reauthGateDecision(input: ReauthGateInput): ReauthGateDecision {
  switch (input.phase) {
    case 'start':
      if (input.cachedToken) return { kind: 'run', token: input.cachedToken };
      if (input.waive) return { kind: 'run', token: null };
      return { kind: 'prompt', methods: null, clearCache: false };
    case 'failed':
      if (isReauthRequired(input.error)) return { kind: 'prompt', methods: reauthMethodsFromError(input.error), clearCache: true };
      return { kind: 'reject' };
    case 'cancel':
      return input.inFlight ? { kind: 'ignore' } : { kind: 'cancelled' };
  }
}

/* ------------------------------------------------------------------ notices */

const NOTICE_KEY = 'vybe.lifecycleNotice';

const storage = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

const isNotice = (value: unknown): value is LifecycleNotice => {
  if (!value || typeof value !== 'object') return false;
  const n = value as Record<string, unknown>;
  if (n.kind === 'deleted') return typeof n.completedAt === 'string' && (typeof n.backupsPurgeBy === 'string' || n.backupsPurgeBy === null);
  if (n.kind === 'scheduled') return typeof n.scheduledFor === 'string' && typeof n.graceDays === 'number';
  return false;
};

/**
 * One-shot hand-off from Settings to the sign-in page: set right before the
 * sign-out redirect, read once by Login. sessionStorage so it survives the
 * navigation and nothing else (same pattern as signOutReason in api.ts).
 */
export const lifecycleNotice = {
  set: (notice: LifecycleNotice): void => {
    try {
      storage()?.setItem(NOTICE_KEY, JSON.stringify(notice));
    } catch {
      // Storage can be unavailable (privacy mode); the sign-in page then shows nothing extra.
    }
  },
  take: (): LifecycleNotice | null => {
    try {
      const store = storage();
      if (!store) return null;
      const raw = store.getItem(NOTICE_KEY);
      store.removeItem(NOTICE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isNotice(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  peek: (): LifecycleNotice | null => {
    try {
      const raw = storage()?.getItem(NOTICE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isNotice(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
};

export type NoticeCopy = { tone: 'success' | 'warning'; title: string; body: string };

/** The sign-in page's callout for a notice. */
export function lifecycleNoticeCopy(notice: LifecycleNotice, opts: DateFormatOptions = {}): NoticeCopy {
  if (notice.kind === 'deleted') {
    return {
      tone: 'success',
      title: `Your account was deleted on ${formatDeletionDate(notice.completedAt, opts)}.`,
      body: notice.backupsPurgeBy
        ? `Copies in backups are overwritten by ${formatDateOnly(notice.backupsPurgeBy, opts)}.`
        : 'Copies in backups are overwritten through the ordinary backup cycle.',
    };
  }
  return {
    tone: 'warning',
    title: `Your account is scheduled for deletion on ${formatDeletionDate(notice.scheduledFor, opts)}.`,
    body: 'Sign in before then and choose Cancel deletion to keep it.',
  };
}

/** The pending banner's first line, shared by Settings and the sign-in interstitial. */
export function pendingDeletionTitle(scheduledFor: string | null | undefined, opts: DateFormatOptions = {}): string {
  return `Your account is scheduled for deletion on ${formatDeletionDate(scheduledFor, opts)}.`;
}

export const PENDING_DELETION_BODY = 'Nothing is removed until then. Cancel to keep your account and everything in it.';

/* ------------------------------------------------------------------ reauth cache */

type CachedReauth = { token: string; expiresAt: number };
let cached: CachedReauth | null = null;

/**
 * The last re-auth token, in module memory only. A token lives ten minutes
 * and is voided by a password change; callers clear it on REAUTH_REQUIRED and
 * re-prompt. Nothing here touches storage.
 */
export const reauthCache = {
  /** The token while it has at least `minRemainingMs` left, else null. */
  get: (minRemainingMs = 30_000, now: number = Date.now()): string | null => {
    if (!cached) return null;
    if (cached.expiresAt - now < minRemainingMs) {
      cached = null;
      return null;
    }
    return cached.token;
  },
  set: (result: Pick<ReauthResult, 'reauthToken' | 'expiresAt' | 'expiresIn'>, now: number = Date.now()): void => {
    const at = parseDate(result.expiresAt);
    const expiresAt = at ? at.getTime() : now + (Number(result.expiresIn) || 600) * 1000;
    cached = { token: result.reauthToken, expiresAt };
  },
  clear: (): void => {
    cached = null;
  },
};
