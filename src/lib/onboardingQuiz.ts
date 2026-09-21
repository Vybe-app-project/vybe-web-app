/**
 * The first-run quiz: four single-tap questions that each write a field the
 * API actually has, and that change the first screen the member sees.
 *
 * Every value here is the server's own vocabulary, read from
 * `models/UserProfile.js` and `controllers/onboardingController.js`:
 *
 *   trainingGoals     1-3 of TRAINING_GOALS          POST /api/onboarding
 *   weeklyTargetDays  a whole number 2-6             POST /api/onboarding
 *                     (mirrored to the Rhythm target by the same handler)
 *   experienceLevel   one of EXPERIENCE_LEVELS       POST /api/onboarding
 *   homeGym           { place: { osmId, name } }     PUT  /api/users/settings
 *
 * The brief asked for an "equipment" step. There is no user-level equipment
 * or training-location field anywhere on this API — equipment is gym-scoped
 * (`models/GymEquipment.js`, `PUT /gyms/community/:gymId/equipment`) — so
 * that step asks experience instead, which is a real onboarding field on the
 * same route and the one the server's own step list names.
 *
 * Units are not asked: `POST /auth/register-password` resolves
 * `settings.units` from the browser locale at account creation, so the last
 * step shows the resolved value with the shared control rather than making
 * the member answer a question that is already answered.
 *
 * The first save must carry a goal (`'At least one goal is required'`), so
 * the whole quiz is written in one POST at the end; a run that skipped the
 * goal writes no profile at all rather than earning a 400.
 *
 * Import-free on purpose: tests/onboarding-quiz.test.mjs transpiles this
 * file and imports the result directly.
 */

/* ------------------------------------------------------------- the steps */

export const QUIZ_STEPS = ['goal', 'days', 'experience', 'gym'] as const;
export type QuizStepKey = (typeof QUIZ_STEPS)[number];

export const QUIZ_TITLES: Readonly<Record<QuizStepKey, string>> = Object.freeze({
  goal: 'What are you here for?',
  days: 'How many days a week?',
  experience: 'Where are you starting from?',
  gym: 'Where do you train?',
});

export const QUIZ_SUBTITLES: Readonly<Record<QuizStepKey, string>> = Object.freeze({
  goal: 'One tap. It picks the plan we open on.',
  days: 'Your weekly target. Change it any time.',
  experience: 'So the first week is the right size.',
  gym: 'Your gym puts the people who train there on your home screen.',
});

export const SKIP = 'Skip';
export const QUIZ_DONE = 'Take me to my first week';

/* -------------------------------------------------------------- the goal */

/** `models/UserProfile.js` TRAINING_GOALS, in full. 1-3 may be sent; the quiz sends one. */
export const TRAINING_GOALS = [
  'get-stronger',
  'build-muscle',
  'move-more',
  'build-a-habit',
  'train-with-friends',
  'improve-endurance',
  'feel-better',
] as const;
export type TrainingGoal = (typeof TRAINING_GOALS)[number];

export const GOAL_LABELS: Readonly<Record<TrainingGoal, string>> = Object.freeze({
  'get-stronger': 'Get stronger',
  'build-muscle': 'Build muscle',
  'move-more': 'Move more',
  'build-a-habit': 'Build a habit',
  'train-with-friends': 'Train with friends',
  'improve-endurance': 'Improve endurance',
  'feel-better': 'Feel better',
});

/* --------------------------------------------------------- days per week */

/** `WEEKLY_TARGET_DAYS_MIN` / `MAX` (models/UserProfile.js); the schema default is 3. */
export const WEEKLY_TARGET_MIN = 2;
export const WEEKLY_TARGET_MAX = 6;
export const WEEKLY_TARGET_DEFAULT = 3;
export const WEEKLY_TARGET_OPTIONS = [2, 3, 4, 5, 6] as const;

/* ------------------------------------------------------------ experience */

/** `models/UserProfile.js` EXPERIENCE_LEVELS. */
export const EXPERIENCE_LEVELS = ['new', 'returning', 'regular', 'experienced'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const EXPERIENCE_LABELS: Readonly<Record<ExperienceLevel, string>> = Object.freeze({
  new: 'New to training',
  returning: 'Coming back to it',
  regular: 'Training regularly',
  experienced: 'Years of it',
});

/* -------------------------------------------------------------- answers */

export type QuizAnswers = {
  goal?: TrainingGoal | null;
  weeklyTargetDays?: number | null;
  experience?: ExperienceLevel | null;
};

export type OnboardingBody = {
  trainingGoals: TrainingGoal[];
  weeklyTargetDays?: number;
  experienceLevel?: ExperienceLevel;
};

/**
 * The one `POST /api/onboarding` body, or null when there is nothing the
 * server would accept. A goal is load-bearing: the profile's first save
 * refuses without one, and a later partial save would 400 just the same, so
 * a run with no goal writes nothing at all.
 */
export function onboardingBody(answers: QuizAnswers | null | undefined): OnboardingBody | null {
  const goal = answers?.goal;
  if (!goal || !(TRAINING_GOALS as readonly string[]).includes(goal)) return null;
  const body: OnboardingBody = { trainingGoals: [goal] };
  const days = answers?.weeklyTargetDays;
  if (typeof days === 'number' && Number.isInteger(days) && days >= WEEKLY_TARGET_MIN && days <= WEEKLY_TARGET_MAX) {
    body.weeklyTargetDays = days;
  }
  const level = answers?.experience;
  if (level && (EXPERIENCE_LEVELS as readonly string[]).includes(level)) body.experienceLevel = level;
  return body;
}

/* ------------------------------------------------- the plan the goal picks */

/**
 * A premade plan as `GET /workouts/commom/workouts/plan/all/premade/fetch`
 * sends it (the key on the wire is `workouts`). `goal` is free text on the
 * plan schema and is not drawn from TRAINING_GOALS, so there is no server
 * mapping to read: the match is the client's, over the words the plan
 * already carries.
 */
export type PremadePlan = {
  _id: string;
  title?: string;
  description?: string;
  goal?: string;
  level?: string;
  durationWeeks?: number;
};

/** What each goal is looking for in a plan's words, best signal first. */
export const GOAL_PLAN_WORDS: Readonly<Record<TrainingGoal, string[]>> = Object.freeze({
  'get-stronger': ['strength', 'stronger', 'lift', 'power'],
  'build-muscle': ['muscle', 'hypertrophy', 'build', 'size'],
  'move-more': ['move', 'walk', 'active', 'daily', 'steps'],
  'build-a-habit': ['foundation', 'habit', 'consistency', 'starter', 'beginner'],
  'train-with-friends': ['together', 'partner', 'friends', 'crew'],
  'improve-endurance': ['endurance', 'cardio', 'run', 'conditioning', 'stamina'],
  'feel-better': ['mobility', 'recovery', 'yoga', 'stretch', 'flow'],
});

const words = (plan: PremadePlan): string =>
  `${plan.title ?? ''} ${plan.goal ?? ''} ${plan.description ?? ''}`.toLowerCase();

/**
 * The plan the last screen highlights. The first keyword that hits wins, so
 * "strength" beats "power" for someone who wants to get stronger; a goal
 * that matches nothing falls back to the first beginner plan and then to the
 * first plan at all, because landing on *a* programme beats landing on none.
 * No plans, no suggestion — never an invented id.
 */
export function suggestedPlanFor(goal: TrainingGoal | null | undefined, plans: readonly PremadePlan[] | null | undefined): PremadePlan | null {
  const list = (plans ?? []).filter((p) => p && typeof p._id === 'string' && p._id);
  if (list.length === 0) return null;
  const keywords = goal ? GOAL_PLAN_WORDS[goal] ?? [] : [];
  for (const keyword of keywords) {
    const hit = list.find((plan) => words(plan).includes(keyword));
    if (hit) return hit;
  }
  return list.find((plan) => (plan.level ?? '').toLowerCase() === 'beginner') ?? list[0];
}

/** The query the Workouts hub reads to open on the suggested programme. */
export const SUGGEST_PARAM = 'suggest';

/**
 * Where the quiz lands. `?suggest=<planId>` is additive: a hub that does not
 * read it yet still opens on the browse tab, which is where the programmes
 * are, so the last step is never a dead end.
 */
export function quizLandingPath(planId: string | null | undefined): string {
  return planId ? `/workouts?tab=browse&${SUGGEST_PARAM}=${encodeURIComponent(planId)}` : '/workouts?tab=browse';
}
