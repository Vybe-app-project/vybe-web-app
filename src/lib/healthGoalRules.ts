/**
 * Health-goal guardrails, mirrored from the API so the goals form can refuse
 * a payload before it is sent, using the same words the server would use.
 *
 * Sources (backend at 4e22914): services/healthGoalGuardrails.js (the rules,
 * their order and their copy) and utils/calorieCalculator.js (BMR, TDEE and
 * the daily target the pace produces). Every number here must match the
 * server's table in tests/v2-be-guardrails.health-goals.test.js; the web
 * test tests/health-goal-rules.test.mjs ports that table.
 *
 * The thresholds are environment variables on the server
 * (HEALTH_MIN_CALORIES, HEALTH_MAX_WEEKLY_RATE_PCT, HEALTH_MIN_TARGET_BMI)
 * and no endpoint exposes them: GET /api/capabilities carries feature
 * booleans and client policy only, and /users/me does not carry them either.
 * So the documented defaults live here. If an operator changes one, the
 * pre-check can disagree with the server by one round-trip; the server's
 * `limit` is authoritative, and the page renders it inline when the 400
 * comes back. Swap these constants for a capabilities read if the API lane
 * exposes them later.
 */
import { KG_PER_LB, lbToKg } from './unitConversions';

export const HEALTH_GOAL_GUARDRAIL = 'HEALTH_GOAL_GUARDRAIL';
export const CLIENT_UPDATE_REQUIRED = 'CLIENT_UPDATE_REQUIRED';
export const RATE_LIMITED = 'RATE_LIMITED';

export type HealthGender = 'male' | 'female' | 'other' | 'unspecified';
/** Stored values for `healthGoals.gender`; `unspecified` is never defaulted by the API. */
export const HEALTH_GENDERS: readonly HealthGender[] = ['male', 'female', 'other', 'unspecified'];

export type GuardrailRule = 'weekly_rate' | 'calorie_floor' | 'target_floor';
export type GuardrailField = 'weeklyGoal' | 'dailyCalorieGoal' | 'targetWeight';
export type GuardrailRefusal = {
  code: typeof HEALTH_GOAL_GUARDRAIL;
  field: GuardrailField;
  rule: GuardrailRule;
  /** kg/week for weekly_rate, kcal for calorie_floor, kg for target_floor. */
  limit: number;
  message: string;
};

export type HealthGuardrailThresholds = {
  /** Daily-target floor in kcal; the BMR is a second floor and the higher wins. */
  minCalories: number;
  /** Weekly weight-change cap as a share of current weight, in percent. */
  maxWeeklyRatePct: number;
  /** Floor for a target weight at the given height, as a BMI; 0 turns the rule off. */
  minTargetBmi: number;
};

/** Documented defaults (docs/DEPLOYMENT.md, deploy/docker-compose.yml). The API does not expose them. */
export const HEALTH_GUARDRAIL_DEFAULTS: HealthGuardrailThresholds = {
  minCalories: 1200,
  maxWeeklyRatePct: 1,
  minTargetBmi: 0,
};

export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extremely_active: 1.9,
};

/** Metric body of PUT /health-goals, exactly as the page sends it. */
export type HealthGoalsPayload = {
  currentWeight: number;
  heightCm: number;
  age: number;
  gender: string;
  activityLevel?: string;
  goal?: string;
  weeklyGoal?: number;
  targetWeight?: number;
  dailyCalorieGoal?: number;
};

type BodyStats = { currentWeight?: number; heightCm?: number; age?: number; gender?: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const round2 = (value: number) => Math.round(value * 100) / 100;

/** "1,239 kcal", as the server prints it. */
export const formatKcal = (value: number) => `${Math.round(value).toLocaleString('en-US')} kcal`;

/**
 * Mifflin-St Jeor resting estimate, kcal/day, whole number. `male` and
 * `female` use the published constants; `other`, `unspecified` and a missing
 * value use the mean of the two (−78, never one sex by default). Null when a
 * body stat is missing so callers can skip the BMR floor.
 */
export function estimateBmr({ currentWeight, heightCm, age, gender }: BodyStats = {}): number | null {
  if (!finite(currentWeight) || !finite(heightCm) || !finite(age)) return null;
  const base = 10 * currentWeight + 6.25 * heightCm - 5 * age;
  if (gender === 'male') return Math.round(base + 5);
  if (gender === 'female') return Math.round(base - 161);
  return Math.round(base + (5 - 161) / 2);
}

/** TDEE = BMR × activity multiplier (unknown level → moderately active), whole number. */
export function estimateTdee(bmr: number, activityLevel?: string): number {
  const multiplier = (activityLevel && ACTIVITY_MULTIPLIERS[activityLevel]) || 1.55;
  return Math.round(bmr * multiplier);
}

/**
 * The daily target the calculator produces from the pace. Losing: deficit of
 * pace × 7700 / 7 a day, capped at 1000, never under 1200. Gaining: surplus
 * capped at 500. Maintaining or anything else: the TDEE.
 */
export function estimateDailyCalorieGoal(tdee: number, goal?: string, weeklyGoal = 0): number {
  const daily = (weeklyGoal * 7700) / 7;
  if (goal === 'lose_weight') return Math.max(Math.round(tdee - Math.min(daily, 1000)), 1200);
  if (goal === 'gain_weight' || goal === 'gain_muscle') return Math.round(tdee + Math.min(daily, 500));
  return tdee;
}

/** The daily-calorie floor: the configured minimum or the BMR, whichever is higher. */
export function calorieFloor(stats: BodyStats, t: HealthGuardrailThresholds = HEALTH_GUARDRAIL_DEFAULTS): number {
  const bmr = estimateBmr(stats);
  return bmr === null ? t.minCalories : Math.max(t.minCalories, bmr);
}

/** Largest weekly change (kg/week) allowed at this body weight; null without a weight. */
export function weeklyRateCap(currentWeight: number | undefined, t: HealthGuardrailThresholds = HEALTH_GUARDRAIL_DEFAULTS): number | null {
  return finite(currentWeight) ? round2(currentWeight * (t.maxWeeklyRatePct / 100)) : null;
}

/** Lowest target weight (kg) planned for at this height; null while the rule is off. */
export function targetWeightFloor(heightCm: number | undefined, t: HealthGuardrailThresholds = HEALTH_GUARDRAIL_DEFAULTS): number | null {
  if (!finite(heightCm) || !(t.minTargetBmi > 0)) return null;
  const metres = heightCm / 100;
  return round2(t.minTargetBmi * metres * metres);
}

const refusal = (field: GuardrailField, rule: GuardrailRule, limit: number, message: string): GuardrailRefusal => ({
  code: HEALTH_GOAL_GUARDRAIL,
  field,
  rule,
  limit,
  message,
});

type GuardrailInput = BodyStats & {
  weeklyGoal?: number;
  targetWeight?: number;
  dailyCalorieGoal?: number;
  computedDailyCalorieGoal?: number;
};

/**
 * The server's rule set, in its order, with its copy verbatim:
 *   1. weeklyGoal above the rate cap                 (field weeklyGoal)
 *   2. an explicit dailyCalorieGoal under the floor  (field dailyCalorieGoal)
 *   3. the computed daily target under the floor     (field weeklyGoal)
 *   4. targetWeight under the height floor           (field targetWeight)
 * Null when everything passes.
 */
export function checkHealthGoals(input: GuardrailInput = {}, t: HealthGuardrailThresholds = HEALTH_GUARDRAIL_DEFAULTS): GuardrailRefusal | null {
  const { currentWeight, heightCm, weeklyGoal, targetWeight, dailyCalorieGoal, computedDailyCalorieGoal } = input;

  const cap = weeklyRateCap(currentWeight, t);
  if (cap !== null && finite(weeklyGoal) && weeklyGoal > cap) {
    return refusal('weeklyGoal', 'weekly_rate', cap, `That pace is faster than Vybe plans for. Pick a pace up to ${cap} kg a week.`);
  }

  const floor = calorieFloor(input, t);
  if (finite(dailyCalorieGoal) && dailyCalorieGoal < floor) {
    return refusal('dailyCalorieGoal', 'calorie_floor', floor, `That daily target is lower than Vybe plans for. Pick a target of at least ${formatKcal(floor)}.`);
  }
  if (!finite(dailyCalorieGoal) && finite(computedDailyCalorieGoal) && computedDailyCalorieGoal < floor) {
    return refusal(
      'weeklyGoal',
      'calorie_floor',
      floor,
      `That pace puts your daily target under ${formatKcal(floor)}, which is lower than Vybe plans for. Pick a slower pace.`,
    );
  }

  const targetFloor = targetWeightFloor(heightCm, t);
  if (targetFloor !== null && finite(targetWeight) && targetWeight < targetFloor) {
    return refusal('targetWeight', 'target_floor', targetFloor, 'That target is lower than Vybe plans for at your height. Pick a target closer to where you are now.');
  }

  return null;
}

/**
 * Judge the exact metric body about to be PUT: derive the computed daily
 * target the way the server does, then run the rules. Run this on the built
 * payload, never on the form strings, so lb→kg rounding cannot make the two
 * sides disagree at a boundary.
 */
export function checkHealthGoalsPayload(payload: HealthGoalsPayload, t: HealthGuardrailThresholds = HEALTH_GUARDRAIL_DEFAULTS): GuardrailRefusal | null {
  const bmr = estimateBmr(payload);
  const computedDailyCalorieGoal =
    bmr === null ? undefined : estimateDailyCalorieGoal(estimateTdee(bmr, payload.activityLevel), payload.goal, payload.weeklyGoal ?? 0);
  return checkHealthGoals({ ...payload, computedDailyCalorieGoal }, t);
}

/**
 * A kg pace cap as the largest one-decimal lb value the form will accept:
 * typing the returned number sends lbToKg(value) ≤ capKg. kgToLb rounds
 * half-up, so its result lands over the cap for about 40 % of body weights
 * (0.8 kg → 1.8 lb → 0.82 kg); this walks down from just above the exact
 * quotient until the round trip fits. Never negative; 0 for a 0 cap.
 */
export function capInLb(capKg: number): number {
  let tenths = Math.max(0, Math.ceil((capKg / KG_PER_LB) * 10) + 1);
  while (tenths > 0 && lbToKg(tenths / 10) > capKg) tenths -= 1;
  return tenths / 10;
}

/**
 * The server's copy, re-rendered in the person's units where the limit is a
 * weight. kcal copy is unit-free and the target-floor copy carries no number.
 * The lb cap is the largest value the form accepts, not the nearest tenth.
 */
export function guardrailMessageFor(r: GuardrailRefusal, system: 'metric' | 'imperial'): string {
  if (system === 'imperial' && r.rule === 'weekly_rate') {
    return `That pace is faster than Vybe plans for. Pick a pace up to ${capInLb(r.limit)} lb a week.`;
  }
  return r.message;
}

/**
 * A second, form-level sentence for the one refusal the field copy cannot
 * explain: the estimated maintenance itself is under the floor, so "pick a
 * slower pace" has nowhere to go. Undefined for every other refusal.
 */
export function guardrailFormNote(r: GuardrailRefusal, payload: HealthGoalsPayload): string | undefined {
  if (r.rule !== 'calorie_floor' || r.field !== 'weeklyGoal') return undefined;
  const bmr = estimateBmr(payload);
  if (bmr === null) return undefined;
  const tdee = estimateTdee(bmr, payload.activityLevel);
  if (tdee >= r.limit) return undefined;
  return `Your estimated maintenance is under ${formatKcal(r.limit)}, so Vybe cannot set a target from these stats.`;
}

/* ------------------------------------------------------------ error mapper */

export type HealthGoalsField = GuardrailField | 'currentWeight' | 'heightCm' | 'age' | 'gender' | 'activityLevel' | 'goal';

export type HealthGoalsApiError =
  | { kind: 'guardrail'; refusal: GuardrailRefusal }
  | { kind: 'field'; field: HealthGoalsField; message: string }
  | { kind: 'form'; message: string; code?: string };

const GUARDRAIL_FIELDS: readonly GuardrailField[] = ['weeklyGoal', 'dailyCalorieGoal', 'targetWeight'];
const GUARDRAIL_RULES: readonly GuardrailRule[] = ['weekly_rate', 'calorie_floor', 'target_floor'];

const STAT_NAMES: Record<string, string> = { currentWeight: 'weight', heightCm: 'height', age: 'age', gender: 'sex' };

const listOf = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Plain `{ message }` 400s from PUT /health-goals, by the prefix the controller writes. */
const FIELD_MESSAGES: Array<[RegExp, HealthGoalsField, string]> = [
  [/^Current weight/, 'currentWeight', 'Enter a weight between 20 and 500 kg.'],
  [/^Target weight/, 'targetWeight', 'Enter a weight between 20 and 500 kg.'],
  [/^Height/, 'heightCm', 'Enter a height between 80 and 260 cm.'],
  [/^Age/, 'age', 'Enter a whole-number age between 13 and 120.'],
  [/^Weekly pace/, 'weeklyGoal', 'Enter a pace between 0 and 2 kg per week.'],
  [/^Sex must/, 'gender', 'Choose an option.'],
  [/^Daily calorie goal/, 'dailyCalorieGoal', 'Enter a daily target up to 10,000 kcal.'],
  [/^Activity level/, 'activityLevel', 'Choose an activity level.'],
  [/^Goal must/, 'goal', 'Choose a goal.'],
];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Shape C: the final-handler envelope `{ error: { code, message, requestId } }`, only where no route answered. */
export function envelopeMessage(data: unknown, fallback: string): { message: string; code?: string } | null {
  const d = asRecord(data);
  const error = d ? asRecord(d.error) : null;
  if (!error) return null;
  const code = typeof error.code === 'string' ? error.code : undefined;
  if (code === 'BAD_REQUEST') return { message: 'That request could not be read. Try again.', code };
  if (code === 'PAYLOAD_TOO_LARGE') return { message: 'That is too much to send at once.', code };
  return { message: fallback, code };
}

/** 426 from the client-policy middleware and 429 from a write limiter; neither reaches these routes today. */
export function policyMessage(data: unknown): { message: string; code: string } | null {
  const d = asRecord(data);
  if (!d) return null;
  if (d.code === CLIENT_UPDATE_REQUIRED) return { message: 'Reload the page to get the latest version of Vybe.', code: CLIENT_UPDATE_REQUIRED };
  if (d.code === RATE_LIMITED) {
    const wait = typeof d.retryAfterSec === 'number' && d.retryAfterSec > 0 ? ` Try again in ${Math.ceil(d.retryAfterSec)} seconds.` : ' Try again in a moment.';
    return { message: `Too many changes at once.${wait}`, code: RATE_LIMITED };
  }
  return null;
}

/**
 * Turn the `response.data` of a failed health-goals call into something the
 * form can place: a guardrail refusal (shape A), a field message (plain
 * `{ message }` 400s), or a form-level sentence. Never the raw server string.
 */
export function mapHealthGoalsError(data: unknown, fallback: string): HealthGoalsApiError {
  const d = asRecord(data);
  if (!d) return { kind: 'form', message: fallback };

  if (
    d.code === HEALTH_GOAL_GUARDRAIL &&
    GUARDRAIL_FIELDS.includes(d.field as GuardrailField) &&
    GUARDRAIL_RULES.includes(d.rule as GuardrailRule) &&
    finite(d.limit) &&
    typeof d.message === 'string'
  ) {
    return {
      kind: 'guardrail',
      refusal: { code: HEALTH_GOAL_GUARDRAIL, field: d.field as GuardrailField, rule: d.rule as GuardrailRule, limit: d.limit, message: d.message },
    };
  }

  const policy = policyMessage(d);
  if (policy) return { kind: 'form', ...policy };

  const envelope = envelopeMessage(d, fallback);
  if (envelope) return { kind: 'form', ...envelope };

  const message = typeof d.message === 'string' ? d.message : '';
  for (const [pattern, field, copy] of FIELD_MESSAGES) {
    if (pattern.test(message)) return { kind: 'field', field, message: copy };
  }
  if (/^Missing required fields/.test(message)) {
    return { kind: 'form', message: 'Enter your weight, height, age and sex to save.' };
  }
  const incomplete = /^Health goals are incomplete\. Set (.+) first\./.exec(message);
  if (incomplete) {
    const names = incomplete[1].split(',').map((s) => s.trim()).filter(Boolean).map((key) => STAT_NAMES[key] ?? key);
    return { kind: 'form', message: `Your saved goals are missing ${listOf(names)}. Save your stats once and recalculate.` };
  }
  if (/^Health goals not set/.test(message)) {
    return { kind: 'form', message: 'Save your stats first, then recalculate.' };
  }
  if (/has an invalid value$/.test(message)) {
    return { kind: 'form', message: 'One of the values could not be saved. Check the fields and try again.' };
  }
  return { kind: 'form', message: fallback };
}
