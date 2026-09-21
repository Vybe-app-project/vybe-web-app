import { api } from './api';
import { apiErrorDetails } from './apiError';
import { plural } from './format';
import { localDayParams } from './timezone';
import { browserTimeZone } from './timezoneSync';

/**
 * Weekly Rhythm (docs/api-contract.md, "Weekly Rhythm (/api/rhythm,
 * v2-be-rhythm)") and the Monday target suggestion that rides on it behind
 * `rhythmSuggestions` (the same doc, "Insights v2", G-7).
 *
 * The only chain in Vybe is **weeks kept** against a target the member chose:
 * a week is Monday 00:00 to Sunday 24:00 in their own zone, and a day counts
 * once when a completed log or an activity of ten minutes or more exists on
 * it. Every verdict is the server's: `currentWeek.status`, `kept`,
 * `repaired`, `tokenUsed`, `suggestion.kind`, `basis[].status`. Nothing here
 * re-judges a week — the copy below only restates the numbers and the status
 * the fold already decided, in the register docs/DESIGN.md sets (never a
 * zero, never a guilt line, none of the words the backend's own Rhythm copy
 * test refuses: services/rhythmCopy.js BANNED_WORDS).
 *
 * The API sends no sentences on this route (there is no copy field on
 * `GET /api/rhythm`), so the one line the card shows is composed here from
 * `daysDone`, `target`, `remaining` and `status`. The wording of a closed
 * week follows the week-close notice the server writes for itself
 * ("Week kept: 3 of 3 days.", "Week kept with a rest token.").
 *
 * No hooks and no DOM: tests/rhythm-insights.test.mjs loads this straight
 * from source.
 */

/* ------------------------------------------------------------------ types */

/** The server's vocabulary for a week. `in_progress` is the running week. */
export type RhythmStatus = 'kept' | 'kept_with_token' | 'open' | 'paused' | 'in_progress';

export type RhythmActivitySource = 'log' | 'activity' | 'health';

export type RhythmActivity = {
  id: string;
  source: RhythmActivitySource;
  name?: string | null;
  durationMin?: number | null;
  at: string;
};

export type RhythmDay = { date: string; counted: boolean; activities: RhythmActivity[] };

export type RhythmCurrentWeek = {
  weekKey: string;
  startDate: string;
  endDate: string;
  target: number;
  daysDone: number;
  kept: boolean;
  remaining: number;
  status: RhythmStatus;
  repaired: boolean;
  tokenUsed: boolean;
  days: RhythmDay[];
};

export type RhythmHistoryWeek = {
  weekKey: string;
  startDate: string;
  endDate: string;
  target: number;
  daysDone: number;
  kept: boolean;
  repaired: boolean;
  tokenUsed: boolean;
  status: RhythmStatus;
};

/** `earned | used | returned | discarded`; a `returned` row has no paired `used` row (the fold re-derives). */
export type RhythmTokenEntry = { kind: 'earned' | 'used' | 'returned' | 'discarded'; weekKey: string; at: string };

export type RhythmRestTokens = { bank: number; max: number; ledger?: RhythmTokenEntry[] };

export type RhythmPause = { since: string; until: string | null };

export type RhythmMilestone = { weeks: number; in: number };

/** `idleDays` is null when nothing ever counted, 0 when today counted. */
export type RhythmComeback = { idleDays: number | null; celebrateOnce: boolean };

export type RhythmCelebration = {
  id: string;
  kind: 'comeback' | 'milestone';
  weekKey: string;
  dateKey?: string | null;
  milestone: number | null;
  idleDays?: number | null;
  occurredAt: string;
};

export type RhythmSuggestionBasis = { key: string; status: RhythmStatus; daysCounted: number; target: number };

/** Present only inside the `rhythmSuggestions` rollout, and null when nothing is pending. */
export type RhythmSuggestion = {
  id: string;
  kind: 'raise' | 'lower';
  from: number;
  to: number;
  basis: RhythmSuggestionBasis[];
  createdAt: string;
  expiresAt: string;
};

export type RhythmView = {
  target: number;
  weekStartsOn: string;
  timezone: string | null;
  timezoneOffsetMinutes: number;
  visibility: 'private' | 'followers';
  pause: RhythmPause | null;
  currentWeek: RhythmCurrentWeek;
  weeksKept: number;
  longestWeeksKept: number;
  restTokens: RhythmRestTokens;
  history: RhythmHistoryWeek[];
  hasMoreHistory: boolean;
  nextMilestone: RhythmMilestone | null;
  comeback: RhythmComeback | null;
  celebrations: RhythmCelebration[];
  computedAt: string;
  /** Only inside the `rhythmSuggestions` rollout; the key is absent with the flag off. */
  suggestion?: RhythmSuggestion | null;
};

export type SuggestionAction = 'accept' | 'dismiss' | 'not_now';

/* ------------------------------------------------------- feature detection */

/**
 * A flagged route answers `404 { code: 'FEATURE_DISABLED' }` while its flag
 * is off for the caller. That is an answer, not a fault: the surface renders
 * nothing — no skeleton, no error state. The same reader the progression hub
 * uses (src/lib/progress.ts), restated here so a rhythm module needs no
 * import from the records model.
 */
export function isFeatureDisabled(e: unknown): boolean {
  const details = apiErrorDetails(e);
  return details.status === 404 && details.code === 'FEATURE_DISABLED';
}

/* ------------------------------------------------------------ query keys */

export const rhythmKeys = {
  all: ['rhythm'] as const,
  view: (weeks: number) => ['rhythm', 'view', weeks] as const,
};

/* -------------------------------------------------------------- fetchers */

/** Both zone hints, the way every day-keyed read in this client sends them. */
const zoneParams = () => {
  const timezone = browserTimeZone();
  return { ...(timezone ? { timezone } : {}), ...localDayParams() };
};

/** GET /api/rhythm — the week's days, the honest weekly chain, and the suggestion inside the rollout. */
export async function fetchRhythm(weeks = 12): Promise<RhythmView> {
  const { data } = await api.get<{ rhythm: RhythmView }>('/rhythm', { params: { weeks, ...zoneParams() } });
  return data.rhythm;
}

/** POST /api/rhythm/suggestion/:id — accept, dismiss or defer the Monday card. Answers the whole rhythm view. */
export async function actOnSuggestion(id: string, action: SuggestionAction): Promise<RhythmView> {
  const { data } = await api.post<{ rhythm: RhythmView }>(`/rhythm/suggestion/${id}`, { action });
  return data.rhythm;
}

/* ------------------------------------------------------------------- copy */

/**
 * The seven day letters of a Monday-first week. Two Tuesdays and two
 * Saturdays share a letter, so a letter is never an accessible name: the
 * strip reads its dates from the API's `days` and speaks them in full.
 */
export const DAY_LETTERS: readonly string[] = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const WEEKDAY_NAMES: readonly string[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 26" from '2026-09-26'; the key itself when it is not a date. */
export function shortDate(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  return match ? `${MONTHS_SHORT[Number(match[2]) - 1]} ${Number(match[3])}` : dateKey;
}

export type RhythmDayCell = {
  /** Monday-first position, 0..6. */
  index: number;
  letter: string;
  date: string;
  counted: boolean;
  /** The spoken name of the cell: weekday, date, and whether it counted. */
  description: string;
};

/**
 * The seven cells of the strip. The API always sends the seven days of the
 * current week Monday first, so the position is the array index; a short or
 * missing array still draws seven cells (the card keeps its geometry) with
 * nothing counted, because a day the server did not describe is not a
 * trained day.
 */
export function weekCells(week: Pick<RhythmCurrentWeek, 'days'> | null | undefined): RhythmDayCell[] {
  const days = Array.isArray(week?.days) ? week.days : [];
  return DAY_LETTERS.map((letter, index) => {
    const day = days[index];
    const date = typeof day?.date === 'string' ? day.date : '';
    const counted = day?.counted === true;
    const when = date ? `${WEEKDAY_NAMES[index]}, ${shortDate(date)}` : WEEKDAY_NAMES[index];
    return { index, letter, date, counted, description: `${when}: ${counted ? 'trained' : 'rest'}` };
  });
}

const days = (n: number) => plural(n, 'day');

/**
 * The card's one `.t-body` line. Every clause is a restatement of what the
 * fold already decided — the status, the count, the target, the days left —
 * and nothing else. A closed week reuses the wording of the notice the
 * server writes for itself ("Week kept: 3 of 3 days."), so the inbox row and
 * the card never disagree. Nothing here says what was not done.
 */
export function weekLine(week: RhythmCurrentWeek | null | undefined, pause?: RhythmPause | null): string {
  if (!week) return '';
  const done = Math.max(0, Number(week.daysDone) || 0);
  const target = Math.max(1, Number(week.target) || 1);
  const counted = `${Math.min(done, target)} of ${days(target)}`;
  switch (week.status) {
    case 'kept':
      return `Week kept: ${counted}.`;
    case 'kept_with_token':
      return 'Week kept with a rest week from the bank.';
    case 'paused':
      return pause?.until ? `On a break until ${shortDate(pause.until)}.` : 'On a break.';
    case 'open':
      return `${counted} that week.`;
    case 'in_progress':
    default: {
      const remaining = Math.max(0, Number(week.remaining) || 0);
      const head = `${done} of ${days(target)} this week`;
      if (remaining <= 0) return `${head}.`;
      return remaining === 1 ? `${head} — one more keeps it.` : `${head} — ${remaining} more keep it.`;
    }
  }
}

/**
 * "12 weeks kept", and only from two: one kept week is the week itself, which
 * the line above already says, and a chain of zero is a hole rather than a
 * fact (docs/DESIGN.md, the zero rule).
 */
export const WEEKS_KEPT_FLOOR = 2;

export function weeksKeptLabel(weeksKept: number | null | undefined): string | null {
  const n = Number(weeksKept);
  if (!Number.isFinite(n) || n < WEEKS_KEPT_FLOOR) return null;
  return `${n} weeks kept`;
}

/**
 * The repair path, in the API's own terms: a banked rest week covers a week
 * that comes up short, and only the fold ever writes one (no route, purchase
 * or admin action can add one). Absent while the bank is empty — there is
 * nothing to offer and a zero is not a fact.
 */
export function restBankLine(tokens: RhythmRestTokens | null | undefined): string | null {
  const bank = Number(tokens?.bank);
  if (!Number.isFinite(bank) || bank < 1) return null;
  return `${plural(bank, 'rest week')} banked. A banked week covers one that comes up short.`;
}

/** "3 weeks to 12" from `nextMilestone`; absent when the API sent none. */
export function milestoneLine(milestone: RhythmMilestone | null | undefined): string | null {
  const weeks = Number(milestone?.weeks);
  const away = Number(milestone?.in);
  if (!Number.isFinite(weeks) || !Number.isFinite(away) || away < 1) return null;
  return `${plural(away, 'week')} to ${weeks}`;
}

/**
 * The Monday suggestion, read off the card the server built. Both kinds
 * restate `basis` — the weeks the rule looked at — and then make the offer;
 * neither names what was not done. `basis` is the disclosure the research
 * asks for ("show the sets the sentence was computed from").
 */
export function suggestionLine(suggestion: RhythmSuggestion | null | undefined): string | null {
  if (!suggestion) return null;
  const basis = Array.isArray(suggestion.basis) ? suggestion.basis : [];
  const from = Number(suggestion.from);
  const to = Number(suggestion.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (suggestion.kind === 'raise') {
    const kept = basis.filter((week) => week.status === 'kept').length;
    const head = kept > 0 ? `${plural(kept, 'week')} kept at ${days(from)}` : `${days(from)} a week`;
    return `${head}. Move to ${to}?`;
  }
  const open = basis.filter((week) => week.status === 'open').length;
  const head = open > 0 && basis.length > 0 ? `${open} of the last ${plural(basis.length, 'week')} came in under ${days(from)}` : `${days(from)} a week`;
  return `${head}. Move to ${to}?`;
}

/** The label on the suggestion's one blue text action. */
export function suggestionAcceptLabel(suggestion: RhythmSuggestion | null | undefined): string | null {
  const to = Number(suggestion?.to);
  return Number.isFinite(to) ? `Move to ${days(to)}` : null;
}

/** One basis row, spelled out for the "how this was judged" disclosure. */
export function basisRowLabel(week: RhythmSuggestionBasis): string {
  const counted = Math.max(0, Number(week.daysCounted) || 0);
  const target = Math.max(1, Number(week.target) || 1);
  return `${counted} of ${days(target)}`;
}

export const RHYTHM_STRINGS = {
  cardTitle: 'Your week',
  weekLabel: 'Days trained this week',
  suggestionPrefix: 'Monday suggestion',
  suggestionBasis: 'How this was judged',
  notNow: 'Not now',
  dismiss: 'Dismiss',
  welcomeBackDismiss: 'Got it',
  recapRow: 'Your week in review is ready',
  target: (n: number) => `${days(n)} a week`,
} as const;

/**
 * The words the backend's Rhythm copy test refuses
 * (services/rhythmCopy.js BANNED_WORDS), restated so the web's own copy test
 * holds the same line on this side of the wire.
 */
export const RHYTHM_BANNED_WORDS: readonly string[] = ['streak', 'missed', 'lost', 'broke', 'behind', 'fail', 'reminder'];
