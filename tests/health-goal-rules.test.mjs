/**
 * src/lib/healthGoalRules.ts mirrors the API's health-goal guardrails
 * (services/healthGoalGuardrails.js + utils/calorieCalculator.js at 4e22914).
 * The rows below are the server's own table from
 * tests/v2-be-guardrails.health-goals.test.js so the two sides agree on
 * every number and every word.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const rules = await import('../src/lib/healthGoalRules.ts');
const T = rules.HEALTH_GUARDRAIL_DEFAULTS;
const FORBIDDEN = /oops|invalid|unhealthy|dangerous|medical|doctor|fat|skinny|thin/i;

test('defaults are the documented ones: 1200 kcal, 1 % a week, no target-weight floor', () => {
  assert.deepEqual(T, { minCalories: 1200, maxWeeklyRatePct: 1, minTargetBmi: 0 });
  assert.deepEqual(rules.HEALTH_GENDERS, ['male', 'female', 'other', 'unspecified']);
});

test('estimateBmr matches the server table (Mifflin-St Jeor, mean for other/unspecified/missing)', () => {
  const rows = [
    [80, 180, 30, 'male', 1780],
    [80, 180, 30, 'female', 1614],
    [80, 180, 30, 'other', 1697],
    [80, 180, 30, 'unspecified', 1697],
    [80, 180, 30, undefined, 1697],
    [55, 160, 30, 'female', 1239],
    [55, 160, 30, 'unspecified', 1322],
  ];
  for (const [currentWeight, heightCm, age, gender, expected] of rows) {
    assert.equal(rules.estimateBmr({ currentWeight, heightCm, age, gender }), expected, `${currentWeight}/${heightCm}/${age}/${gender}`);
  }
  assert.equal(rules.estimateBmr({ currentWeight: 80, heightCm: 180 }), null);
  assert.equal(rules.estimateBmr({}), null);
  assert.equal(rules.estimateBmr(), null);
  const stats = { currentWeight: 70, heightCm: 170, age: 40 };
  const male = rules.estimateBmr({ ...stats, gender: 'male' });
  const female = rules.estimateBmr({ ...stats, gender: 'female' });
  assert.equal(rules.estimateBmr({ ...stats, gender: 'unspecified' }), Math.round((male + female) / 2));
});

test('TDEE and the daily target follow utils/calorieCalculator.js', () => {
  assert.equal(rules.estimateTdee(1780, 'moderately_active'), 2759);
  assert.equal(rules.estimateTdee(1780, undefined), 2759);
  assert.equal(rules.estimateTdee(1780, 'nonsense'), 2759);
  assert.equal(rules.estimateTdee(1239, 'sedentary'), 1487);
  assert.equal(rules.estimateDailyCalorieGoal(2759, 'lose_weight', 0.5), 2209);
  assert.equal(rules.estimateDailyCalorieGoal(2759, 'maintain_weight', 1), 2759);
  assert.equal(rules.estimateDailyCalorieGoal(2759), 2759);
  // Losing clamps at 1200 and the deficit at 1000 a day.
  assert.equal(rules.estimateDailyCalorieGoal(1487, 'lose_weight', 0.5), 1200);
  assert.equal(rules.estimateDailyCalorieGoal(3000, 'lose_weight', 2), 2000);
  // Gaining caps the surplus at 500 a day.
  assert.equal(rules.estimateDailyCalorieGoal(2759, 'gain_weight', 0.25), 3034);
  assert.equal(rules.estimateDailyCalorieGoal(2759, 'gain_muscle', 2), 3259);
});

test('calorieFloor, weeklyRateCap and targetWeightFloor', () => {
  assert.equal(rules.calorieFloor({ currentWeight: 80, heightCm: 180, age: 30, gender: 'male' }, T), 1780);
  assert.equal(rules.calorieFloor({ currentWeight: 50, heightCm: 155, age: 40, gender: 'female' }, T), 1200);
  assert.equal(rules.calorieFloor({}, T), 1200);
  assert.equal(rules.weeklyRateCap(80, T), 0.8);
  assert.equal(rules.weeklyRateCap(80), 0.8);
  assert.equal(rules.weeklyRateCap(80, { ...T, maxWeeklyRatePct: 2 }), 1.6);
  assert.equal(rules.weeklyRateCap(undefined, T), null);
  assert.equal(rules.targetWeightFloor(180, { ...T, minTargetBmi: 18.5 }), 59.94);
  assert.equal(rules.targetWeightFloor(180, T), null);
  assert.equal(rules.targetWeightFloor(180), null);
  assert.equal(rules.targetWeightFloor(undefined, { ...T, minTargetBmi: 18.5 }), null);
});

const base = { currentWeight: 80, heightCm: 180, age: 30, gender: 'male' };

test('checkHealthGoals: the server table, same order, same fields, same limits', () => {
  const rows = [
    ['clean payload', { ...base, weeklyGoal: 0.5, computedDailyCalorieGoal: 2200 }, null],
    ['pace above 1 % of body weight', { ...base, weeklyGoal: 0.81, computedDailyCalorieGoal: 2200 }, { field: 'weeklyGoal', rule: 'weekly_rate', limit: 0.8 }],
    ['pace exactly at the cap passes', { ...base, weeklyGoal: 0.8, computedDailyCalorieGoal: 2200 }, null],
    ['explicit target under the BMR', { ...base, weeklyGoal: 0, dailyCalorieGoal: 1700, computedDailyCalorieGoal: 2200 }, { field: 'dailyCalorieGoal', rule: 'calorie_floor', limit: 1780 }],
    ['explicit target under 1200 when BMR is lower', { currentWeight: 50, heightCm: 155, age: 40, gender: 'female', weeklyGoal: 0, dailyCalorieGoal: 1150, computedDailyCalorieGoal: 1500 }, { field: 'dailyCalorieGoal', rule: 'calorie_floor', limit: 1200 }],
    ['computed target under the BMR names the pace', { currentWeight: 55, heightCm: 160, age: 30, gender: 'female', weeklyGoal: 0.5, computedDailyCalorieGoal: 1200 }, { field: 'weeklyGoal', rule: 'calorie_floor', limit: 1239 }],
    ['computed target under the mean BMR for unspecified', { currentWeight: 55, heightCm: 160, age: 30, gender: 'unspecified', weeklyGoal: 0.5, computedDailyCalorieGoal: 1200 }, { field: 'weeklyGoal', rule: 'calorie_floor', limit: 1322 }],
    ['target weight under the height floor passes while the floor is off', { ...base, weeklyGoal: 0, targetWeight: 55, computedDailyCalorieGoal: 2200 }, null],
    ['target weight under the height floor with the floor on', { ...base, weeklyGoal: 0, targetWeight: 55, computedDailyCalorieGoal: 2200 }, { field: 'targetWeight', rule: 'target_floor', limit: 59.94 }, { minTargetBmi: 18.5 }],
    ['target weight at the floor passes with the floor on', { ...base, weeklyGoal: 0, targetWeight: 59.94, computedDailyCalorieGoal: 2200 }, null, { minTargetBmi: 18.5 }],
  ];
  for (const [label, input, expected, override = {}] of rows) {
    const result = rules.checkHealthGoals(input, { ...T, ...override });
    if (expected === null) {
      assert.equal(result, null, label);
      continue;
    }
    assert.equal(result.code, 'HEALTH_GOAL_GUARDRAIL', label);
    assert.equal(result.field, expected.field, label);
    assert.equal(result.rule, expected.rule, label);
    assert.equal(result.limit, expected.limit, label);
    assert.equal(typeof result.message, 'string', label);
    assert.doesNotMatch(result.message, FORBIDDEN, label);
  }
  // Thresholds passed in are honoured.
  assert.equal(rules.checkHealthGoals({ ...base, weeklyGoal: 1.5, computedDailyCalorieGoal: 2200 }, { ...T, maxWeeklyRatePct: 2 }), null);
  assert.equal(rules.checkHealthGoals({ ...base, weeklyGoal: 0, dailyCalorieGoal: 1900, computedDailyCalorieGoal: 2200 }, { ...T, minCalories: 2000 }).limit, 2000);
  assert.equal(rules.checkHealthGoals({ ...base, weeklyGoal: 0, targetWeight: 40, computedDailyCalorieGoal: 2200 }, { ...T, minTargetBmi: 20 }).limit, 64.8);
});

test('checkHealthGoalsPayload derives the computed target the way the server does', () => {
  // 80 kg / 180 cm / 30 y male, moderately active, maintain: 2759 ≥ 1780.
  assert.equal(rules.checkHealthGoalsPayload({ ...base, activityLevel: 'moderately_active', goal: 'maintain_weight', weeklyGoal: 0.5 }), null);
  assert.deepEqual(
    rules.checkHealthGoalsPayload({ ...base, goal: 'lose_weight', weeklyGoal: 1 }),
    { code: 'HEALTH_GOAL_GUARDRAIL', field: 'weeklyGoal', rule: 'weekly_rate', limit: 0.8, message: 'That pace is faster than Vybe plans for. Pick a pace up to 0.8 kg a week.' },
  );
  assert.equal(rules.checkHealthGoalsPayload({ ...base, goal: 'lose_weight', weeklyGoal: 0.8 }), null);
  // 55 kg / 160 cm / 30 y female, sedentary, lose 0.5: tdee 1487 − 550 → clamp 1200 < BMR 1239.
  const small = rules.checkHealthGoalsPayload({ currentWeight: 55, heightCm: 160, age: 30, gender: 'female', activityLevel: 'sedentary', goal: 'lose_weight', weeklyGoal: 0.5 });
  assert.deepEqual(
    small,
    { code: 'HEALTH_GOAL_GUARDRAIL', field: 'weeklyGoal', rule: 'calorie_floor', limit: 1239, message: 'That pace puts your daily target under 1,239 kcal, which is lower than Vybe plans for. Pick a slower pace.' },
  );
  assert.equal(
    rules.checkHealthGoalsPayload({ currentWeight: 55, heightCm: 160, age: 30, gender: 'unspecified', activityLevel: 'sedentary', goal: 'lose_weight', weeklyGoal: 0.5 }).limit,
    1322,
  );
  // An explicit override is judged instead of the computed target.
  assert.deepEqual(
    rules.checkHealthGoalsPayload({ ...base, weeklyGoal: 0, dailyCalorieGoal: 1700 }),
    { code: 'HEALTH_GOAL_GUARDRAIL', field: 'dailyCalorieGoal', rule: 'calorie_floor', limit: 1780, message: 'That daily target is lower than Vybe plans for. Pick a target of at least 1,780 kcal.' },
  );
  assert.equal(rules.checkHealthGoalsPayload({ ...base, weeklyGoal: 0, dailyCalorieGoal: 1780 }), null);
  // Target floor: off by default, on when the threshold says so.
  assert.equal(rules.checkHealthGoalsPayload({ ...base, weeklyGoal: 0, targetWeight: 55 }), null);
  assert.equal(rules.checkHealthGoalsPayload({ ...base, weeklyGoal: 0, targetWeight: 55 }, { ...T, minTargetBmi: 18.5 }).limit, 59.94);
  assert.equal(rules.checkHealthGoalsPayload({ ...base, weeklyGoal: 0, targetWeight: 59.94 }, { ...T, minTargetBmi: 18.5 }), null);
  // The imperial trap: 1.8 lb typed is 0.82 kg after lbToKg, over a 0.8 kg cap.
  assert.equal(rules.checkHealthGoalsPayload({ ...base, goal: 'lose_weight', weeklyGoal: 0.82 }).rule, 'weekly_rate');
});

test('copy is the server copy verbatim in metric and re-rendered in lb for the pace cap', () => {
  const pace = rules.checkHealthGoalsPayload({ ...base, goal: 'lose_weight', weeklyGoal: 1 });
  assert.equal(rules.guardrailMessageFor(pace, 'metric'), pace.message);
  assert.match(rules.guardrailMessageFor(pace, 'imperial'), /1\.8 lb a week/);
  assert.doesNotMatch(rules.guardrailMessageFor(pace, 'imperial'), /kg/);
  const floor = rules.checkHealthGoalsPayload({ currentWeight: 55, heightCm: 160, age: 30, gender: 'female', activityLevel: 'sedentary', goal: 'lose_weight', weeklyGoal: 0.5 });
  assert.equal(rules.guardrailMessageFor(floor, 'imperial'), floor.message);
  const target = rules.checkHealthGoalsPayload({ ...base, weeklyGoal: 0, targetWeight: 55 }, { ...T, minTargetBmi: 18.5 });
  assert.equal(rules.guardrailMessageFor(target, 'imperial'), target.message);
  for (const r of [pace, floor, target]) {
    assert.doesNotMatch(rules.guardrailMessageFor(r, 'metric'), FORBIDDEN);
    assert.doesNotMatch(rules.guardrailMessageFor(r, 'imperial'), FORBIDDEN);
  }
  assert.equal(rules.formatKcal(1239), '1,239 kcal');
});

test('guardrailFormNote only speaks when the maintenance estimate itself is under the floor', () => {
  // Tiny stats at maintain: BMR well under 1200, tdee under 1200, pace 0.
  const tiny = { currentWeight: 30, heightCm: 120, age: 60, gender: 'female', activityLevel: 'sedentary', goal: 'maintain_weight', weeklyGoal: 0 };
  const r = rules.checkHealthGoalsPayload(tiny);
  assert.equal(r.field, 'weeklyGoal');
  assert.equal(r.rule, 'calorie_floor');
  assert.equal(r.limit, 1200);
  const note = rules.guardrailFormNote(r, tiny);
  assert.match(note, /^Your estimated maintenance is under 1,200 kcal/);
  assert.doesNotMatch(note, FORBIDDEN);
  // A pace that can be slowed gets no second sentence.
  const slowable = { currentWeight: 55, heightCm: 160, age: 30, gender: 'female', activityLevel: 'sedentary', goal: 'lose_weight', weeklyGoal: 0.5 };
  assert.equal(rules.guardrailFormNote(rules.checkHealthGoalsPayload(slowable), slowable), undefined);
  const pace = rules.checkHealthGoalsPayload({ ...base, goal: 'lose_weight', weeklyGoal: 1 });
  assert.equal(rules.guardrailFormNote(pace, { ...base, weeklyGoal: 1 }), undefined);
});

test('mapHealthGoalsError reads shape A, plain { message }, the envelope, 426 and 429', () => {
  const guardrail = rules.mapHealthGoalsError(
    { code: 'HEALTH_GOAL_GUARDRAIL', field: 'weeklyGoal', rule: 'weekly_rate', limit: 0.8, message: 'That pace is faster than Vybe plans for. Pick a pace up to 0.8 kg a week.' },
    'Could not save goals',
  );
  assert.equal(guardrail.kind, 'guardrail');
  assert.equal(guardrail.refusal.field, 'weeklyGoal');
  assert.equal(guardrail.refusal.limit, 0.8);

  const sex = rules.mapHealthGoalsError({ message: 'Sex must be male, female or other, or unspecified' }, 'x');
  assert.deepEqual(sex, { kind: 'field', field: 'gender', message: 'Choose an option.' });
  assert.equal(rules.mapHealthGoalsError({ message: 'Current weight must be between 20 and 500 kg' }, 'x').field, 'currentWeight');
  assert.equal(rules.mapHealthGoalsError({ message: 'Target weight must be between 20 and 500 kg' }, 'x').field, 'targetWeight');
  assert.equal(rules.mapHealthGoalsError({ message: 'Height must be between 80 and 260 cm' }, 'x').field, 'heightCm');
  assert.equal(rules.mapHealthGoalsError({ message: 'Age must be a whole number of years' }, 'x').field, 'age');
  assert.equal(rules.mapHealthGoalsError({ message: 'Weekly pace must be between 0 and 2 kg per week' }, 'x').field, 'weeklyGoal');
  assert.equal(rules.mapHealthGoalsError({ message: 'Daily calorie goal must be a number up to 10000 kcal' }, 'x').field, 'dailyCalorieGoal');
  assert.equal(rules.mapHealthGoalsError({ message: 'Activity level must be one of sedentary, lightly_active' }, 'x').field, 'activityLevel');
  assert.equal(rules.mapHealthGoalsError({ message: 'Goal must be one of lose_weight, maintain_weight' }, 'x').field, 'goal');

  const missing = rules.mapHealthGoalsError({ message: 'Missing required fields: currentWeight, heightCm, age, gender' }, 'x');
  assert.equal(missing.kind, 'form');
  assert.match(missing.message, /weight, height, age and sex/);

  const incomplete = rules.mapHealthGoalsError({ message: 'Health goals are incomplete. Set age, gender first.' }, 'x');
  assert.equal(incomplete.kind, 'form');
  assert.match(incomplete.message, /age and sex/);
  assert.doesNotMatch(incomplete.message, /gender|currentWeight|heightCm/);
  assert.match(rules.mapHealthGoalsError({ message: 'Health goals are incomplete. Set gender first.' }, 'x').message, /missing sex\./);
  assert.match(rules.mapHealthGoalsError({ message: 'Health goals not set. Please update your health goals first.' }, 'x').message, /Save your stats first/);
  assert.equal(rules.mapHealthGoalsError({ message: 'healthGoals.age has an invalid value' }, 'x').kind, 'form');
  assert.doesNotMatch(rules.mapHealthGoalsError({ message: 'healthGoals.age has an invalid value' }, 'x').message, /invalid value/);

  const envelope = rules.mapHealthGoalsError({ error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: 'r1' } }, 'Could not save goals');
  assert.deepEqual(envelope, { kind: 'form', message: 'Could not save goals', code: 'INTERNAL_ERROR' });
  assert.match(rules.mapHealthGoalsError({ error: { code: 'BAD_REQUEST', message: 'bad json' } }, 'x').message, /could not be read/);
  assert.match(rules.mapHealthGoalsError({ error: { code: 'PAYLOAD_TOO_LARGE', message: '' } }, 'x').message, /too much to send/);

  const update = rules.mapHealthGoalsError({ success: false, code: 'CLIENT_UPDATE_REQUIRED', message: 'Update required', platform: 'web', minVersion: '1', latestVersion: '2', storeUrl: null }, 'x');
  assert.equal(update.kind, 'form');
  assert.match(update.message, /^Reload/);
  const limited = rules.mapHealthGoalsError({ code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSec: 12 }, 'x');
  assert.match(limited.message, /12 seconds/);

  assert.deepEqual(rules.mapHealthGoalsError(undefined, 'Could not save goals'), { kind: 'form', message: 'Could not save goals' });
  assert.deepEqual(rules.mapHealthGoalsError('<html>', 'x'), { kind: 'form', message: 'x' });
  assert.deepEqual(rules.mapHealthGoalsError({ message: 'Failed to update health goals' }, 'x'), { kind: 'form', message: 'x' });
  // Nothing the mapper says uses the register the server forbids.
  for (const m of [sex, missing, incomplete, envelope, update, limited]) assert.doesNotMatch(m.message, FORBIDDEN);
});
