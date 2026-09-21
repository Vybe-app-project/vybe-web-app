import { api } from './api';
import { plural } from './format';
import { localDayParams } from './timezone';

/**
 * Insights v2 (docs/api-contract.md, "Insights v2: disclosed score, Training
 * Load and effort, Monday target suggestions, meals in weeks, Focus and
 * welcome-back", G-7) and the weekly series H-8 added to the same payload
 * ("Progress depth: score trend, weekly Training Load").
 *
 * The budget is disclosed part by part with the input each number came from,
 * and every verdict on the wire is a key, not a sentence: `score.band`
 * (`low | ok | high`), `part.state` / `part.reason`, `trainingLoad.label`
 * (five words, never a colour), `trainingLoad.offer`. This module is the one
 * place those keys become English, one rendering per key and nothing more —
 * the web never re-derives a score, a band or a label.
 *
 * The reason copy is the backend's own table, verbatim
 * (`services/rhythmSuggestions.js COPY.reason`, pinned there by
 * tests/v2-be-insights-v2.suggestions.test.js). It is authored server-side
 * but never sent over the wire, so it is mirrored here rather than invented;
 * the only change is the typographic apostrophe docs/DESIGN.md asks for.
 *
 * Every route needs its flag: `insightsV2` for `score`, `trainingLoad` for
 * `trainingLoad`, `focus` for the focus routes, `welcomeBack` for the two
 * welcome-back routes. A flagged route answers 404 FEATURE_DISABLED while it
 * is dark, which `isFeatureDisabled` (src/lib/rhythm.ts) reads as "render
 * nothing".
 *
 * No hooks and no DOM: tests/rhythm-insights.test.mjs loads this straight
 * from source.
 */

/* ------------------------------------------------------------- the score */

export type ScoreBand = 'low' | 'ok' | 'high';
export type ScoreState = 'scored' | 'not_enough_data' | 'off';
export type ScorePartKey = 'sessions' | 'movement' | 'meals';
export type ScoreReason = 'set_target' | 'steps_days' | 'rate_sessions' | 'history' | 'age';

/** Whatever the part measured itself against; read key by key, never spread into copy. */
export type ScoreInputs = {
  daysCounted?: number | null;
  target?: number | null;
  activeMinutes?: number | null;
  minutesTarget?: number | null;
  daysAtGoal?: number | null;
  daysWithSteps?: number | null;
  goal?: number | null;
  goalSource?: 'setting' | 'default' | 'health' | null;
  daysLogged?: number | null;
  needed?: number | null;
  weeksConsistent?: number | null;
};

export type ScorePart = {
  key: ScorePartKey | string;
  outOf: number;
  points: number | null;
  state: ScoreState;
  reason: ScoreReason | string | null;
  missing: number | null;
  inputs: ScoreInputs;
};

/** At most one entry: the part that moved most against the same window one period earlier. */
export type ScoreMoved = { key: ScorePartKey | string; delta: number; detail: { from: number; to: number } };

/** One point per ISO week, oldest first; `score` is null when a part was short that week. */
export type ScoreTrendPoint = { weekKey: string; score: number | null; band: ScoreBand | null; partial: boolean };

export type InsightsScore = {
  window: string;
  days: number;
  outOf: number;
  total: number | null;
  band: ScoreBand | null;
  showTotal: boolean;
  computedAt: string;
  parts: ScorePart[];
  movedBy: ScoreMoved[];
  /** H-8, flag `insightsV2`. */
  trend?: ScoreTrendPoint[];
};

/* ------------------------------------------------------- training load */

export type TrainingLoadLabel = 'well_below' | 'below' | 'steady' | 'above' | 'well_above';
export type TrainingLoadState = 'scored' | 'not_enough_data' | 'off';
export type TrainingLoadWeek = { weekKey: string; load: number | null; sessions: number };

export type TrainingLoad = {
  state: TrainingLoadState;
  label: TrainingLoadLabel | null;
  reason: ScoreReason | string | null;
  missing: number | null;
  acute: { load: number | null; sessions: number | null; rated: number | null; estimated: number | null };
  chronic: { weeklyMean: number | null; weeks: number | null };
  ratio: number | null;
  offer: 'lighter_session' | null;
  since: string | null;
  /** H-8, flag `trainingLoad`: the last 8 calendar weeks, oldest first. `[]` for a minor. */
  weekly?: TrainingLoadWeek[];
};

/** The two additive blocks on GET /api/health/analytics; absent with the flag off. */
export type InsightsAnalytics = { score: InsightsScore | null; trainingLoad: TrainingLoad | null };

/* -------------------------------------------------------------- focus */

export type FocusKind = 'build' | 'event' | 'stay_active' | 'recover';

export type Focus = {
  kind: FocusKind;
  /** The server's own label; printed verbatim. */
  label: string;
  eventDate: string | null;
  setAt: string | null;
  note: string | null;
};

export type FocusBody = { focus: FocusKind; eventDate?: string | null; note?: string | null };

/* --------------------------------------------------------- welcome back */

export type WelcomeBack = {
  id: string;
  previousActiveAt: string;
  returnedAt: string;
  idleDays: number;
  target: { current: number; lowerTo: number | null; weeksKept: number };
  /** Truthy when the API offers the Recover row (no Focus set and the `focus` flag on). */
  focusOffer: unknown;
  breakOffer: { weeks: number };
};

export type WelcomeBackAction = 'seen' | 'keep_target' | 'lower_target' | 'start_session' | 'not_now';

export type WelcomeBackAckBody = {
  id: string;
  action: WelcomeBackAction;
  countAsBreak?: boolean;
  setFocusRecover?: boolean;
};

/* ---------------------------------------------------------- query keys */

export const insightsKeys = {
  all: ['insights'] as const,
  analytics: (windows: number) => ['insights', 'analytics', windows] as const,
  focus: () => ['insights', 'focus'] as const,
  welcomeBack: () => ['insights', 'welcome-back'] as const,
};

/* ------------------------------------------------------------ fetchers */

/** The trend default the server uses; 1..26, and anything unreadable is the default rather than a 400. */
export const TREND_WINDOWS = 8;

/**
 * GET /api/health/analytics — the disclosed score and Training Load ride on
 * the existing payload, each behind its own flag. `timeWindow: 'week'` is the
 * budget the card discloses (Sessions 40 / Movement 30 / Meals 30 over seven
 * days); `windows` bounds both weekly series.
 */
export async function fetchInsights(windows = TREND_WINDOWS): Promise<InsightsAnalytics> {
  const { data } = await api.get<{ analytics?: { score?: InsightsScore; trainingLoad?: TrainingLoad } }>('/health/analytics', {
    params: { timeWindow: 'week', windows, ...localDayParams() },
  });
  const analytics = data?.analytics;
  return { score: analytics?.score ?? null, trainingLoad: analytics?.trainingLoad ?? null };
}

/** GET /api/me/focus — the owner's focus, note included; null when none is set. */
export async function fetchFocus(): Promise<Focus | null> {
  const { data } = await api.get<{ focus: Focus | null }>('/me/focus');
  return data?.focus ?? null;
}

/** PUT /api/me/focus — an end-state write; `eventDate` only with `event`. */
export async function saveFocus(body: FocusBody): Promise<Focus | null> {
  const { data } = await api.put<{ focus: Focus | null }>('/me/focus', body);
  return data?.focus ?? null;
}

/** GET /api/me/welcome-back — the pending return record, or null. */
export async function fetchWelcomeBack(): Promise<WelcomeBack | null> {
  const { data } = await api.get<{ welcomeBack: WelcomeBack | null }>('/me/welcome-back');
  return data?.welcomeBack ?? null;
}

/** POST /api/me/welcome-back/ack — answers the record once; an acked id replays its own answer. */
export async function ackWelcomeBack(body: WelcomeBackAckBody): Promise<void> {
  await api.post('/me/welcome-back/ack', body);
}

/* ----------------------------------------------------------------- copy */

export const SCORE_PART_LABELS: Readonly<Record<string, string>> = Object.freeze({
  sessions: 'Sessions',
  movement: 'Movement',
  meals: 'Meals',
});

/**
 * The backend's reason table, verbatim (`services/rhythmSuggestions.js
 * COPY.reason`): what the member can do so a withheld part scores. `age` is
 * deliberately empty — a minor is told nothing about a part that is off for
 * them.
 */
export const REASON_COPY = Object.freeze({
  set_target: 'Pick how many days a week you’ll train and this part scores.',
  steps_days: (n: number) => `Log steps on ${plural(n, 'more day', 'more days')}, or connect the Health app.`,
  rate_sessions: (n: number) => `Rate ${plural(n, 'more session', 'more sessions')} to see this week against your usual.`,
  history: (n: number) => `${plural(n, 'more day', 'more days')} of history and this appears.`,
  age: '',
});

/** The server's sentence for a withheld part or a withheld load; empty string when it has none. */
export function reasonCopy(reason: string | null | undefined, missing: number | null | undefined): string {
  const n = Number.isFinite(Number(missing)) ? Math.max(1, Number(missing)) : 1;
  switch (reason) {
    case 'set_target':
      return REASON_COPY.set_target;
    case 'steps_days':
      return REASON_COPY.steps_days(n);
    case 'rate_sessions':
      return REASON_COPY.rate_sessions(n);
    case 'history':
      return REASON_COPY.history(n);
    default:
      return '';
  }
}

export type ScoreRow = {
  key: string;
  label: string;
  /** "36 / 40" while the part scored; the reason sentence otherwise, or null when the API withholds both. */
  value: string | null;
  /** The inputs the number came from, spelled out. */
  inputs: string | null;
};

const whole = (n: number) => Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

const of = (a: number, b: number, noun: string) => `${whole(a)} of ${plural(b, noun)}`;

const GOAL_SOURCE: Readonly<Record<string, string>> = Object.freeze({
  setting: 'your goal',
  default: 'the default goal',
  health: 'the Health app’s goal',
});

/**
 * The inputs of one part, in its own terms. Every clause is a pair the API
 * sent; a pair with a missing half is left out rather than printed as a zero.
 */
export function partInputs(part: Pick<ScorePart, 'key' | 'inputs'>): string | null {
  const i = part.inputs || {};
  const bits: string[] = [];
  if (part.key === 'sessions') {
    if (Number.isFinite(Number(i.daysCounted)) && Number(i.target) > 0) bits.push(of(Number(i.daysCounted), Number(i.target), 'day'));
    if (Number.isFinite(Number(i.activeMinutes)) && Number(i.minutesTarget) > 0) bits.push(`${whole(Number(i.activeMinutes))} of ${whole(Number(i.minutesTarget))} min`);
  } else if (part.key === 'movement') {
    if (Number.isFinite(Number(i.daysAtGoal)) && Number(i.daysWithSteps) > 0) bits.push(`${of(Number(i.daysAtGoal), Number(i.daysWithSteps), 'day')} at goal`);
    if (Number(i.goal) > 0) {
      const source = GOAL_SOURCE[String(i.goalSource ?? '')];
      bits.push(`${whole(Number(i.goal))} steps${source ? ` (${source})` : ''}`);
    }
  } else if (part.key === 'meals') {
    if (Number.isFinite(Number(i.daysLogged)) && Number(i.needed) > 0) bits.push(`${of(Number(i.daysLogged), Number(i.needed), 'day')} logged`);
    if (Number(i.weeksConsistent) > 0) bits.push(`${plural(Number(i.weeksConsistent), 'consistent week')}`);
  }
  return bits.length ? bits.join(' · ') : null;
}

/**
 * The hairline list under the headline: one row per part the API sent, its
 * points against its own budget, and the inputs it read. A part that is
 * `off` for this member carries no row at all — the budget already dropped
 * by its share.
 */
export function scoreRows(score: Pick<InsightsScore, 'parts'> | null | undefined): ScoreRow[] {
  const parts = Array.isArray(score?.parts) ? score.parts : [];
  const rows: ScoreRow[] = [];
  for (const part of parts) {
    if (part.state === 'off') continue;
    const label = SCORE_PART_LABELS[String(part.key)] ?? String(part.key);
    const scored = part.state === 'scored' && Number.isFinite(Number(part.points));
    const reason = scored ? '' : reasonCopy(part.reason, part.missing);
    rows.push({
      key: String(part.key),
      label,
      value: scored ? `${whole(Number(part.points))} / ${whole(Number(part.outOf))}` : reason || null,
      inputs: partInputs(part),
    });
  }
  return rows;
}

/**
 * The one plain line under the number, and only from `movedBy` — the single
 * comparison the API makes, against the member's own earlier window and
 * never against another member. Absent on a first window and when nothing
 * moved, so the card says nothing rather than restating the list above it.
 */
export function movedLine(score: Pick<InsightsScore, 'movedBy'> | null | undefined): string | null {
  const moved = Array.isArray(score?.movedBy) ? score.movedBy[0] : null;
  if (!moved) return null;
  const from = Number(moved.detail?.from);
  const to = Number(moved.detail?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const label = SCORE_PART_LABELS[String(moved.key)] ?? String(moved.key);
  return `${label} moved from ${whole(from)} to ${whole(to)} points against the same week a period earlier.`;
}

/** "62 / 100" when the API sent a total; null when a part was short or the member switched the total off. */
export function scoreHeadline(score: Pick<InsightsScore, 'total' | 'outOf' | 'showTotal'> | null | undefined): { value: string; outOf: string } | null {
  if (!score || score.showTotal !== true) return null;
  const total = Number(score.total);
  const outOf = Number(score.outOf);
  if (!Number.isFinite(total) || !Number.isFinite(outOf) || outOf <= 0) return null;
  return { value: whole(total), outOf: `/ ${whole(outOf)}` };
}

/** Why the total is withheld: the first part the API is still short of. */
export function withheldLine(score: Pick<InsightsScore, 'parts' | 'showTotal'> | null | undefined): string | null {
  if (!score) return null;
  if (score.showTotal !== true) return 'The total is off in your insights preferences. The parts below still score.';
  const parts = Array.isArray(score.parts) ? score.parts : [];
  for (const part of parts) {
    if (part.state !== 'not_enough_data') continue;
    const reason = reasonCopy(part.reason, part.missing);
    if (reason) return reason;
  }
  return null;
}

/**
 * Apple's five words for the load ratio, one rendering per server key. Never
 * a colour and never a judgement: the label says where this week sits
 * against the member's own previous weeks, which is all the ratio measures.
 */
export const LOAD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  well_below: 'Well below',
  below: 'Below',
  steady: 'Steady',
  above: 'Above',
  well_above: 'Well above',
});

/**
 * The load's one line. Scored: the server's label plus the window it
 * compared (the chronic mean's own week count). Withheld: the server's
 * reason sentence. Off for a minor: nothing at all.
 */
export function loadLine(load: TrainingLoad | null | undefined): string | null {
  if (!load || load.state === 'off') return null;
  if (load.state === 'not_enough_data') return reasonCopy(load.reason, load.missing) || null;
  const label = LOAD_LABELS[String(load.label ?? '')];
  if (!label) return null;
  const weeks = Number(load.chronic?.weeks);
  if (!Number.isFinite(weeks) || weeks < 1) return `${label} your usual.`;
  return `${label} your usual — this week against your previous ${plural(weeks, 'week')}.`;
}

/** "3 sessions, 1 effort estimated": what the acute week is made of, for the disclosure. */
export function loadInputs(load: TrainingLoad | null | undefined): string | null {
  if (!load || load.state !== 'scored') return null;
  const bits: string[] = [];
  const sessions = Number(load.acute?.sessions);
  if (sessions > 0) bits.push(plural(sessions, 'session'));
  const estimated = Number(load.acute?.estimated);
  if (estimated > 0) bits.push(`${whole(estimated)} effort estimated`);
  const mean = Number(load.chronic?.weeklyMean);
  if (mean > 0) bits.push(`usual ${whole(mean)} a week`);
  return bits.length ? bits.join(' · ') : null;
}

/** The lighter-session offer, and only when the API made it (Focus = Recover on a high load). */
export const LOAD_OFFER_COPY: Readonly<Record<string, string>> = Object.freeze({
  lighter_session: 'A lighter session would suit this week.',
});

export function loadOfferLine(load: TrainingLoad | null | undefined): string | null {
  const offer = String(load?.offer ?? '');
  return LOAD_OFFER_COPY[offer] ?? null;
}

/** The bars the weekly strip draws; a `null` load is a week the API could not total, not a zero. */
export type LoadBar = { weekKey: string; load: number | null; sessions: number; ratio: number };

/**
 * The strip's geometry: every week the API sent, scaled against the tallest
 * week in the set. The API gives no scale, so there is no y-axis — the bars
 * are relative to each other and each one says its own number aloud.
 */
export function loadBars(load: Pick<TrainingLoad, 'weekly'> | null | undefined): LoadBar[] {
  const weeks = Array.isArray(load?.weekly) ? load.weekly : [];
  const max = weeks.reduce((top, week) => Math.max(top, Number(week.load) > 0 ? Number(week.load) : 0), 0);
  return weeks.map((week) => {
    const value = Number.isFinite(Number(week.load)) ? Number(week.load) : null;
    return {
      weekKey: String(week.weekKey ?? ''),
      load: value,
      sessions: Math.max(0, Number(week.sessions) || 0),
      ratio: max > 0 && value !== null && value > 0 ? value / max : 0,
    };
  });
}

/** "Week 38" from '2026-W38'; the key itself when it is not a week key. */
export function weekKeyLabel(weekKey: string): string {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(weekKey || '');
  return match ? `Week ${Number(match[2])}` : weekKey;
}

/** One bar's spoken name: the week, its load and how many sessions made it. */
export function loadBarLabel(bar: LoadBar): string {
  const when = weekKeyLabel(bar.weekKey);
  if (bar.load === null) return `${when}: ${plural(bar.sessions, 'session')}, no load yet`;
  if (bar.load <= 0) return `${when}: no sessions`;
  return `${when}: ${whole(bar.load)} load from ${plural(bar.sessions, 'session')}`;
}

/** The four focus values the route accepts, with the server's own labels (services/focusRules.js FOCUS_LABELS). */
export const FOCUS_LABELS: Readonly<Record<FocusKind, string>> = Object.freeze({
  build: 'Build',
  event: 'Event',
  stay_active: 'Stay active',
  recover: 'Recover',
});

export const FOCUS_KINDS: readonly FocusKind[] = ['build', 'event', 'stay_active', 'recover'];

export const FOCUS_OPTIONS: ReadonlyArray<{ kind: FocusKind; label: string }> = FOCUS_KINDS.map((kind) => ({ kind, label: FOCUS_LABELS[kind] }));

/** The focus row's value: the server's label, with the event day when it carries one. */
export function focusValue(focus: Focus | null | undefined): string | null {
  if (!focus) return null;
  const label = focus.label || FOCUS_LABELS[focus.kind] || null;
  if (!label) return null;
  return label;
}

/**
 * The welcome-back line. The API sends no sentence, only the gap and the
 * offers, so the greeting is composed from `idleDays` and — above zero only
 * — the chain that is still standing. Nothing about what the gap cost.
 */
export function welcomeBackLine(record: WelcomeBack | null | undefined): string | null {
  if (!record) return null;
  const idle = Number(record.idleDays);
  if (!Number.isFinite(idle) || idle < 1) return 'Welcome back.';
  const kept = Number(record.target?.weeksKept);
  const chain = Number.isFinite(kept) && kept >= 1 ? ` Your ${plural(kept, 'week')} kept are still here.` : '';
  return `Welcome back — ${plural(idle, 'day')} since your last session.${chain}`;
}

export type WelcomeBackOffer = { action: WelcomeBackAction; label: string; countAsBreak?: boolean };

/**
 * The one repair the API offers on this record, in its own terms: count the
 * gap as a break (`breakOffer.weeks`), else lower the target to the number it
 * named (`target.lowerTo`). Null when it offers neither — then the card is a
 * greeting with a dismiss and nothing more.
 */
export function welcomeBackOffer(record: WelcomeBack | null | undefined): WelcomeBackOffer | null {
  if (!record) return null;
  const weeks = Number(record.breakOffer?.weeks);
  if (Number.isFinite(weeks) && weeks >= 1) {
    return { action: 'keep_target', label: `Count ${plural(weeks, 'week')} as a break`, countAsBreak: true };
  }
  const lowerTo = Number(record.target?.lowerTo);
  if (Number.isFinite(lowerTo) && lowerTo >= 1) {
    return { action: 'lower_target', label: `Lower to ${plural(lowerTo, 'day')} a week` };
  }
  return null;
}

export const INSIGHTS_STRINGS = {
  scoreTitle: 'This week',
  scoreLabel: 'Consistency',
  disclosure: 'About this score',
  loadTitle: 'Training load',
  loadWeeks: 'Load by week',
  focusRow: 'This week’s focus',
  focusEdit: 'Change focus',
  focusSheet: 'This week’s focus',
  focusNone: 'Choose one',
  focusSave: 'Save focus',
  focusEventDate: 'Event date',
} as const;
