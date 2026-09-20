/**
 * The Get started card's rules for a member's first week on the web Home
 * (design-first-week-and-people.md §3.1 and §4), as pure functions of the
 * payloads the API already answers. Mirrors the mobile getStartedModel.ts so
 * the two clients judge the same account the same way:
 *
 *   - Four steps, each judged from one or two sources that are feature-
 *     detected independently: a 404 makes a source `not-deployed`; a step
 *     whose every source is `not-deployed` is `unavailable` and its row hides
 *     while the card still renders the others.
 *   - The card shows for the first FIRST_WEEK_DAYS after the account's
 *     `createdAt` (GET /users/me), never after a dismissal, and never once
 *     every available step is done or no step is available.
 *   - "Day 3 of your first week" is a calendar position in the device zone,
 *     never a remaining count (DP-004).
 *   - Today's step is the first open step in the order the server's day-2
 *     planner uses (session → gym → people → meal), so the card and the
 *     check-in point at the same thing.
 *   - The starter session is the seeded premade "Foundation Full Body" read
 *     through the premade catalogue (the API has no starter route and
 *     SocialWorkout has no slug), matched by title, then by its four moves,
 *     else a constant with the §4 copy.
 *
 * Import-free on purpose: tests/first-week-home.test.mjs loads this file
 * directly and nothing in the client can cycle through it. Copy lives at the
 * bottom (`firstWeekStrings`); the banned list is exported so the test can
 * walk every string.
 */

export type StepKey = 'first-move' | 'social-spark' | 'join-gym' | 'first-meal';

/** Display order on the card. */
export const STEP_KEYS: readonly StepKey[] = ['first-move', 'social-spark', 'join-gym', 'first-meal'];

/** The card lives for the first seven days after account creation. */
export const FIRST_WEEK_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ sources */

/**
 * One remote read. `not-deployed` is the 404 the API answers for a route it
 * does not have; `error` is anything else that stopped the read (offline, a
 * 5xx, a malformed body).
 */
export type SourceReading<T> = { kind: 'value'; value: T } | { kind: 'not-deployed' } | { kind: 'error' };

export const sourceValue = <T>(value: T): SourceReading<T> => ({ kind: 'value', value });
export const SOURCE_NOT_DEPLOYED: SourceReading<never> = { kind: 'not-deployed' };
export const SOURCE_ERROR: SourceReading<never> = { kind: 'error' };

/** The slice of `GET /achievements/user` the steps read. */
export type AchievementLike = {
  name: string;
  /** `criteria.type`: 'workouts' | 'likes' | 'followers' | 'following' | … */
  criteriaType: string;
  progress: number;
  isEarned: boolean;
};

export type Sources = {
  /** GET /workouts/logs?page=1&limit=1: how many logs exist (`total`, else the page length). */
  workoutLogs: SourceReading<number>;
  /** The signed-in user's following count from /users/me; null when the payload has none. */
  following: number | null;
  /** GET /gyms/community/my-communities: how many joined communities. */
  communities: SourceReading<number>;
  /** GET /meals/streak: the last meal's timestamp, null when nothing was ever logged. */
  meals: SourceReading<{ lastLoggedDate: string | null }>;
  /** GET /achievements/user, an optional second vote for first-move and social-spark. */
  achievements?: SourceReading<AchievementLike[]>;
};

/** Achievement criteria types that mean "did a first social thing". */
export const SOCIAL_CRITERIA_TYPES: ReadonlySet<string> = new Set(['likes', 'followers', 'following']);
/** Achievement criteria types that mean "completed a workout". */
export const WORKOUT_CRITERIA_TYPES: ReadonlySet<string> = new Set(['workouts']);

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

/** Reduce one raw achievement row to what the steps need; null when it is not one. */
export function normalizeAchievement(raw: unknown): AchievementLike | null {
  const row = asRecord(raw);
  const name = typeof row.name === 'string' ? row.name : typeof row.title === 'string' ? row.title : '';
  if (!name) return null;
  const criteria = asRecord(row.criteria);
  return {
    name,
    criteriaType: typeof criteria.type === 'string' ? criteria.type : '',
    progress: Math.max(0, finite(row.progress) ?? 0),
    isEarned: row.isEarned === true,
  };
}

/**
 * How many accounts the signed-in user follows, from the /users/me payload:
 * the `following` array (the User document as toJSON serialises it), or a
 * `followingCount` / `stats.following` number where a projection sends one.
 * Null when the payload carries none of them.
 */
export function followingCountOf(user: unknown): number | null {
  const row = asRecord(user);
  if (Array.isArray(row.following)) return row.following.length;
  const direct = finite(row.followingCount);
  if (direct !== null) return Math.max(0, direct);
  const stat = finite(asRecord(row.stats).following);
  return stat === null ? null : Math.max(0, stat);
}

/** True when any achievement of these criteria types has been earned or has progress. */
export function achievementsShowProgress(achievements: readonly AchievementLike[], criteriaTypes: ReadonlySet<string>): boolean {
  return achievements.some((a) => criteriaTypes.has(a.criteriaType) && (a.isEarned || a.progress >= 1));
}

/* -------------------------------------------------------------------- steps */

/**
 * `done` / `todo` when a source answered; `unavailable` when every source the
 * step reads is missing from this API (the row hides); `unknown` when no
 * source answered and at least one failed (the row renders as still to do).
 */
export type StepStatus = 'done' | 'todo' | 'unavailable' | 'unknown';

export type Step = { key: StepKey; status: StepStatus };

type Verdict = { answered: boolean; deployed: boolean; done: boolean };

const judge = <T>(reading: SourceReading<T> | undefined, isDone: (value: T) => boolean): Verdict[] => {
  if (!reading) return [];
  if (reading.kind === 'value') return [{ answered: true, deployed: true, done: isDone(reading.value) }];
  if (reading.kind === 'not-deployed') return [{ answered: false, deployed: false, done: false }];
  return [{ answered: false, deployed: true, done: false }];
};

const statusOf = (verdicts: readonly Verdict[]): StepStatus => {
  if (verdicts.some((v) => v.done)) return 'done';
  if (verdicts.some((v) => v.answered)) return 'todo';
  if (verdicts.length > 0 && verdicts.every((v) => !v.deployed)) return 'unavailable';
  return 'unknown';
};

export function stepStatus(key: StepKey, sources: Sources): StepStatus {
  switch (key) {
    case 'first-move':
      return statusOf([
        ...judge(sources.achievements, (list) => achievementsShowProgress(list, WORKOUT_CRITERIA_TYPES)),
        ...judge(sources.workoutLogs, (count) => count >= 1),
      ]);
    case 'social-spark': {
      const verdicts: Verdict[] = judge(sources.achievements, (list) => achievementsShowProgress(list, SOCIAL_CRITERIA_TYPES));
      if (sources.following !== null) verdicts.push({ answered: true, deployed: true, done: sources.following >= 1 });
      return statusOf(verdicts);
    }
    case 'join-gym':
      return statusOf(judge(sources.communities, (count) => count >= 1));
    case 'first-meal':
      return statusOf(judge(sources.meals, (meals) => meals.lastLoggedDate !== null));
  }
}

export function buildSteps(sources: Sources): Step[] {
  return STEP_KEYS.map((key) => ({ key, status: stepStatus(key, sources) }));
}

/** The rows the card can draw: every step this API can judge. */
export const visibleSteps = (steps: readonly Step[]): Step[] => steps.filter((s) => s.status !== 'unavailable');

export const isOpen = (status: StepStatus): boolean => status === 'todo' || status === 'unknown';

export type Progress = { done: number; total: number };

export function progressOf(steps: readonly Step[]): Progress {
  const visible = visibleSteps(steps);
  return { done: visible.filter((s) => s.status === 'done').length, total: visible.length };
}

/** True when nothing answered at all: every step is `unknown` or `unavailable`, and at least one is `unknown`. */
export function nothingAnswered(steps: readonly Step[]): boolean {
  return steps.some((s) => s.status === 'unknown') && steps.every((s) => s.status === 'unknown' || s.status === 'unavailable');
}

/* ------------------------------------------------------- today and the nudge */

/**
 * The order the server's day-2 planner reads the four sources in
 * (services/returnLoop.js pickDay2Variant: session → gym → people → meal).
 * The card's one primary row is the first open step in this order.
 */
export const TODAY_STEP_ORDER: readonly StepKey[] = ['first-move', 'join-gym', 'social-spark', 'first-meal'];

/** The first still-open step in `TODAY_STEP_ORDER`, optionally among `among` only; null when none is open. */
export function todaysStep(steps: readonly Step[], among?: ReadonlySet<StepKey>): StepKey | null {
  for (const key of TODAY_STEP_ORDER) {
    if (among && !among.has(key)) continue;
    const step = steps.find((s) => s.key === key);
    if (step && isOpen(step.status)) return key;
  }
  return null;
}

/** Whether "Log a workout" opens the Start here dialog: until the first log exists. */
export const starterOffered = (steps: readonly Step[]): boolean => steps.some((s) => s.key === 'first-move' && s.status !== 'done');

/**
 * The people row waits until day 2: on day 1 the WelcomeSheet already put a
 * few people in front of the member, so the card does not say it twice.
 * Shown while the step is still open; a done step never nudges.
 */
export function peopleNudgeVisible(day: number, steps: readonly Step[]): boolean {
  if (day < 2) return false;
  const step = steps.find((s) => s.key === 'social-spark');
  return !!step && isOpen(step.status);
}

export type CardRows = {
  /** Open rows in display order, after the people-nudge rule. */
  open: StepKey[];
  /** Done steps in display order (collapsed to one line by the card). */
  done: StepKey[];
  /** The one primary row, chosen among the open rows in the planner's order. */
  today: StepKey | null;
};

/** What the card draws for a judged account on a given day. */
export function cardRows(steps: readonly Step[], day: number): CardRows {
  const visible = visibleSteps(steps);
  const open = visible
    .filter((s) => isOpen(s.status))
    .filter((s) => s.key !== 'social-spark' || peopleNudgeVisible(day, steps))
    .map((s) => s.key);
  const done = visible.filter((s) => s.status === 'done').map((s) => s.key);
  return { open, done, today: todaysStep(steps, new Set(open)) };
}

/* ------------------------------------------------------ window and visibility */

/** Epoch ms of `createdAt`, or null when it is absent or unreadable. */
export function parseCreatedAt(createdAt: unknown): number | null {
  if (createdAt instanceof Date) {
    const time = createdAt.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof createdAt === 'number') return Number.isFinite(createdAt) ? createdAt : null;
  if (typeof createdAt !== 'string' || !createdAt.trim()) return null;
  const time = Date.parse(createdAt);
  return Number.isFinite(time) ? time : null;
}

/**
 * Days since the account was created, 1-based by elapsed time: day 1 is the
 * first 24 hours, day 8 is the first day the card no longer shows. A
 * `createdAt` slightly in the future (device clock behind the server) is day 1.
 */
export function windowDay(createdAtMs: number, now: number): number {
  const elapsed = Math.max(0, now - createdAtMs);
  return Math.floor(elapsed / DAY_MS) + 1;
}

export const isWithinWindow = (createdAtMs: number, now: number): boolean => windowDay(createdAtMs, now) <= FIRST_WEEK_DAYS;

/** Midnight before `ms` in the device's zone. */
export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * "Day 3 of your first week" is a position in the device's calendar: the day
 * after a 23:00 sign-up is day 2 the next morning. Clamped to 1..7 so the
 * line never names a day the card has already left (`windowDay` decides
 * visibility by elapsed time). Never a remaining count (DP-004).
 */
export function firstWeekDay(createdAtMs: number, now: number): number {
  const days = Math.floor((startOfLocalDay(now) - startOfLocalDay(createdAtMs)) / DAY_MS) + 1;
  return Math.min(FIRST_WEEK_DAYS, Math.max(1, days));
}

export type HiddenReason = 'flag-off' | 'no-user' | 'no-created-at' | 'window-passed' | 'dismissed' | 'all-done' | 'nothing-available';

export type CardDecision = { show: true } | { show: false; reason: HiddenReason };

export type CardDecisionInput = {
  /** The signed-in user's id; the card is per account. */
  userId: string | null;
  /** `createdAt` from /users/me (the offline snapshot has none, so the card hides offline). */
  createdAt: unknown;
  now: number;
  /** Epoch ms of the dismissal for this account, or null. */
  dismissedAt: number | null;
  /** The judged steps, or null before the first load has answered. */
  steps: readonly Step[] | null;
  /** `features.getStartedCard === false` from /capabilities: an explicit kill switch. Absent = on. */
  featureOff?: boolean;
};

export function decideCard(input: CardDecisionInput): CardDecision {
  if (input.featureOff) return { show: false, reason: 'flag-off' };
  if (!input.userId) return { show: false, reason: 'no-user' };
  const createdAt = parseCreatedAt(input.createdAt);
  if (createdAt === null) return { show: false, reason: 'no-created-at' };
  if (!isWithinWindow(createdAt, input.now)) return { show: false, reason: 'window-passed' };
  if (input.dismissedAt !== null) return { show: false, reason: 'dismissed' };
  if (input.steps) {
    const { done, total } = progressOf(input.steps);
    if (total === 0) return { show: false, reason: 'nothing-available' };
    if (done === total) return { show: false, reason: 'all-done' };
  }
  return { show: true };
}

/* ---------------------------------------------------------------- dismissal */

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** localStorage JSON `{ [userId]: ISO }`: one dismissal per account, kept on this browser. */
export const FIRST_WEEK_DISMISSED_KEY = 'vybe.firstWeekDismissed';

const readMap = (storage: StorageLike | null | undefined): Record<string, string> => {
  try {
    const raw = storage?.getItem(FIRST_WEEK_DISMISSED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) if (typeof value === 'string') out[key] = value;
    return out;
  } catch {
    return {};
  }
};

const writeMap = (storage: StorageLike | null | undefined, map: Record<string, string>): void => {
  try {
    if (Object.keys(map).length === 0) storage?.removeItem(FIRST_WEEK_DISMISSED_KEY);
    else storage?.setItem(FIRST_WEEK_DISMISSED_KEY, JSON.stringify(map));
  } catch {
    // Storage full, disabled or private mode: the card comes back next visit, which is the honest fallback.
  }
};

/** Epoch ms of this account's dismissal, or null. Never throws. */
export function readDismissedAt(storage: StorageLike | null | undefined, userId: string | null | undefined): number | null {
  if (!userId) return null;
  const at = readMap(storage)[userId];
  if (!at) return null;
  const time = Date.parse(at);
  return Number.isFinite(time) ? time : null;
}

/** Record a dismissal for this account. Never throws. */
export function writeDismissed(storage: StorageLike | null | undefined, userId: string | null | undefined, now = Date.now()): void {
  if (!userId) return;
  const map = readMap(storage);
  map[userId] = new Date(now).toISOString();
  writeMap(storage, map);
}

/** Undo a dismissal for this account. Never throws. */
export function clearDismissed(storage: StorageLike | null | undefined, userId: string | null | undefined): void {
  if (!userId) return;
  const map = readMap(storage);
  if (!(userId in map)) return;
  delete map[userId];
  writeMap(storage, map);
}

/* ------------------------------------------------------------------ starter */

/** The shape of a premade catalogue row this module reads (src/pages/Workouts.tsx SocialWorkout fits). */
export type StarterTemplateLike = {
  _id?: string;
  title?: string;
  category?: string;
  /** Minutes, as the catalogue stores it. */
  duration?: number;
  exercises?: ReadonlyArray<{ name: string; sets?: number; reps?: number; [k: string]: unknown }>;
  [k: string]: unknown;
};

/** What the log form is seeded with: the existing LogSeed shape, nothing the POST route rejects. */
export type StarterLogSeed = {
  name: string;
  type: string;
  /** Minutes. */
  duration: number;
  exercises: Array<{ name: string; sets?: number; reps?: number }>;
};

/** D-83 default: the seeded catalogue entry's title and its four moves, for matching either way. */
export const STARTER_TEMPLATE_TITLE = 'Foundation Full Body';
export const STARTER_EXERCISE_NAMES: readonly string[] = ['Bodyweight Squat', 'Incline Push-Up', 'Glute Bridge', 'Dead Bug'];
/** The log's name, on both clients. */
export const STARTER_SESSION_NAME = 'Start here';
/** The spec's estimate; the catalogue's own `duration` wins when it carries one (the seed says 28). */
export const STARTER_SESSION_MINUTES = 18;

/** The starter when the catalogue lacks it: the four moves from the seed, with the §4 copy's length. */
export const STARTER_FALLBACK: StarterLogSeed = Object.freeze({
  name: STARTER_SESSION_NAME,
  type: 'strength',
  duration: STARTER_SESSION_MINUTES,
  exercises: [
    { name: 'Bodyweight Squat', sets: 3, reps: 12 },
    { name: 'Incline Push-Up', sets: 3, reps: 10 },
    { name: 'Glute Bridge', sets: 3, reps: 15 },
    { name: 'Dead Bug', sets: 3, reps: 10 },
  ],
}) as StarterLogSeed;

const norm = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    : '';

/**
 * The starter session from the premade catalogue: the entry titled
 * "Foundation Full Body" (case and punctuation insensitive), else the one
 * whose exercises include the four moves, else null. Never a guess at a
 * different session: the owner names another under D-83.
 */
export function pickStarterTemplate<T extends StarterTemplateLike>(workouts: readonly T[] | null | undefined): T | null {
  if (!Array.isArray(workouts)) return null;
  const byTitle = workouts.find((w) => norm(w.title) === norm(STARTER_TEMPLATE_TITLE));
  if (byTitle) return byTitle;
  const wanted = STARTER_EXERCISE_NAMES.map(norm);
  return (
    workouts.find((w) => {
      const list: NonNullable<StarterTemplateLike['exercises']> = w.exercises ?? [];
      const names = list.map((e) => norm(e.name));
      return wanted.every((name) => names.includes(name));
    }) ?? null
  );
}

/** What the row says the session takes: the catalogue's duration when finite and > 0, else the spec's 18. */
export function starterMinutes(template: StarterTemplateLike | null | undefined): number {
  const duration = template?.duration;
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : STARTER_SESSION_MINUTES;
}

/**
 * The log form's seed for the starter: named "Start here", typed from the
 * catalogue entry (else strength), as long as `starterMinutes`, with each
 * exercise's name, sets and reps only. `rest`, `weight` and `caloriesBurned`
 * are left out on purpose: the log route rejects unknown fields and the
 * member fills in what they actually did.
 */
export function starterLogSeed(template: StarterTemplateLike | null | undefined): StarterLogSeed {
  if (!template) return { ...STARTER_FALLBACK, exercises: STARTER_FALLBACK.exercises.map((e) => ({ ...e })) };
  const exercises = (template.exercises ?? [])
    .filter((e) => typeof e.name === 'string' && e.name.trim())
    .map((e) => ({
      name: e.name,
      ...(typeof e.sets === 'number' && Number.isFinite(e.sets) ? { sets: e.sets } : {}),
      ...(typeof e.reps === 'number' && Number.isFinite(e.reps) ? { reps: e.reps } : {}),
    }));
  return {
    name: STARTER_SESSION_NAME,
    type: typeof template.category === 'string' && template.category ? template.category : 'strength',
    duration: starterMinutes(template),
    exercises: exercises.length ? exercises : STARTER_FALLBACK.exercises.map((e) => ({ ...e })),
  };
}

/* -------------------------------------------------------------------- hrefs */

/** Where each row goes. One place, so a moved page (Discover → People) is one edit. */
export const STEP_HREFS: Readonly<Record<StepKey, string>> = Object.freeze({
  'first-move': '/workouts/logs?log=1',
  'social-spark': '/discover?tab=people',
  'join-gym': '/gyms',
  'first-meal': '/meals?log=1',
});

/** Start here: the log form seeded with the starter (src/pages/WorkoutLogs.tsx reads `starter=1`). */
export const STARTER_HREF = '/workouts/logs?log=1&starter=1';
/** Start empty: the plain log form. */
export const START_EMPTY_HREF = STEP_HREFS['first-move'];

/* --------------------------------------------------------------------- copy */

export type StepCopy = {
  /** Row title, sentence case, the plain verb. */
  title: string;
  /** One sentence, one verb: what counts. */
  body: string;
};

const steps: Readonly<Record<StepKey, StepCopy>> = {
  'first-move': { title: 'Log a workout', body: 'Any length counts.' },
  'social-spark': { title: 'Follow someone', body: 'Kudos on a post counts too.' },
  'join-gym': { title: 'Join a gym', body: 'Find your gym’s community.' },
  'first-meal': { title: 'Log a meal', body: 'A snack counts.' },
};

/**
 * Every word the card can say (design §4, verbatim). Sentence case, no
 * urgency, no countdown, no exclamation mark; tests/first-week-home.test.mjs
 * walks every string here against FIRST_WEEK_BANNED.
 */
export const firstWeekStrings = {
  card: {
    title: 'Get started',
    /** "1 of 4 done" */
    progress: (done: number, total: number) => `${done} of ${total} done`,
    /** "Log a workout, Follow someone — done" */
    doneLine: (titles: readonly string[] | string) => `${Array.isArray(titles) ? titles.join(', ') : String(titles)} — done`,
  },
  /** Under the card title: a position in the week, in the device's calendar. */
  day: (n: number) => `Day ${n} of your first week`,
  /** The tag on the one primary row. */
  today: 'Today',
  steps,
  dismiss: {
    label: 'Not now, hide this card',
    toast: 'Card hidden.',
    undo: 'Undo',
  },
  states: {
    loading: 'Checking your first steps',
    error: 'Couldn’t load your first steps.',
    retry: 'Retry',
    retryLabel: 'Retry loading your first steps',
    offline: 'You’re offline. Your first steps will show when you’re back online.',
  },
  starter: {
    sheetTitle: 'Your first session',
    /** "Start here · 18 min" */
    title: (min: number) => `Start here · ${min} min`,
    body: (min: number) => `Four moves, bodyweight, about ${min} minutes. Any length counts.`,
    empty: 'Start empty',
    emptyBody: 'Add your own exercises.',
    unavailable: 'The starter session isn’t available right now. Start empty instead.',
    loading: 'Checking the starter session',
    label: (min: number) => `Start the starter session, about ${min} minutes`,
    emptyLabel: 'Start an empty workout',
    closeLabel: 'Close your first session',
  },
} as const;

export type FirstWeekStrings = typeof firstWeekStrings;

/** Words the design philosophy bans from this surface (DP-004, DP-010); the tests walk every string. */
export const FIRST_WEEK_BANNED: readonly string[] = [
  'streak',
  'missed',
  'left',
  'expire',
  'expiring',
  'hurry',
  'last chance',
  'reward',
  'earn',
  'unlock',
  'bonus',
  'points',
  'free month',
  'refer and earn',
  '!',
];
