/**
 * The seven-day week view on /meals.
 *
 * `GET /api/meals/by-range?range=week` answers the Monday–Sunday local week
 * as one flat `meals` array plus a whole-week `summary`; there are no per-day
 * rows and no averages block on the wire (controllers/mealController.js
 * getMealsByDateRange). This module is the missing half: it lays the meals
 * out on the seven local days, so a day with nothing logged still has a row
 * and can say so.
 *
 * The zero rule (docs/DESIGN.md) decides the shape of the output: a day with
 * no meals is `logged: false` and the view prints "Nothing logged", never
 * "0 kcal"; the averages are taken over the days that were actually logged,
 * so three logged days out of seven average over three, and a week with
 * nothing logged has no average at all rather than an average of zero.
 *
 * Import-free on purpose: tests/meals-barcode.test.mjs transpiles this file
 * and imports the result directly.
 */

export type WeekNutrition = { calories?: number; protein?: number; carbs?: number; fat?: number };
export type WeekMealLike = { timestamp?: string; nutrition?: WeekNutrition | null };

export type WeekDayRow = {
  /** Local calendar day, `YYYY-MM-DD`. */
  dateKey: string;
  /** 0 = Monday … 6 = Sunday. */
  index: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  count: number;
  /** At least one meal on this day. Everything below is only worth printing when true. */
  logged: boolean;
  isToday: boolean;
  /** Later this week: the row is a placeholder, not a missed day. */
  isFuture: boolean;
};

export type WeekAverages = {
  /** How many days the average is over — the logged ones, never seven. */
  days: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

/** What a day with no meals reads, on every surface. */
export const NOTHING_LOGGED = 'Nothing logged';
export const WEEK_AVERAGE_LABEL = 'Daily average';
/** The heading above the seven rows; the segment beside it is already "This week". */
export const WEEK_ROWS_LABEL = 'Your week';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of a Date as `YYYY-MM-DD` (never UTC: the API's day is local too). */
export const dayKeyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday 00:00 local of the week containing `now`; the same week the API returns. */
export function weekStart(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay(): 0 = Sunday. Monday-start means Sunday belongs to the week before.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d;
}

/** The seven local day keys of that week, Monday first. */
export function weekDayKeys(now: Date = new Date()): string[] {
  const start = weekStart(now);
  return Array.from({ length: 7 }, (_, i) => dayKeyOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

const round = (v: number) => Math.round(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The week's meals as seven rows. A meal with no parsable timestamp, or one
 * outside the week (an API that widened the range), is left out rather than
 * folded into a day it did not happen on.
 */
export function weekRows(meals: readonly WeekMealLike[] | null | undefined, now: Date = new Date()): WeekDayRow[] {
  const keys = weekDayKeys(now);
  const todayKey = dayKeyOf(now);
  const rows: WeekDayRow[] = keys.map((dateKey, index) => ({
    dateKey,
    index,
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    count: 0,
    logged: false,
    isToday: dateKey === todayKey,
    isFuture: dateKey > todayKey,
  }));
  const byKey = new Map(rows.map((r) => [r.dateKey, r]));
  for (const meal of meals ?? []) {
    if (!meal || typeof meal.timestamp !== 'string') continue;
    const at = new Date(meal.timestamp);
    if (Number.isNaN(at.getTime())) continue;
    const row = byKey.get(dayKeyOf(at));
    if (!row) continue;
    const n = meal.nutrition ?? {};
    row.kcal += num(n.calories);
    row.protein += num(n.protein);
    row.carbs += num(n.carbs);
    row.fat += num(n.fat);
    row.count += 1;
    row.logged = true;
  }
  for (const row of rows) {
    row.kcal = round(row.kcal);
    row.protein = round(row.protein);
    row.carbs = round(row.carbs);
    row.fat = round(row.fat);
  }
  return rows;
}

/**
 * The average over the logged days only. No logged day, no average: the
 * footer is omitted rather than reading "0 kcal a day".
 */
export function weekAverages(rows: readonly WeekDayRow[] | null | undefined): WeekAverages | null {
  const logged = (rows ?? []).filter((r) => r.logged);
  if (logged.length === 0) return null;
  const sum = (pick: (r: WeekDayRow) => number) => logged.reduce((t, r) => t + pick(r), 0);
  return {
    days: logged.length,
    kcal: round(sum((r) => r.kcal) / logged.length),
    protein: round(sum((r) => r.protein) / logged.length),
    carbs: round(sum((r) => r.carbs) / logged.length),
    fat: round(sum((r) => r.fat) / logged.length),
  };
}

/**
 * Calories from macro grams, Atwater 4/4/9 — the same arithmetic
 * `utils/calorieCalculator.js` uses server side. Used to show what a set of
 * grams adds up to while it is being typed.
 */
export function macroCalories(protein: number, carbs: number, fat: number): number {
  return Math.round(num(protein) * 4 + num(carbs) * 4 + num(fat) * 9);
}

/* ------------------------------------------------------- copy · quick add */

/** `POST /meals/copy` bounds (controllers/mealFastLogController.js). */
export const COPY_FROM_MAX_DAYS = 90;
export const COPY_TO_MAX_DAYS = 7;

/** Yesterday's local day key, the only source day "Copy yesterday" offers. */
export function yesterdayKey(now: Date = new Date()): string {
  return dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

export const COPY_YESTERDAY = 'Copy yesterday';
export const COPY_NOTHING = 'Nothing to copy from that day';
export const COPY_ALREADY = 'Already copied to that day';
export const QUICK_ADD = 'Quick add';
export const QUICK_ADD_KCAL_RANGE = 'Between 1 and 5,000 kcal.';
export const QUICK_ADD_MACRO_HINT = 'Optional. Leave a macro blank and it counts as none.';

/** `kcal` is 1–5000 and required; the macros are 0–5000 and optional. */
export function quickAddError(kcal: number): string | null {
  if (!Number.isFinite(kcal) || kcal <= 0) return 'Enter the calories for this meal.';
  if (kcal > 5000) return 'kcal must be a number between 1 and 5000';
  return null;
}
