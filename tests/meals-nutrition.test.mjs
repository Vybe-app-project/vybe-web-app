import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Source contracts for the Fuel pages (Meals, MealDetail, MealTemplates,
 * WeeklyPlans, Water, HealthGoals, Health). Each test pins a fix from the
 * meals-nutrition review so it cannot quietly regress: the exact API calls a
 * page makes, the guards around destructive actions, and the labels the live
 * suites depend on.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const meals = read('src/pages/Meals.tsx');
const detail = read('src/pages/MealDetail.tsx');
const templates = read('src/pages/MealTemplates.tsx');
const plans = read('src/pages/WeeklyPlans.tsx');
const water = read('src/pages/Water.tsx');
const goals = read('src/pages/HealthGoals.tsx');
const health = read('src/pages/Health.tsx');
const shared = read('src/pages/SharedMeal.tsx');
const ui = read('src/components/ui.tsx');
const main = read('src/main.tsx');
const app = read('src/App.tsx');

test('sharing a meal mints the API share token for the owner instead of copying the private /meals/:id URL', () => {
  assert.match(detail, /api\.post<MealShareResponse>\(`\/meals\/\$\{meal\._id\}\/share`/, 'owner share must call POST /meals/:id/share');
  assert.match(detail, /data\.shareUrl \|\| shareUrls\.meal\(data\.shareToken\)/, 'must prefer the API shareUrl and fall back to /meals/shared/<token>');
  assert.match(read('src/lib/share.ts'), /\/meals\/shared\/\$\{encodeURIComponent\(token\)\}/);
  // The menu labels the live suite and users know.
  assert.match(detail, /label: 'Share'/);
  assert.match(detail, /label: 'Copy link'/);
  assert.match(detail, /label: 'Revoke share links'/);
  assert.match(detail, /api\.delete<\{ revokedCount: number \}>\(`\/meals\/\$\{id\}\/share`\)/);
  // Community publish toggle on the detail page and in the card menu.
  assert.match(detail, /<Switch[\s\S]*?label="Share with community"/);
  assert.match(meals, /api\.patch\(`\/meals\/\$\{meal\._id\}\/publication`, \{ isPublic \}\)/);
  assert.match(meals, /'Share with community'/);
  assert.match(meals, /'Remove from community'/);
});

test('the meal day endpoints all carry the device timezone offset', () => {
  for (const endpoint of ['/meals/by-range', '/meals/today', '/meals/streak', '/health-goals/daily-summary']) {
    const call = meals.slice(meals.indexOf(`'${endpoint}'`), meals.indexOf(`'${endpoint}'`) + 160);
    assert.match(call, /localDayParams\(\)/, `${endpoint} must send timezoneOffsetMinutes`);
  }
  assert.match(read('src/lib/timezone.ts'), /export const localDayParams = \(now: Date = new Date\(\)\) => \(\{ timezoneOffsetMinutes: timezoneOffsetMinutes\(now\) \}\)/);
  // "This week" describes the Monday-start range the API returns.
  assert.match(meals, /Meals you logged since Monday show up here, grouped by day\./);
  assert.doesNotMatch(meals, /over the next seven days/);
});

test('Enter in the food search never submits the meal form and selects the highlighted result', () => {
  const search = meals.slice(meals.indexOf('export function FoodSearch'), meals.indexOf('export function SelectedFoodRow'));
  assert.match(search, /if \(e\.key === 'Enter'\) \{\s*\/\/[^\n]*\n\s*e\.preventDefault\(\);/);
  assert.match(search, /e\.key === 'ArrowDown'/);
  assert.match(search, /e\.key === 'ArrowUp'/);
  assert.match(search, /role="combobox"/);
  assert.match(search, /aria-activedescendant=/);
  assert.match(search, /role="listbox"[^>]*aria-label="Search results"/, 'the results list label stays for the live suite');
  assert.match(search, /<li[^>]*>\s*<button/, 'results stay li > button for the live smoke selector');
  // Picking a food clears the term so the list collapses and the added row is visible.
  assert.match(search, /onAdd\(selected\);\s*setTerm\(''\);/);
  // Load more and hidden provider name.
  assert.match(search, /fetchNextPage\(\)/);
  assert.match(search, /Show more/);
  assert.match(meals, /PROVIDER_LABELS = new Set\(\['USDA FoodData Central', 'Vybe nutrition catalog'\]\)/);
  // Household portions from the API drive the serving picker.
  assert.match(meals, /foodPortions\?: FoodPortion\[\]/);
  assert.match(meals, /export function servingOptionsFor/);
  assert.match(meals, /ratelimit-reset/);
});

test('template and plan-meal editors reuse the food search', () => {
  assert.match(templates, /import \{ FoodSearch,[^\n]*\} from '\.\/Meals'/);
  assert.match(templates, /<FoodSearch onAdd=\{addFromCatalog\}/);
  assert.match(plans, /import \{ FoodSearch,[^\n]*\} from '\.\/Meals'/);
  assert.match(plans, /<FoodSearch onAdd=\{fillFromCatalog\}/);
  assert.match(plans, /servingSize: servingSize\.trim\(\) \|\| undefined/);
});

test('weekly plans can be shared by link and revoked, with confirmation on destructive actions', () => {
  assert.match(plans, /api\.post\(`\/weekly-plans\/\$\{plan\._id\}\/share-token`\)/);
  assert.match(plans, /shareUrls\.plan\(data\.token\)/);
  assert.match(plans, /api\.delete\(`\/weekly-plans\/\$\{plan\._id\}\/share-token`\)/);
  assert.match(plans, /label: 'Copy share link'/);
  assert.match(plans, /label: 'Revoke share links'/);
  assert.match(plans, /title="Revoke every share link\?"/);
  assert.match(plans, /title="Remove this meal from the plan\?"/);
  assert.match(templates, /title="Revoke every share link\?"/);
  assert.match(read('src/lib/share.ts'), /\/meals\/plans\?shared=\$\{encodeURIComponent\(token\)\}/);
});

test('the shared-plan link picks its route from the token shape and names manual meals by food', () => {
  assert.match(plans, /export const sharedPlanKind = \(token: string\): 'token' \| 'id' \| null => \{\s*if \(SHARE_TOKEN\.test\(token\)\) return 'token';\s*if \(OBJECT_ID\.test\(token\)\) return 'id';\s*return null;/);
  assert.match(plans, /kind === 'token'\s*\? await api\.get<WeeklyPlan>\(`\/weekly-plans\/shared\/\$\{key\}`\)\s*: await api\.get<WeeklyPlan>\(`\/weekly-plans\/\$\{key\}`\)/);
  assert.doesNotMatch(plans, /status !== 404\) throw e;/, 'no try-then-fallback second request');
  assert.match(plans, /`\$\{mealTypeLabel\(m\.mealType\)\}: \$\{slotLabel\(m, 2\)\}`/);
  assert.doesNotMatch(plans, /plural\(m\.foods\.length, 'food'\)/);
  assert.match(read('src/lib/share.ts'), /SHARE_TOKEN = \/\^\[a-f0-9\]\{64\}\$\/i/);
  assert.match(read('src/lib/share.ts'), /OBJECT_ID = \/\^\[a-f0-9\]\{24\}\$\/i/);
});

test('"Log today" is idempotent on the client: pending lock, 409 confirm, Logged state with Undo', () => {
  assert.match(plans, /response\?\.status === 409/);
  assert.match(plans, /force: true/);
  assert.match(plans, /confirmLabel="Log again"/);
  assert.match(plans, /disabled=\{todayMeals\.length === 0 \|\| logToday\.isPending\}/);
  assert.match(plans, /label: 'Undo', onClick: \(\) => undoLog\.mutate\(ids\)/);
  assert.match(plans, /Logged · Undo/);
  assert.match(plans, /'\/weekly-plans\/log-today', \{[\s\S]*?\.\.\.localDayParams\(\)/);
  // Target calories is sent as a number the API now stores.
  assert.match(plans, /targetCalories: targetCalories \? Math\.max\(0, Number\(targetCalories\) \|\| 0\) : undefined/);
  assert.match(plans, /kcal a day/);
});

test('hydration goal comes from the API and quick adds can be undone', () => {
  assert.doesNotMatch(water, /DAILY_GOAL_OZ = 64/);
  assert.match(water, /goal\?: WaterGoal/);
  assert.match(water, /api\.put<\{ goal: WaterGoal \}>\('\/water\/goal', \{ oz \}\)/);
  assert.match(water, /Edit goal/);
  assert.match(water, /action: \{ label: 'Undo', onClick: \(\) => removeLog\.mutate\(created\) \}/);
  // The mutation that undo calls is defined before the one that references it.
  assert.ok(water.indexOf('const removeLog = useMutation') < water.indexOf('const logWater = useMutation'));
});

test('one time-of-day format across the Fuel pages', () => {
  assert.doesNotMatch(water, /'HH:mm'/);
  assert.doesNotMatch(shared, /HH:mm/);
  assert.match(water, /timeOfDay\(/);
  assert.match(shared, /dayAndTime\(meal\.timestamp\)/);
  assert.match(meals, /timeOfDay\(meal\.timestamp\)/);
  assert.match(read('src/lib/timezone.ts'), /format\(d, 'p'\)/);
});

test('a units preference drives goals, hydration and health, with the API kept metric', () => {
  assert.match(goals, /useUnits\(\(s\) => s\.system\)/);
  assert.match(goals, /currentWeight: parseWeight\(Number\(form\.currentWeight\), system\)/);
  assert.match(goals, /heightCm: Math\.round\(heightCmOf\(form, system\) \* 10\) \/ 10/);
  assert.match(goals, /<UnitsControl size="sm" \/>/);
  assert.match(goals, /label="Height, feet"/);
  assert.match(water, /useUnits\(\(st\) => st\.system\)/);
  assert.match(health, /displayWeight\(metrics\.weight, system\)/);
  assert.match(read('src/pages/Settings.tsx'), /<UnitsSection \/>/);
  assert.match(read('src/lib/units.ts'), /UNITS_STORAGE_KEY = 'vybe\.units'/);
});

test('the Health page renders the nutrition analytics the API already returns', () => {
  assert.match(health, /topFoods/);
  assert.match(health, /aria-label="Top foods"/);
  assert.match(health, /aria-label="Meals by type"/);
  assert.match(health, /title="Macros per day"/);
  assert.match(health, /<ReferenceLine y=\{calorieGoal\}/);
  assert.match(health, /api\.get<\{ data: HealthGoalsSummary \}>\('\/health-goals'\)/);
});

test('community meals have a web home and the route noun redirects to it', () => {
  assert.match(meals, /\{ key: 'community', label: 'Community'/);
  assert.match(meals, /api\.get<CommunityPage>\('\/meals', \{ params: \{ page: pageParam, limit: 10 \} \}\)/);
  assert.match(app, /path="meals\/community" element=\{<Navigate to="\/meals\?tab=community" replace \/>\}/);
  // Existing Fuel routes are untouched.
  for (const route of ['meals', 'meals/templates', 'meals/plans', 'meals/shared/:token', 'meals/:id', 'health', 'health/goals', 'health/water']) {
    assert.match(app, new RegExp(`path="${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});

test('4xx responses are not retried and the ring omits a percentage without a goal', () => {
  assert.match(main, /if \(typeof s === 'number' && s < 500\) return false;/);
  assert.match(ui, /aria-label=\{label \? \(max > 0 \? `\$\{label\}: \$\{Math\.round\(pct \* 100\)\}%` : label\) : undefined\}/);
  assert.match(detail, /status === 404 \|\| status === 400/);
});

test('the log sheet keeps the labels the live suites use', () => {
  for (const label of ['label="Meal name"', "label = 'Search foods'", 'Log meal', 'aria-label="Foods in this meal"', 'id={formId}', "const formId = 'log-meal-form'"]) {
    assert.ok(meals.includes(label), `Meals.tsx must keep ${label}`);
  }
  for (const label of ['Log now', 'New template', 'label: \'Edit template\'', 'label: \'Copy share link\'']) {
    assert.ok(templates.includes(label), `MealTemplates.tsx must keep ${label}`);
  }
  for (const label of ['Log today', 'New plan', 'Add another', 'label: \'Edit details\'', 'label: \'Delete plan\'']) {
    assert.ok(plans.includes(label), `WeeklyPlans.tsx must keep ${label}`);
  }
  assert.match(shared, /Open in my meals/);
  assert.match(shared, /Shared by/);
});
