/**
 * Terms and privacy re-consent (Wave C1), the pure half.
 *
 * The API keeps one row per accepted document version (models/LegalAcceptance.js)
 * and `GET /api/legal/acceptances` answers which of the two documents the
 * signed-in account still has to agree to against the current versions
 * (services/accountLifecycle.js legalStateFor): `pending` lists a document
 * when it has no row at all or its newest row is on an older version. The
 * web shows a blocking "Agree and continue" dialog while anything material is
 * pending and records the agreement with `POST /api/legal/accept`, exactly as
 * the mobile app does (int-vybe-app-mobile/src/hooks/useLegalVersions.ts).
 *
 * Everything here is import-free (types aside) so `node --test` can load it
 * through tests/ts-loader.mjs; the copy is the mobile app's word for word
 * (src/strings/account.ts `legal`) so both clients read the same.
 */
import type { ParsedApiError } from './apiError';

export type LegalDocumentKind = 'terms' | 'privacy';
export type AcceptanceSurface = 'signup' | 'login' | 'oauth' | 'interstitial' | 'settings';

export type LegalDocument = {
  document: LegalDocumentKind;
  title: string;
  /** `YYYY-MM-DD`, the page's "last updated" date; compared as a string by the API. */
  version: string;
  effectiveAt: string | null;
  /** true: blocking dialog; false: dismissible notice. */
  material: boolean;
  /** The API's absolute page URL; the web links to its own copy instead (legalPagePath). */
  url: string | null;
  summary: string[];
};

export type LegalCurrent = {
  terms: LegalDocument;
  privacy: LegalDocument;
  /**
   * Days of notice the API pledges before a material change takes effect
   * (LEGAL_NOTICE_DAYS). Informational: no route enforces it and the public
   * documents carry no fixed period, so nothing in the UI quotes it.
   */
  noticeDays: number | null;
};

export type LegalAcceptanceRecord = {
  version: string;
  acceptedAt: string | null;
  surface: string | null;
};

export type LegalState = {
  accepted: Record<LegalDocumentKind, LegalAcceptanceRecord | null>;
  /** Documents whose newest row is missing or on an older version; the server's answer, terms first. */
  pending: LegalDocumentKind[];
  current: LegalCurrent;
};

export type AcceptBody = {
  acceptances: Array<{ document: LegalDocumentKind; version: string }>;
  surface: AcceptanceSurface;
  client: { platform: 'web'; appVersion?: string };
};

export const LEGAL_DOCUMENT_KINDS: readonly LegalDocumentKind[] = Object.freeze(['terms', 'privacy']);

/** The surface the signed-in gate records under; sign-up rows are written by the API itself (surface 'signup'). */
export const GATE_SURFACE: AcceptanceSurface = 'interstitial';

/** The API refuses more than this many acceptances in one call (LEGAL_DOCUMENT_KINDS.length on the server). */
export const MAX_ACCEPTANCES = 5;

/** `client.appVersion` must match this or the API silently drops the whole `client` object. */
export const APP_VERSION_PATTERN = /^[A-Za-z0-9.+-]{1,40}$/;

/** react-query key for one account's legal state; the gate and Settings share the cache entry. */
export const LEGAL_QUERY_KEY = 'legal-acceptances';
export const legalQueryKey = (userId: string | null | undefined) => [LEGAL_QUERY_KEY, userId ?? null] as const;

/** Copy shared with the mobile app (src/strings/account.ts, `legal`); the STABLE strings must not change. */
export const LEGAL_COPY = Object.freeze({
  titleTerms: 'Our terms have changed',
  titlePrivacy: 'Our privacy policy has changed',
  titleBoth: 'Our terms and privacy policy have changed',
  noticeTitle: 'A small update to our terms',
  noticeBody: 'Nothing you need to do. Read the changes when you like.',
  effective: (date: string) => `Effective ${date}.`,
  summaryHeading: 'In short',
  readTerms: 'Read the full terms',
  readPrivacy: 'Read the full privacy policy',
  /** STABLE */
  agree: 'Agree and continue',
  agreeLabel: 'Agree to the updated documents and continue',
  agreeing: 'Saving…',
  /** STABLE */
  gotIt: 'Got it',
  gotItLabel: 'Dismiss this notice',
  accepted: 'Thanks. You’re all set.',
  stale: 'These documents changed again just now. Here is the latest.',
  acceptFailed: 'Could not record your agreement. Try again.',
  /** Web only: a browser tab that cannot be left needs an honest exit. */
  signOut: 'Sign out',
  opensInNewTab: ' (opens in a new tab)',
});

/* ------------------------------------------------------------------ parsing */

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

export const isLegalDocumentKind = (value: unknown): value is LegalDocumentKind =>
  value === 'terms' || value === 'privacy';

const DEFAULT_TITLE: Record<LegalDocumentKind, string> = { terms: 'Terms and Conditions', privacy: 'Privacy Policy' };

/** Terms before privacy, whatever order the server or a caller used. */
const termsFirst = (a: { document: LegalDocumentKind }, b: { document: LegalDocumentKind }) =>
  a.document === b.document ? 0 : a.document === 'terms' ? -1 : 1;

function normalizeDocument(kind: LegalDocumentKind, raw: unknown): LegalDocument | null {
  const record = asRecord(raw);
  const version = text(record.version);
  if (!version) return null;
  const summary = Array.isArray(record.summary)
    ? record.summary.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    : [];
  return {
    document: kind,
    title: text(record.title) ?? DEFAULT_TITLE[kind],
    version: version.trim(),
    effectiveAt: text(record.effectiveAt),
    // A change is treated as material unless the API says otherwise: a
    // missing flag must never turn a blocking dialog into a dismissible note.
    material: record.material !== false,
    url: text(record.url),
    summary,
  };
}

/** The `GET /legal/current` body (also carried as `current` on `GET /legal/acceptances`); null when a document is missing. */
export function normalizeLegalCurrent(raw: unknown): LegalCurrent | null {
  const record = asRecord(raw);
  const terms = normalizeDocument('terms', record.terms);
  const privacy = normalizeDocument('privacy', record.privacy);
  if (!terms || !privacy) return null;
  const days = record.noticeDays;
  return {
    terms,
    privacy,
    noticeDays: typeof days === 'number' && Number.isInteger(days) && days > 0 ? days : null,
  };
}

function normalizeAcceptance(raw: unknown): LegalAcceptanceRecord | null {
  const record = asRecord(raw);
  const version = text(record.version);
  if (!version) return null;
  return { version: version.trim(), acceptedAt: text(record.acceptedAt), surface: text(record.surface) };
}

/**
 * The `GET /legal/acceptances` body. Tolerant like mobile's
 * normalizeLegalAcceptances: unknown kinds in `pending` are dropped, records
 * without a version count as absent. Null when `current` is unusable, which
 * the gate treats as "nothing to show" (fail open) rather than guessing.
 */
export function normalizeLegalState(raw: unknown): LegalState | null {
  const body = asRecord(raw);
  const current = normalizeLegalCurrent(body.current);
  if (!current) return null;
  const accepted = asRecord(body.accepted);
  const pending = Array.from(new Set((Array.isArray(body.pending) ? body.pending : []).filter(isLegalDocumentKind)))
    .map((document) => ({ document }))
    .sort(termsFirst)
    .map((entry) => entry.document);
  return {
    accepted: { terms: normalizeAcceptance(accepted.terms), privacy: normalizeAcceptance(accepted.privacy) },
    pending,
    current,
  };
}

/** The `pending` list of a `POST /legal/accept` answer, cleaned the same way. */
export function pendingKinds(raw: unknown): LegalDocumentKind[] {
  return Array.from(new Set((Array.isArray(raw) ? raw : []).filter(isLegalDocumentKind)))
    .map((document) => ({ document }))
    .sort(termsFirst)
    .map((entry) => entry.document);
}

/* ------------------------------------------------------------------ decisions */

/** The documents the person still has to agree to, terms first; empty for a clear account or no state. */
export function pendingDocuments(state: LegalState | null | undefined): LegalDocument[] {
  if (!state) return [];
  return state.pending.map((kind) => state.current[kind]).filter((doc): doc is LegalDocument => Boolean(doc)).sort(termsFirst);
}

/** Any material document pending means the blocking dialog; none means the dismissible notice. */
export const isMaterial = (documents: ReadonlyArray<Pick<LegalDocument, 'material'>>): boolean =>
  documents.some((doc) => doc.material);

/** Which title the set of pending documents takes (mobile legalInterstitialTitle). */
export function legalTitle(documents: ReadonlyArray<Pick<LegalDocument, 'document'>>): string {
  const hasTerms = documents.some((doc) => doc.document === 'terms');
  const hasPrivacy = documents.some((doc) => doc.document === 'privacy');
  if (hasTerms && hasPrivacy) return LEGAL_COPY.titleBoth;
  if (hasPrivacy) return LEGAL_COPY.titlePrivacy;
  return LEGAL_COPY.titleTerms;
}

export const readLabel = (document: Pick<LegalDocument, 'document'>): string =>
  document.document === 'privacy' ? LEGAL_COPY.readPrivacy : LEGAL_COPY.readTerms;

/**
 * The web's own copy of each document (public/). Relative on purpose: the
 * API's `url` points at FRONTEND_URL, and a staging build must not send
 * people to production.
 */
export const legalPagePath = (document: Pick<LegalDocument, 'document'>): '/privacy-policy.html' | '/terms-and-conditions.html' =>
  document.document === 'privacy' ? '/privacy-policy.html' : '/terms-and-conditions.html';

/**
 * `client.appVersion` for the acceptance row, derived from the X-Vybe-Client
 * value (`web/1.0.0+5228f21c0ffe` -> `1.0.0+5228f21c0ffe`). The raw header
 * contains a slash, which the server pattern refuses, and a refused value
 * makes the server drop the whole `client` object; so the platform prefix is
 * stripped and anything that still fails the pattern is left out.
 */
export function clientAppVersion(headerOrVersion: string | null | undefined): string | null {
  if (typeof headerOrVersion !== 'string') return null;
  const version = headerOrVersion.trim().replace(/^[A-Za-z][A-Za-z0-9-]{0,15}\//, '');
  return APP_VERSION_PATTERN.test(version) ? version : null;
}

/** The exact `POST /legal/accept` body: one acceptance per pending document at the version shown. */
export function acceptBody(
  documents: ReadonlyArray<Pick<LegalDocument, 'document' | 'version'>>,
  surface: AcceptanceSurface,
  appVersion: string | null | undefined,
): AcceptBody {
  const seen = new Set<LegalDocumentKind>();
  const acceptances: AcceptBody['acceptances'] = [];
  for (const doc of documents) {
    if (seen.has(doc.document) || acceptances.length >= MAX_ACCEPTANCES) continue;
    seen.add(doc.document);
    acceptances.push({ document: doc.document, version: doc.version });
  }
  const version = clientAppVersion(appVersion);
  return {
    acceptances,
    surface,
    client: { platform: 'web', ...(version ? { appVersion: version } : {}) },
  };
}

/** `409 LEGAL_VERSION_STALE`: the version the dialog showed is no longer current; refetch and show the latest. */
export const isLegalVersionStale = (parsed: Pick<ParsedApiError, 'status' | 'code'>): boolean =>
  parsed.status === 409 && parsed.code === 'LEGAL_VERSION_STALE';

/* ------------------------------------------------------------------ dates */

const LONG_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };

function longDate(iso: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  try {
    return date.toLocaleDateString(undefined, options);
  } catch {
    return date.toDateString();
  }
}

/**
 * "July 28, 2026" for a document's effective date. The version is a calendar
 * date the API serialises as midnight UTC, so it is formatted in UTC: in the
 * Americas a local rendering would read "July 27", disagreeing with the page
 * itself ("Effective and last updated: July 28, 2026").
 */
export const formatEffectiveDate = (iso: string | null | undefined): string => longDate(iso, { ...LONG_DATE, timeZone: 'UTC' });

/** "September 19, 2026" in the browser's locale and zone for the moment an account agreed. */
export const formatAcceptedDate = (iso: string | null | undefined): string => longDate(iso, LONG_DATE);

/** The one-line status of a document for Settings. */
export function acceptanceLine(record: LegalAcceptanceRecord | null, current: Pick<LegalDocument, 'version'>): string {
  if (!record) return 'No agreement on record for this account yet.';
  const when = formatAcceptedDate(record.acceptedAt);
  if (record.version === current.version) return when ? `You agreed to this version on ${when}.` : 'You agreed to this version.';
  return when
    ? `You agreed to version ${record.version} on ${when}. The current version is waiting for your agreement.`
    : `You agreed to version ${record.version}. The current version is waiting for your agreement.`;
}
