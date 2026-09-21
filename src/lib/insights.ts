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
 * place those keys become English, one rendering per key and nothing more --
 * the web never re-derives a score, a band or a label. The one number is the
 * Vybe score: consistency over what the member logged, and never a reading of
 * their health or a level they have reached.
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

/**
 * The strings are the design's own table
 * (~/scratch/2026-09-18-vybe-v2/waveG-prep/design-insights-recap-v2.md §5:
 * `score.*`, `part.*`, `load.*`), rendered verbatim so web and app say the
 * same words. The one number is the **Vybe score**: a bounded consistency
 * summary of what the member logged, and nothing about their health or the
 * level they have reached. The band is a word in the ink colour — never red, never
 * green — and `movedBy` is neutral hint text, the way the Progress tiles
 * print their comparison.
 */
export const VYBE_SCORE = {
  name: 'Vybe score',
  /** What it measures, in one noun. */
  measure: 'Consistency',
  eyebrow: (window: string) => `This ${window}`,
  total: (total: string, outOf: string) => `${total} of ${outOf}`,
  /** The owner's override for the zero rule: a word in the number's place, never a 0. */
  calibrating: 'Calibrating',
  totalWithheld: 'Total shows once every part has data.',
  showTotalOff: 'The total is off in your insights preferences. The parts below still score.',
  disclosure: (window: string) => `Based only on what you logged this ${window}. An estimate, not medical advice.`,
  about: 'About this score',
  parts: 'The three parts',
  open: 'Open Progress',
} as const;

/** `score.band.low / .ok / .high`. Text, never a colour. */
export const SCORE_BANDS: Readonly<Record<string, string>> = Object.freeze({ low: 'Low', ok: 'OK', high: 'High' });

export function bandWord(band: string | null | undefined): string | null {
  return SCORE_BANDS[String(band ?? '')] ?? null;
}

export const SCORE_PART_LABELS: Readonly<Record<string, string>> = Object.freeze({
  sessions: 'Sessions',
  movement: 'Movement',
  meals: 'Meals',
});

/** `part.noData` / `part.off`: an en dash and the word, never a zero. */
export const PART_NO_DATA = '—';
export const PART_OFF = 'Off';

/**
 * The exact gap a withheld part still has, from the API's `reason` and
 * `missing`. The sentences are the backend's own table
 * (`services/rhythmSuggestions.js COPY.reason`, which the design table
 * repeats as `part.*.need*` / `load.need*`); they are authored server-side
 * and never sent over the wire, so they are mirrored here rather than
 * invented. `age` is deliberately empty: a minor is told nothing about a
 * part that is off for them.
 */
export const REASON_COPY = Object.freeze({
  set_target: 'Pick how many days a week you’ll train and this part scores.',
  steps_days: (n: number) => `Log steps on ${plural(n, 'more day', 'more days')}, or connect the Health app.`,
  rate_sessions: (n: number) => `Rate ${plural(n, 'more session', 'more sessions')} to see this week against your usual.`,
  history: (n: number) => `${plural(n, 'more day', 'more days')} of history and this appears.`,
  age: '',
});

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

const whole = (n: number) => Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** A number the API actually sent: an absent key is read before it is coerced. */
const numberOf = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const GOAL_SOURCE: Readonly<Record<string, string>> = Object.freeze({
  setting: 'your setting',
  default: 'Vybe default',
  health: 'your Health app goal',
});

export type ScoreRow = {
  key: string;
  label: string;
  /** "36 of 40" when the part scored, "Off" when it is off for this member, an en dash otherwise. */
  value: string;
  /** The inputs the number came from; null when the API sent none. */
  inputs: string | null;
  /** The exact gap, on a withheld part only. */
  gap: string | null;
  state: ScoreState;
};

/** `part.<key>.inputs`: the pairs the part measured, each one straight from `inputs`. */
export function partInputs(part: Pick<ScorePart, 'key' | 'inputs'>): string | null {
  const i = part.inputs || {};
  const bits: string[] = [];
  if (part.key === 'sessions') {
    if (Number.isFinite(Number(i.daysCounted)) && Number(i.target) > 0) bits.push(`${plural(Number(i.daysCounted), 'day')} of ${whole(Number(i.target))}`);
    if (Number.isFinite(Number(i.activeMinutes)) && Number(i.minutesTarget) > 0) bits.push(`${whole(Number(i.activeMinutes))} of ${whole(Number(i.minutesTarget))} min`);
  } else if (part.key === 'movement') {
    if (Number.isFinite(Number(i.daysAtGoal)) && Number(i.goal) > 0) bits.push(`${plural(Number(i.daysAtGoal), 'day')} at ${whole(Number(i.goal))} steps or more`);
    if (Number(i.goal) > 0) {
      const source = GOAL_SOURCE[String(i.goalSource ?? '')];
      if (source) bits.push(`goal ${whole(Number(i.goal))} steps a day (${source})`);
    }
  } else if (part.key === 'meals') {
    if (Number.isFinite(Number(i.daysLogged)) && Number(i.needed) > 0) bits.push(`${plural(Number(i.daysLogged), 'day')} logged · ${whole(Number(i.needed))} a week counts in full`);
    if (Number(i.weeksConsistent) > 0) bits.push(`${plural(Number(i.weeksConsistent), 'week')} in a row`);
  }
  return bits.length ? bits.join(' · ') : null;
}

export const MEALS_OFF_COPY = 'No meals logged in 28 days. Log one and this part scores.';

/**
 * One row per part the API sent, its points against its own budget, the
 * inputs it read and — on a withheld part — the exact gap. An `off` part
 * keeps its row and says so: the budget above it has already re-based by its
 * share, and a member should see why.
 */
export function scoreRows(score: Pick<InsightsScore, 'parts'> | null | undefined): ScoreRow[] {
  const parts = Array.isArray(score?.parts) ? score.parts : [];
  return parts.map((part) => {
    const key = String(part.key);
    const scored = part.state === 'scored' && Number.isFinite(Number(part.points));
    const off = part.state === 'off';
    return {
      key,
      label: SCORE_PART_LABELS[key] ?? key,
      value: scored ? `${whole(Number(part.points))} of ${whole(Number(part.outOf))}` : off ? PART_OFF : PART_NO_DATA,
      inputs: off ? (key === 'meals' ? MEALS_OFF_COPY : null) : partInputs(part),
      gap: scored || off ? null : reasonCopy(part.reason, part.missing) || null,
      state: part.state,
    };
  });
}

/** True while any part the API scored is still short: the headline calibrates instead of showing a number. */
export function isCalibrating(score: Pick<InsightsScore, 'parts' | 'total'> | null | undefined): boolean {
  if (!score) return false;
  const parts = Array.isArray(score.parts) ? score.parts : [];
  return parts.some((part) => part.state === 'not_enough_data');
}

/** The one gap sentence the calibrating headline shows: the first part the API is still short of. */
export function calibratingGap(score: Pick<InsightsScore, 'parts'> | null | undefined): string | null {
  for (const part of Array.isArray(score?.parts) ? score.parts : []) {
    if (part.state !== 'not_enough_data') continue;
    const gap = reasonCopy(part.reason, part.missing);
    if (gap) return gap;
  }
  return null;
}

export type ScoreHeadline = {
  /** The number, or the word in its place while the score calibrates. */
  value: string;
  /** "of 100", absent while calibrating. */
  outOf: string | null;
  /** Low / OK / High; absent while calibrating or with the total switched off. */
  band: string | null;
  /** The exact gap, or why the total is withheld. */
  note: string | null;
  calibrating: boolean;
};

/**
 * The headline, by the design's total rules: a number and its band when the
 * API sent a total; the calibrating word and the exact gap while a part is
 * short; the parts alone when the member switched the total off (D-105).
 */
export function scoreHeadline(score: InsightsScore | null | undefined): ScoreHeadline | null {
  if (!score) return null;
  if (isCalibrating(score)) {
    return { value: VYBE_SCORE.calibrating, outOf: null, band: null, note: calibratingGap(score) ?? VYBE_SCORE.totalWithheld, calibrating: true };
  }
  if (score.showTotal !== true) return { value: VYBE_SCORE.calibrating, outOf: null, band: null, note: VYBE_SCORE.showTotalOff, calibrating: true };
  const total = Number(score.total);
  const outOf = Number(score.outOf);
  if (!Number.isFinite(total) || !Number.isFinite(outOf) || outOf <= 0) {
    return { value: VYBE_SCORE.calibrating, outOf: null, band: null, note: VYBE_SCORE.totalWithheld, calibrating: true };
  }
  return { value: whole(total), outOf: `of ${whole(outOf)}`, band: bandWord(score.band), note: null, calibrating: false };
}

/**
 * The one comparison the API makes — `movedBy`, against the member's own
 * earlier window of the same length and never against another member — as
 * neutral hint text: a signed number and the words, no arrow and no verdict
 * colour (the Progress tiles' rule, design-progression-hub.md §3.8).
 */
export function movedHint(score: Pick<InsightsScore, 'movedBy'> | null | undefined): string | null {
  const moved = Array.isArray(score?.movedBy) ? score.movedBy[0] : null;
  if (!moved) return null;
  const delta = Number(moved.delta);
  if (!Number.isFinite(delta) || delta === 0) return null;
  const label = SCORE_PART_LABELS[String(moved.key)] ?? String(moved.key);
  const sign = delta > 0 ? '+' : '−';
  return `${label} ${sign}${whole(Math.abs(delta))} points vs your previous week`;
}

/* ----------------------------------------------------------- the load */

/** `load.label.*`: the server's five keys as the design's five sentences. Never a colour. */
export const LOAD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  well_below: 'This week is well below your usual.',
  below: 'This week is below your usual.',
  steady: 'This week is steady with your usual.',
  above: 'This week is above your usual.',
  well_above: 'This week is well above your usual.',
});

export const LOAD_STRINGS = {
  title: 'Training load',
  weeks: 'Load by week',
  thisWeek: 'This week',
  usual: 'Your usual',
  usualNote: 'Your usual is the average of the last four weeks.',
  showNumbers: 'Show numbers',
  hideNumbers: 'Hide numbers',
  explainer: 'Effort times minutes, added up. Rate a session on Workout complete.',
  offer: 'Want a lighter session today?',
} as const;

/** The load's one line: the design sentence for the server's label, or the server's gap. */
export function loadLine(load: TrainingLoad | null | undefined): string | null {
  if (!load || load.state === 'off') return null;
  if (load.state === 'not_enough_data') return reasonCopy(load.reason, load.missing) || null;
  return LOAD_LABELS[String(load.label ?? '')] ?? null;
}

/** `load.numbers(acute, chronic, ratio)` — the disclosure behind "Show numbers". */
export function loadNumbers(load: TrainingLoad | null | undefined): string | null {
  if (!load || load.state !== 'scored') return null;
  const acute = Number(load.acute?.load);
  const chronic = Number(load.chronic?.weeklyMean);
  const ratio = Number(load.ratio);
  if (!Number.isFinite(acute) || !Number.isFinite(chronic)) return null;
  const tail = Number.isFinite(ratio) ? ` · Ratio ${ratio.toFixed(2)}` : '';
  return `${LOAD_STRINGS.thisWeek} ${whole(acute)} · ${LOAD_STRINGS.usual} ${whole(chronic)}${tail}`;
}

/** `load.rated(n, m)` — how much of the week was the member's own rating. */
export function loadRatedLine(load: TrainingLoad | null | undefined): string | null {
  if (!load || load.state !== 'scored') return null;
  const rated = Number(load.acute?.rated);
  const sessions = Number(load.acute?.sessions);
  if (!Number.isFinite(rated) || !(sessions > 0)) return null;
  return `${whole(rated)} of ${plural(sessions, 'session')} rated; the rest estimated from your median.`;
}

/** The lighter-session offer, and only when the API made it (Focus = Recover on a high load). */
export function loadOfferLine(load: TrainingLoad | null | undefined): string | null {
  return load?.offer === 'lighter_session' ? LOAD_STRINGS.offer : null;
}

/** The bars the weekly strip draws; a `null` load is a week the API could not total, not a zero. */
export type LoadBar = { weekKey: string; load: number | null; sessions: number; ratio: number };

/**
 * The strip's geometry: every week the API sent, scaled against the tallest
 * week in the set. The API gives no scale, so there is no y-axis — the bars
 * are relative to each other and each says its own number aloud.
 */
export function loadBars(load: Pick<TrainingLoad, 'weekly'> | null | undefined): LoadBar[] {
  const weeks = Array.isArray(load?.weekly) ? load.weekly : [];
  const max = weeks.reduce((top, week) => Math.max(top, Number(week.load) > 0 ? Number(week.load) : 0), 0);
  return weeks.map((week) => {
    // `null` is a week the API could not total (an unrated session and no
    // median yet), not a zero: Number(null) is 0, so the key is read first.
    const raw = week.load;
    const value = raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw);
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

/* ------------------------------------------------------------------ focus */

/** The four focus values the route accepts, with the server's own labels (services/focusRules.js FOCUS_LABELS). */
export const FOCUS_LABELS: Readonly<Record<FocusKind, string>> = Object.freeze({
  build: 'Build',
  event: 'Event',
  stay_active: 'Stay active',
  recover: 'Recover',
});

export const FOCUS_KINDS: readonly FocusKind[] = ['build', 'event', 'stay_active', 'recover'];

export const FOCUS_OPTIONS: ReadonlyArray<{ kind: FocusKind; label: string }> = FOCUS_KINDS.map((kind) => ({ kind, label: FOCUS_LABELS[kind] }));

/** The focus row's value: the server's own label, printed as given. */
export function focusValue(focus: Focus | null | undefined): string | null {
  if (!focus) return null;
  return focus.label || FOCUS_LABELS[focus.kind] || null;
}

/* ------------------------------------------------------------ welcome back */

/**
 * The welcome-back line. The API sends no sentence, only the gap and the
 * offers, so the greeting is composed from `idleDays` and — above zero only —
 * the chain that is still standing. Nothing about what the gap cost.
 */
export function welcomeBackLine(record: WelcomeBack | null | undefined): string | null {
  if (!record) return null;
  const idle = numberOf(record.idleDays);
  if (idle === null || idle < 1) return 'Welcome back.';
  const kept = numberOf(record.target?.weeksKept);
  const chain = kept !== null && kept >= 1 ? ` Your ${plural(kept, 'week')} kept are still here.` : '';
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
  const weeks = numberOf(record.breakOffer?.weeks);
  if (weeks !== null && weeks >= 1) {
    return { action: 'keep_target', label: `Count ${plural(weeks, 'week')} as a break`, countAsBreak: true };
  }
  const lowerTo = numberOf(record.target?.lowerTo);
  if (lowerTo !== null && lowerTo >= 1) {
    return { action: 'lower_target', label: `Lower to ${plural(lowerTo, 'day')} a week` };
  }
  return null;
}

export const INSIGHTS_STRINGS = {
  focusRow: 'This week’s focus',
  focusEdit: 'Change focus',
  focusSheet: 'This week’s focus',
  focusNone: 'Choose one',
  focusSave: 'Save focus',
  focusEventDate: 'Event date',
  focusClear: 'Clear focus',
} as const;
