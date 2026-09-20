/**
 * Pure shaping for the staff console's Feature flags page
 * (src/pages/admin/AdminFlags.tsx) over the Wave G admin flags contract:
 *
 *   GET /api/admin/flags        -> { flags: AdminFlagRow[] } for every registered name
 *   PUT /api/admin/flags/:name  -> the row; body { enabled?, percentage?, allowlist?, note? }
 *                                  404 FLAG_NOT_FOUND (names outside the registry: there
 *                                  are no ad-hoc flags), 400 FLAG_INVALID { field },
 *                                  400 UNSUPPORTED_FIELD; each PUT writes an
 *                                  AdminAuditLog row and clears the capabilities cache.
 *
 * No imports, no React, so it is unit tested under node --test
 * (tests/admin-flags.test.mjs). The registry below is the web's copy of the
 * API's DEFAULT_FLAG_NAMES (services/featureFlags.js) plus the thirty Wave G
 * flags of WAVE-G-PLAN.md §1.4; a name the API returns that is not here is
 * still listed, with "Not in the web registry" as its note, and a name here
 * that the API does not return is listed without controls, because a PUT to
 * it would answer FLAG_NOT_FOUND on that build.
 */

/* ------------------------------------------------------------------ rows */

/** One row of GET /api/admin/flags, normalised: every field present, every type settled. */
export type AdminFlagRow = {
  name: string;
  enabled: boolean;
  /** Whole number 0–100. */
  percentage: number;
  /** 24-hex member ids. */
  allowlist: string[];
  note: string;
  updatedBy: string | null;
  updatedAt: string | null;
  /** false: no document yet, the API reports the code default. */
  seeded: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

const wholePercentage = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100) return fallback;
  return n;
};

/** Read one row from any body shape; null when it has no usable name. */
export function normalizeFlagRow(raw: unknown): AdminFlagRow | null {
  if (!isRecord(raw)) return null;
  const name = text(raw.name);
  if (!name) return null;
  const allowlist = Array.isArray(raw.allowlist)
    ? raw.allowlist.map((id) => (typeof id === 'string' ? id.trim() : isRecord(id) && typeof id.toString === 'function' ? String(id) : '')).filter(Boolean)
    : [];
  return {
    name,
    enabled: raw.enabled === true,
    percentage: wholePercentage(raw.percentage, 100),
    allowlist,
    note: typeof raw.note === 'string' ? raw.note : '',
    updatedBy: text(raw.updatedBy),
    updatedAt: text(raw.updatedAt),
    seeded: raw.seeded !== false,
  };
}

/** The list from `{ flags: [...] }` (or a bare array); rows without a name are dropped. */
export function normalizeFlagRows(body: unknown): AdminFlagRow[] {
  const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.flags) ? body.flags : [];
  const rows: AdminFlagRow[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const row = normalizeFlagRow(raw);
    if (row && !seen.has(row.name)) {
      seen.add(row.name);
      rows.push(row);
    }
  }
  return rows;
}

/* -------------------------------------------------------------- registry */

export type FlagGroupKey = 'earlier' | 'G-1' | 'G-2' | 'G-3' | 'G-4' | 'G-5' | 'G-6' | 'G-7' | 'unknown';

export type FlagGroup = { key: FlagGroupKey; title: string; description: string };

/** Display order: the flags already live, then the Wave G packages, then anything the web does not know. */
export const FLAG_GROUPS: readonly FlagGroup[] = Object.freeze([
  { key: 'earlier', title: 'Earlier waves', description: 'Flags that shipped before Wave G (docs/DEPLOYMENT.md runtime configuration).' },
  { key: 'G-1', title: 'G-1 · Messaging v2', description: 'Requests, voice notes, Training Mode and shared cards in chat.' },
  { key: 'G-2', title: 'G-2 · Feed modes, Explore and composer', description: 'For you, Explore, hidden details and the new composer.' },
  { key: 'G-3', title: 'G-3 · Programs and routines', description: 'Programs, enrolments and routine share links.' },
  { key: 'G-4', title: 'G-4 · Gym community v2', description: 'Moderation, notification levels, announcements, ownership and roles.' },
  { key: 'G-5', title: 'G-5 · Push v2', description: 'Collapsing, digests, link previews and push actions.' },
  { key: 'G-6', title: 'G-6 · Challenges, Buddy Rhythm and level', description: 'Challenges v2, photo proof, buddies and the presence level.' },
  { key: 'G-7', title: 'G-7 · Insights and recap v2', description: 'Insights, training load, suggestions, meals by week, Focus and welcome back.' },
  { key: 'unknown', title: 'Not in the web registry', description: 'Names the API registers that this console build does not know. They can still be changed.' },
]);

export type KnownFlag = {
  name: string;
  group: Exclude<FlagGroupKey, 'unknown'>;
  note: string;
};

/**
 * Every flag the web knows. Notes are the operator's one-line reminder of
 * what the flag gates and when to flip it; the source of truth for the
 * earlier flags is docs/DEPLOYMENT.md, for Wave G WAVE-G-PLAN.md §1.4.
 */
export const KNOWN_FLAGS: readonly KnownFlag[] = Object.freeze([
  // Earlier waves (services/featureFlags.js DEFAULT_FLAG_NAMES).
  { name: 'live', group: 'earlier', note: 'Live video surfaces. Offered only when a livestream relay is also configured.' },
  { name: 'reviewPrompt', group: 'earlier', note: 'In-app review request after Workout Complete (D-30).' },
  { name: 'sessions', group: 'earlier', note: 'Training-together sessions rollout. The SESSIONS_ENABLED kill switch is separate.' },
  { name: 'telemetry.crashReports', group: 'earlier', note: 'Crash-report upload from the app (D-02).' },
  { name: 'reports.eventTarget', group: 'earlier', note: 'The client offers "Report event". The event report target exists since Wave C2.' },
  { name: 'achievementAutoAward', group: 'earlier', note: 'Trigger-driven achievement awards and hiding Claim on mobile (D-60). Enable only after the silent backfill.' },
  { name: 'invites', group: 'earlier', note: 'Every /api/invites route and the public preview. Flip once the mobile build and the web /join landing are live.' },
  { name: 'healthImport', group: 'earlier', note: 'Every /api/health/imports route and the Connect card. Needs the HealthKit entitlement build (PRE-F-1).' },
  { name: 'progression', group: 'earlier', note: 'The progression hub and the records API (Wave F).' },
  // G-1 Messaging v2.
  { name: 'messageRequests', group: 'G-1', note: 'Message requests: a first message from someone who is not a friend waits in Requests.' },
  { name: 'voiceNotes', group: 'G-1', note: 'Voice notes in chat. Only on a build that carries PRE-G-1.' },
  { name: 'trainingMode', group: 'G-1', note: 'Training Mode: holds chat notifications during a session and catches up after.' },
  { name: 'sharedObjectCards', group: 'G-1', note: 'Workout, routine and meal cards shared into chat.' },
  // G-2 Feed modes, Explore and composer.
  { name: 'feedForYou', group: 'G-2', note: 'The For you feed mode beside Following.' },
  { name: 'explore', group: 'G-2', note: 'The Explore surface: trending posts and hashtags.' },
  { name: 'hiddenDetails', group: 'G-2', note: 'Hidden details on a post and the What you see controls.' },
  { name: 'composerV2', group: 'G-2', note: 'The redesigned post composer.' },
  // G-3 Programs and routines.
  { name: 'programs', group: 'G-3', note: 'Programs and enrolments. Routes answer 404 FEATURE_DISABLED while off.' },
  { name: 'routineShareLinks', group: 'G-3', note: 'Routine share links (/r/<token>) and their public preview.' },
  // G-4 Gym community v2.
  { name: 'gymModerationQueue', group: 'G-4', note: 'The community moderation queue, log and notes.' },
  { name: 'gymNotificationLevels', group: 'G-4', note: 'Per-community notification levels.' },
  { name: 'gymAnnouncements', group: 'G-4', note: 'Announcement posts in gym communities.' },
  { name: 'gymOwnership', group: 'G-4', note: 'Ownership offers and roles in a community.' },
  { name: 'gymRegular', group: 'G-4', note: 'The Regular role for frequent members.' },
  { name: 'gymOwnerClaim', group: 'G-4', note: 'The gym-owner claim flow. Unclaimed place communities read "not run by the gym" meanwhile.' },
  // G-5 Push v2.
  { name: 'pushCollapse', group: 'G-5', note: 'Collapsed push notifications by bundle key.' },
  { name: 'friendDigest', group: 'G-5', note: 'The friend activity digest push.' },
  { name: 'linkUnfurl', group: 'G-5', note: 'Link previews in messages.' },
  { name: 'pushActions', group: 'G-5', note: 'Action buttons on push notifications.' },
  // G-6 Challenges, Buddy Rhythm and level.
  { name: 'challengesV2', group: 'G-6', note: 'Challenges v2: group goals and boards.' },
  { name: 'challengePhotoProof', group: 'G-6', note: 'Photo proof for challenges. A logged or imported session satisfies proof without a photo meanwhile.' },
  { name: 'buddyRhythm', group: 'G-6', note: 'Buddy Rhythm pairs and the weekly nudge.' },
  { name: 'presenceLevel', group: 'G-6', note: 'The presence ledger and level names (Getting started to Mainstay).' },
  // G-7 Insights and recap v2.
  { name: 'insightsV2', group: 'G-7', note: 'Insights v2 on the Rhythm screen.' },
  { name: 'trainingLoad', group: 'G-7', note: 'Training load from logged sessions.' },
  { name: 'rhythmSuggestions', group: 'G-7', note: 'Rhythm suggestions.' },
  { name: 'mealsWeeks', group: 'G-7', note: 'Meals by week in insights.' },
  { name: 'focus', group: 'G-7', note: 'Focus: one thing to work on this week.' },
  { name: 'welcomeBack', group: 'G-7', note: 'The welcome-back sheet after a long absence. It suppresses What’s New and the review prompt for that session.' },
]);

export type StaysFalseDecision = { decision: string; reason: string };

/**
 * Flags the owner decided stay `false` past the wave. The page shows the
 * decision beside the row and asks for a confirmation before enabling one.
 */
export const STAYS_FALSE: Readonly<Record<string, StaysFalseDecision>> = Object.freeze({
  gymOwnerClaim: {
    decision: 'D-98',
    reason: 'Built behind the flag until a second reviewer can meet the 5-business-day review promise.',
  },
  challengePhotoProof: {
    decision: 'D-99',
    reason: 'Photo proof stays off until an image-moderation path exists (a classifier or a human queue).',
  },
  presenceLevel: {
    decision: 'D-101',
    reason: 'Built dark; the level thresholds get an 8-week tune before anyone sees them.',
  },
});

export const UNKNOWN_NOTE = 'Not in the web registry';
export const UNREGISTERED_NOTE = 'Not registered on this API build';

const KNOWN_BY_NAME: ReadonlyMap<string, KnownFlag> = new Map(KNOWN_FLAGS.map((f) => [f.name, f]));
const GROUP_ORDER: ReadonlyMap<FlagGroupKey, number> = new Map(FLAG_GROUPS.map((g, i) => [g.key, i]));

export const knownFlag = (name: string): KnownFlag | null => KNOWN_BY_NAME.get(name) ?? null;
export const staysFalseDecision = (name: string): StaysFalseDecision | null => STAYS_FALSE[name] ?? null;
export const flagGroup = (key: FlagGroupKey): FlagGroup => FLAG_GROUPS[GROUP_ORDER.get(key) ?? FLAG_GROUPS.length - 1];

/* ------------------------------------------------------- list shaping */

/**
 * One line of the page: a registry entry, an API row, or both. `row` is
 * null when the web knows the name but this API build did not return it.
 */
export type FlagListEntry = {
  name: string;
  group: FlagGroupKey;
  /** The registry note, or UNKNOWN_NOTE for a name the web does not know. */
  note: string;
  known: KnownFlag | null;
  staysFalse: StaysFalseDecision | null;
  row: AdminFlagRow | null;
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Registry order first (every known flag, with or without an API row), then
 * the names only the API knows, alphabetically, under "Not in the web registry".
 */
export function mergeWithRegistry(rows: readonly AdminFlagRow[]): FlagListEntry[] {
  const byRowName = new Map(rows.map((r) => [r.name, r]));
  const entries: FlagListEntry[] = KNOWN_FLAGS.map((known) => ({
    name: known.name,
    group: known.group,
    note: known.note,
    known,
    staysFalse: staysFalseDecision(known.name),
    row: byRowName.get(known.name) ?? null,
  }));
  const unknown = rows
    .filter((r) => !KNOWN_BY_NAME.has(r.name))
    .sort(byName)
    .map<FlagListEntry>((row) => ({ name: row.name, group: 'unknown', note: UNKNOWN_NOTE, known: null, staysFalse: null, row }));
  return [...entries, ...unknown];
}

/** Stable sort by group order, then by registry order inside a group, then by name. */
export function sortEntries(entries: readonly FlagListEntry[]): FlagListEntry[] {
  const registryIndex = new Map(KNOWN_FLAGS.map((f, i) => [f.name, i]));
  return [...entries].sort((a, b) => {
    const g = (GROUP_ORDER.get(a.group) ?? 99) - (GROUP_ORDER.get(b.group) ?? 99);
    if (g !== 0) return g;
    const ra = registryIndex.get(a.name);
    const rb = registryIndex.get(b.name);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return byName(a, b);
  });
}

export type FlagGroupSection = FlagGroup & { entries: FlagListEntry[] };

/** Groups in display order; a group with no entries is omitted. */
export function groupEntries(entries: readonly FlagListEntry[]): FlagGroupSection[] {
  const sorted = sortEntries(entries);
  return FLAG_GROUPS.map((group) => ({ ...group, entries: sorted.filter((e) => e.group === group.key) })).filter((g) => g.entries.length > 0);
}

/** Case-insensitive match on the name, the group title, the note, the decision id and the API note. */
export function matchesQuery(entry: FlagListEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    entry.name,
    flagGroup(entry.group).title,
    entry.note,
    entry.staysFalse?.decision ?? '',
    entry.row?.note ?? '',
    entry.row?.updatedBy ?? '',
  ]
    .join('\n')
    .toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function searchEntries(entries: readonly FlagListEntry[], query: string): FlagListEntry[] {
  return entries.filter((e) => matchesQuery(e, query));
}

export type FlagSummary = { total: number; on: number; seeded: number; unknown: number; missing: number };

/** Header counts over what the API returned, plus how many names sit outside each registry. */
export function summarizeFlags(rows: readonly AdminFlagRow[]): FlagSummary {
  const returned = new Set(rows.map((r) => r.name));
  return {
    total: rows.length,
    on: rows.filter((r) => r.enabled).length,
    seeded: rows.filter((r) => r.seeded).length,
    unknown: rows.filter((r) => !KNOWN_BY_NAME.has(r.name)).length,
    missing: KNOWN_FLAGS.filter((f) => !returned.has(f.name)).length,
  };
}

/* ----------------------------------------------------------- the PUT body */

export const ALLOWLIST_MAX = 200;
export const NOTE_MAX = 500;
export const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

/** The PUT body: only the fields that changed. */
export type FlagPatch = { enabled?: boolean; percentage?: number; allowlist?: string[]; note?: string };

export type FlagField = 'enabled' | 'percentage' | 'allowlist' | 'note';
export type FlagFieldErrors = Partial<Record<FlagField, string>>;
/** The fields the editor shows; `enabled` belongs to the row's switch. */
export type EditorField = Exclude<FlagField, 'enabled'>;

/** What the editor holds while a row is being edited: text, so a half-typed value never snaps. */
export type FlagDraft = { percentage: string; allowlist: string; note: string };

export function draftFromRow(row: AdminFlagRow): FlagDraft {
  return { percentage: String(row.percentage), allowlist: row.allowlist.join('\n'), note: row.note };
}

export type ParsedAllowlist = {
  /** Lower-cased, de-duplicated, in first-seen order. */
  ids: string[];
  /** Entries that are not 24-hex, as typed. */
  invalid: string[];
  duplicates: number;
};

/** Ids separated by newlines, commas, semicolons or spaces. */
export function parseAllowlist(input: string): ParsedAllowlist {
  const ids: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const raw of input.split(/[\s,;]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    if (!OBJECT_ID_RE.test(entry)) {
      invalid.push(entry);
      continue;
    }
    const id = entry.toLowerCase();
    if (seen.has(id)) {
      duplicates += 1;
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return { ids, invalid, duplicates };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((s) => s.toLowerCase()));
  return b.every((s) => set.has(s.toLowerCase()));
};

export type FlagValues = { enabled: boolean; percentage: number; allowlist: string[]; note: string };

/**
 * The diff builder: compares the wanted values against the row the API sent
 * and returns only what changed, so an audit-log row names exactly what the
 * operator touched and a stale field never overwrites a newer one. The
 * allowlist is compared as a set (order carries no meaning), the note trimmed.
 */
export function buildFlagPatch(row: AdminFlagRow, values: FlagValues): FlagPatch {
  const patch: FlagPatch = {};
  if (values.enabled !== row.enabled) patch.enabled = values.enabled;
  if (values.percentage !== row.percentage) patch.percentage = values.percentage;
  if (!sameSet(values.allowlist, row.allowlist)) patch.allowlist = [...values.allowlist];
  if (values.note.trim() !== row.note.trim()) patch.note = values.note.trim();
  return patch;
}

export const isEmptyPatch = (patch: FlagPatch): boolean => Object.keys(patch).length === 0;

/** True when the body carries a field the editor owns; a switch-only body ({ enabled }) is not the form's. */
export const isFormPatch = (patch: FlagPatch): boolean => Object.keys(patch).some((k) => k !== 'enabled');

/**
 * True when the percentage, allowlist or note of `row` differ from `seed`:
 * the values an open editor seeded from `seed` would overwrite on Save.
 * `enabled` is left out because the editor never sends it.
 */
export function rolloutChanged(seed: AdminFlagRow, row: AdminFlagRow): boolean {
  return seed.percentage !== row.percentage || !sameSet(seed.allowlist, row.allowlist) || seed.note.trim() !== row.note.trim();
}

export type ReadDraft = {
  values: FlagValues | null;
  errors: FlagFieldErrors;
  patch: FlagPatch;
  allowlistCount: number;
  noteLength: number;
};

const list = (items: readonly string[], max = 3): string =>
  items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`;

/**
 * Validate the editor's text against the contract (percentage 0–100, ≤200
 * 24-hex ids, note ≤500) and build the PUT body. `patch` is empty while any
 * field is invalid, so Save stays disabled; `values` is null in that case.
 */
export function readDraft(row: AdminFlagRow, draft: FlagDraft): ReadDraft {
  const errors: FlagFieldErrors = {};

  const pctText = draft.percentage.trim();
  const percentage = /^\d{1,3}$/.test(pctText) ? Number(pctText) : NaN;
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    errors.percentage = 'Enter a whole number from 0 to 100.';
  }

  const parsed = parseAllowlist(draft.allowlist);
  if (parsed.invalid.length > 0) {
    errors.allowlist = `${parsed.invalid.length === 1 ? 'This is not a 24-character hex user id' : 'These are not 24-character hex user ids'}: ${list(parsed.invalid)}.`;
  } else if (parsed.ids.length > ALLOWLIST_MAX) {
    errors.allowlist = `At most ${ALLOWLIST_MAX} ids; there are ${parsed.ids.length}.`;
  }

  const noteLength = draft.note.length;
  if (noteLength > NOTE_MAX) errors.note = `At most ${NOTE_MAX} characters; there are ${noteLength}.`;

  if (Object.keys(errors).length > 0) {
    return { values: null, errors, patch: {}, allowlistCount: parsed.ids.length, noteLength };
  }
  const values: FlagValues = { enabled: row.enabled, percentage, allowlist: parsed.ids, note: draft.note };
  return { values, errors, patch: buildFlagPatch(row, values), allowlistCount: parsed.ids.length, noteLength };
}

/* ------------------------------------------------------------- errors */

export type FlagErrorKind = 'not-found' | 'invalid' | 'unsupported' | 'rate-limited' | 'forbidden' | 'offline' | 'other';

export type FlagSaveError = {
  kind: FlagErrorKind;
  /** The field a FLAG_INVALID or UNSUPPORTED_FIELD named, when it is one of ours. */
  field: FlagField | null;
  /** One sentence for the row. */
  message: string;
  retryAfterSec: number | null;
};

/** The structural slice of a parsed API error the mapper reads (src/lib/apiError.ts ParsedApiError fits). */
export type FlagErrorInput = {
  status: number | null;
  code: string | null;
  message?: string | null;
  field?: string | null;
  retryAfterSec?: number | null;
  kind?: string | null;
};

const FIELD_COPY: Record<FlagField, string> = {
  enabled: 'Enabled must be true or false.',
  percentage: 'Percentage must be a whole number from 0 to 100.',
  allowlist: `Allowlist entries must be 24-character hex user ids, at most ${ALLOWLIST_MAX}.`,
  note: `The note must be ${NOTE_MAX} characters or fewer.`,
};

const asField = (v: unknown): FlagField | null =>
  v === 'enabled' || v === 'percentage' || v === 'allowlist' || v === 'note' ? v : null;

const waitLabel = (sec: number): string => (sec < 120 ? `${sec} s` : `${Math.ceil(sec / 60)} min`);

const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

/**
 * The error mapper for a failed PUT /api/admin/flags/:name. Field errors
 * come back with the field so the editor can place them inline; everything
 * else is one row-level sentence.
 */
export function mapFlagError(input: FlagErrorInput, name: string): FlagSaveError {
  const { status, code } = input;
  const server = text(input.message);
  const field = asField(input.field);
  const retryAfterSec = typeof input.retryAfterSec === 'number' && Number.isFinite(input.retryAfterSec) && input.retryAfterSec > 0 ? Math.ceil(input.retryAfterSec) : null;

  if (status === 429 || code === 'RATE_LIMITED') {
    return {
      kind: 'rate-limited',
      field: null,
      message: retryAfterSec ? `Rate limited. Try again in ${waitLabel(retryAfterSec)}.` : 'Rate limited. Try again in a moment.',
      retryAfterSec,
    };
  }
  if (code === 'FLAG_NOT_FOUND' || (status === 404 && code === null)) {
    return {
      kind: 'not-found',
      field: null,
      message: `${name} is not a registered flag on this API build. Flags are declared in code; there are no ad-hoc flags.`,
      retryAfterSec: null,
    };
  }
  if (code === 'FLAG_INVALID') {
    return {
      kind: 'invalid',
      field,
      message: field ? FIELD_COPY[field] : server ? sentence(server) : 'The API rejected one of the fields.',
      retryAfterSec: null,
    };
  }
  if (code === 'UNSUPPORTED_FIELD') {
    const named = field ?? text(input.field);
    return {
      kind: 'unsupported',
      field,
      message: named
        ? `This API build does not accept the field "${named}". Reload the console and try again.`
        : 'This API build does not accept one of the fields sent. Reload the console and try again.',
      retryAfterSec: null,
    };
  }
  if (status === 401 || status === 403) {
    return { kind: 'forbidden', field: null, message: server ? sentence(server) : 'Staff access is required to change flags.', retryAfterSec: null };
  }
  if (status === null && (input.kind === 'network' || input.kind === 'timeout' || code === 'ERR_NETWORK')) {
    return { kind: 'offline', field: null, message: 'Could not reach the API. Check the connection and try again.', retryAfterSec: null };
  }
  return {
    kind: 'other',
    field: null,
    message: server ? sentence(server) : 'Could not save the flag.',
    retryAfterSec: null,
  };
}

/**
 * True when a failed PUT's error reads inline in an open editor: it names a
 * field the editor shows and the editor is open. Otherwise the sentence is
 * the row's (beside the switch) and the operator also gets a toast. An
 * error on `enabled` is always the row's, because the switch sent it.
 */
export function readsInline(error: FlagSaveError | null, editorOpen: boolean): boolean {
  return !!error && !!error.field && error.field !== 'enabled' && editorOpen;
}

/**
 * The API's message for `field`, while that field still reads as it was
 * submitted; once the operator edits the field the local check takes over.
 * With no submitted draft (the error predates this editor) the message shows.
 */
export function serverFieldError(error: FlagSaveError | null, field: EditorField, submitted: FlagDraft | null, draft: FlagDraft): string | null {
  if (!error || error.field !== field) return null;
  if (submitted && submitted[field] !== draft[field]) return null;
  return error.message;
}

/* --------------------------------------------------------- live effect */

/**
 * What GET /api/capabilities (signed out) reports for a flag: true only when
 * it is enabled at 100 %, because there is no member to bucket or allowlist;
 * null when the answer does not carry the name.
 */
export function publicFeatureState(features: unknown, name: string): boolean | null {
  if (!isRecord(features) || !(name in features)) return null;
  return features[name] === true;
}

/** The `features` map from a capabilities body, or null. */
export function featuresOf(body: unknown): Record<string, unknown> | null {
  return isRecord(body) && isRecord(body.features) ? body.features : null;
}
