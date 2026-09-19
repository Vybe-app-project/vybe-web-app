/**
 * Wave C1 health-and-challenges: the two pages adopt the API's guardrails
 * through src/lib/healthGoalRules.ts and src/lib/challengeRules.ts, sex is
 * never assumed, weight-scored challenge types are not offered, legacy
 * weight-scored documents render as "no longer scored", and no raw server
 * string reaches the screen. Existing pins in tests/meals-nutrition.test.mjs
 * and tests/source-contract.test.mjs must stay green alongside.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const goals = read('src/pages/HealthGoals.tsx');
const challenges = read('src/pages/Challenges.tsx');
const healthRules = read('src/lib/healthGoalRules.ts');
const challengeRules = read('src/lib/challengeRules.ts');

test('HealthGoals.tsx runs the mirrored guardrails and places refusals on the field', () => {
  assert.match(goals, /import \{[^}]*checkHealthGoalsPayload[^}]*\} from '\.\.\/lib\/healthGoalRules'/s);
  assert.match(goals, /import \{[^}]*mapHealthGoalsError[^}]*\} from '\.\.\/lib\/healthGoalRules'/s);
  assert.match(goals, /import \{[^}]*guardrailMessageFor[^}]*\} from '\.\.\/lib\/healthGoalRules'/s);
  // The pre-check runs on the built payload and the same object is what is PUT.
  assert.match(goals, /const payload = buildPayload\(form, system\);\s*const refusal = checkHealthGoalsPayload\(payload\);/);
  assert.match(goals, /save\.mutate\(payload\)/);
  assert.match(goals, /api\.put<\{ data: HealthGoals \}>\('\/health-goals', payload\)/);
  // The pinned payload lines from tests/meals-nutrition.test.mjs live on inside buildPayload.
  assert.match(goals, /currentWeight: parseWeight\(Number\(form\.currentWeight\), system\)/);
  assert.match(goals, /heightCm: Math\.round\(heightCmOf\(form, system\) \* 10\) \/ 10/);
  assert.match(goals, /useUnits\(\(s\) => s\.system\)/);
  // Both mutations route their errors through the mapper; no toast-only errMsg is left.
  assert.doesNotMatch(goals, /errMsg\(/);
  assert.equal((goals.match(/mapHealthGoalsError\(responseData\(e\)/g) ?? []).length, 2);
  // Server-side field errors merge into the inputs and are cleared on edit and on success.
  assert.match(goals, /const \[serverErrors, setServerErrors\] = useState<ServerErrors>\(\{\}\)/);
  assert.match(goals, /const fieldError = \(k: keyof typeof errors\) => errors\[k\] \?\? serverErrors\[k\]/);
  assert.match(goals, /setServerErrors\(\(e\) => \(e\[key\] \|\| e\.form \? \{ \.\.\.e, \[key\]: undefined, form: undefined \} : e\)\)/);
  assert.match(goals, /role="alert"[^>]*>\s*\{formAlert\}/);
});

test('HealthGoals.tsx offers "Prefer not to say" and never seeds a sex', () => {
  assert.match(goals, /'male' \| 'female' \| 'other' \| 'unspecified'/);
  assert.match(goals, /value: 'unspecified', label: 'Prefer not to say'/);
  assert.doesNotMatch(goals, /gender: g\?\.gender \?\? 'male'/);
  assert.match(goals, /gender: g\?\.gender \?\? ''/);
  assert.match(goals, /gender: attempted && !form\.gender \? 'Choose an option\.' : undefined/);
  assert.match(goals, /value=\{form\.gender \|\| null\}/);
  assert.match(goals, /placeholder="Select…"/);
  assert.match(goals, /Prefer not to say uses the average of the two estimates\./);
});

test('HealthGoals.tsx has stable ids for focus and a pace hint that states the cap', () => {
  for (const id of ['hg-current-weight', 'hg-target-weight', 'hg-height-cm', 'hg-height-ft', 'hg-age', 'hg-gender', 'hg-activity', 'hg-goal', 'hg-weekly-pace']) {
    assert.match(goals, new RegExp(`'${id}'`), id);
  }
  assert.match(goals, /id=\{FIELD_IDS\.weeklyGoal\}/);
  assert.match(goals, /id=\{FIELD_IDS\.gender\}/);
  assert.match(goals, /Up to \$\{capShown\} \$\{wUnit\} a week at your weight\./);
  // The server caps the pace at maintain too, so the old claim is gone.
  assert.doesNotMatch(goals, /Not used while your goal is to maintain/);
  assert.match(goals, /label="Height, feet"/);
  assert.match(goals, /<UnitsControl size="sm" \/>/);
});

test('Challenges.tsx offers no weight-scored type or unit and judges dates on the exact instants', () => {
  assert.match(challenges, /import \{[^}]*isWeightScored[^}]*\} from '\.\.\/lib\/challengeRules'/s);
  assert.match(challenges, /import \{[^}]*checkEndDate[^}]*\} from '\.\.\/lib\/challengeRules'/s);
  assert.match(challenges, /import \{[^}]*checkCreateWindow[^}]*\} from '\.\.\/lib\/challengeRules'/s);
  assert.match(challenges, /import \{[^}]*mapChallengeError[^}]*\} from '\.\.\/lib\/challengeRules'/s);
  assert.match(challenges, /const CREATABLE_TYPES: ChallengeType\[\] = CHALLENGE_TYPES\.filter\(\(t\) => !isWeightScored\(\{ type: t \}\)\)/);
  assert.match(challenges, /const CREATABLE_UNITS: GoalUnit\[\] = GOAL_UNITS\.filter\(\(u\) => !isWeightScored\(\{ goalUnit: u \}\)\)/);
  assert.match(challenges, /\.\.\.CREATABLE_TYPES\.map\(\(t\) => \(\{ value: t, label: humanize\(t\) \}\)\)/);
  assert.doesNotMatch(challenges, /\.\.\.CHALLENGE_TYPES\.map\(/);
  assert.match(challenges, /TRACKED_GOAL_UNITS\[type\] \?\? CREATABLE_UNITS/);
  // The unions keep the legacy values so old documents still render as what they are.
  assert.match(challenges, /\| 'weight_loss'/);
  assert.match(challenges, /\| 'pounds'/);
  // Create: start of day and end of day, judged by the shared rule plus the create window.
  assert.match(challenges, /checkEndDate\(\{ startDate: start, endDate: form\.endDate \? end : '' \}\)/);
  assert.match(challenges, /checkCreateWindow\(\{ startDate: start, endDate: end \}\)/);
  assert.match(challenges, /checkChallengeType\(\{ type: form\.type, goalUnit: form\.goalUnit \}\)/);
  assert.match(challenges, /hint="Up to a year long\."/);
  assert.match(challenges, /max=\{maxEndInput\(form\.startDate\)\}/);
  // Edit: measured from the stored start, with the two patch-only rules.
  assert.match(challenges, /checkEndDate\(\{ startDate: isValid\(start\) \? start : null, endDate: end \}\)/);
  assert.match(challenges, /id="ch-edit-ends"/);
  assert.match(challenges, /error=\{fieldError\.endDate\}/);
  for (const id of ['ch-title', 'ch-description', 'ch-type', 'ch-cadence', 'ch-goal-unit', 'ch-goal', 'ch-max', 'ch-starts', 'ch-ends']) {
    assert.match(challenges, new RegExp(`'${id}'`), id);
  }
  assert.match(challenges, /error=\{fieldError\.type\}/);
  assert.match(challenges, /error=\{fieldError\.goalUnit\}/);
});

test('Challenges.tsx shows a legacy weight-scored challenge as no longer scored and tolerates its blank board', () => {
  assert.match(challenges, /const legacy = !!challenge && isWeightScored\(challenge\)/);
  assert.match(challenges, /title="This challenge is no longer scored"/);
  assert.match(challenges, /enabled: !!challengeId && !legacy/);
  assert.match(challenges, /\{joined && !legacy \? \(/);
  assert.match(challenges, /\) : legacy \? \(\s*<p className="text-sm text-text-3">No longer open to join\.<\/p>/);
  assert.match(challenges, /progress\?: number;/);
  assert.match(challenges, /pctOf\(entry\.progress \?\? 0, challenge\.goal\)/);
  assert.match(challenges, /formatStat\(entry\.progress \?\? 0\)/);
  assert.match(challenges, /totalProgress\?: number;\s*averageProgress\?: number;\s*completionRate\?: number;/);
  // Every mutation toast goes through the mapper; a type refusal refreshes the view.
  assert.doesNotMatch(challenges, /errMsg\(/);
  assert.equal((challenges.match(/onChallengeError\(e, '/g) ?? []).length, 4);
  assert.match(challenges, /if \(m\.code === CHALLENGE_TYPE_UNAVAILABLE\) invalidate\(\)/);
  // The deep link the search results use is untouched.
  assert.match(challenges, /useState<string \| null>\(\(\) => searchParams\.get\('open'\)\)/);
  // aria-labels the live suites depend on are still there.
  for (const label of ['Filter by type', 'Filter by cadence', 'Filter my challenges', 'Challenge lists', 'Challenge sections']) {
    assert.match(challenges, new RegExp(`aria-label="${label}"`), label);
  }
});

test('no raw server string is shown on either page, and the copy avoids the register the API forbids', () => {
  for (const raw of ['endDate must be', 'is not supported', 'must be a finite number', 'can only be extended.']) {
    assert.doesNotMatch(goals, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), raw);
    assert.doesNotMatch(challenges, new RegExp(`(hint|title|message)="[^"]*${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), raw);
  }
  // Strings the pages present as their own copy (attribute values and JSX text) never carry the forbidden words.
  const FORBIDDEN = /oops|invalid|unhealthy|dangerous|medical|doctor|\bfat\b|skinny|\bthin\b/i;
  for (const [name, source] of [['healthGoalRules', healthRules], ['challengeRules', challengeRules]]) {
    const literals = source.match(/'[^'\n]*'|`[^`]*`/g) ?? [];
    for (const literal of literals) {
      if (/^'[a-z_A-Z.:\-]+'$/.test(literal) || /^'\^/.test(literal)) continue; // identifiers, codes and regex sources
      if (literal === "'endDate must be a valid date'" || literal === "'Pick a valid end date.'") continue; // the API's own wording, not "invalid"
      assert.doesNotMatch(literal, FORBIDDEN, `${name}: ${literal}`);
    }
  }
});

test('the rules modules keep the seams the brief names', () => {
  assert.match(healthRules, /export const HEALTH_GUARDRAIL_DEFAULTS: HealthGuardrailThresholds = \{\s*minCalories: 1200,\s*maxWeeklyRatePct: 1,\s*minTargetBmi: 0,\s*\}/);
  assert.match(healthRules, /^import \{ kgToLb \} from '\.\/unitConversions';$/m);
  assert.equal((healthRules.match(/^import /gm) ?? []).length, 1);
  assert.match(challengeRules, /export const CHALLENGE_MAX_DAYS_DEFAULT = 365;/);
  assert.doesNotMatch(challengeRules, /^import /m);
  // Neither page touches the shared hot-spot helpers this area must leave alone.
  assert.doesNotMatch(goals, /fieldErrorsOf|from '\.\.\/lib\/capabilities'/);
  assert.doesNotMatch(challenges, /fieldErrorsOf|from '\.\.\/lib\/capabilities'/);
});
