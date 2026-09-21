import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

register('./ts-loader.mjs', import.meta.url);

/**
 * P9 meals: the barcode lookup, the seven-day week, copy-yesterday and
 * quick add. The wire shapes here are read off the backend
 * (controllers/foodBarcodeController.js, services/openFoodFacts.js,
 * controllers/mealController.js, controllers/mealFastLogController.js,
 * controllers/mealQuickAddController.js), so the literals in these
 * assertions are the contract.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

async function loadModule(relative) {
  const source = read(relative);
  assert.doesNotMatch(source, /^\s*import\s/m, `${relative} must stay import-free so tests can load it directly`);
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(relative),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`);
}

const barcode = await loadModule('src/lib/foodBarcode.ts');
const week = await loadModule('src/lib/mealsWeek.ts');

const meals = read('src/pages/Meals.tsx');
const scanner = read('src/pages/meals/BarcodeScanner.tsx');

/* ---------------------------------------------------------------- barcode */

test('a barcode is 8, 12, 13 or 14 digits, checked here before a lookup is spent on it', () => {
  assert.equal(barcode.normalizeGtin('5 449000 000996'), '5449000000996');
  assert.equal(barcode.normalizeGtin('012345-678905'), '012345678905');
  assert.equal(barcode.normalizeGtin('12345670'), '12345670');
  assert.equal(barcode.normalizeGtin('01234567890123'), '01234567890123');
  for (const bad of ['', '12345', '123456789', '0123456789012345', 'abcdefgh', '1234567a', null, undefined, {}]) {
    assert.equal(barcode.normalizeGtin(bad), null, `${JSON.stringify(bad)} is not a barcode`);
  }
  assert.equal(barcode.normalizeGtin(5449000000996), '5449000000996', 'a number from a detector is still a code');
  assert.equal(barcode.GTIN_INVALID_HINT, 'A barcode is 8, 12, 13 or 14 digits.');
});

test('both envelopes are read, and anything else is "could not read that" rather than a nameless food', () => {
  const hit = barcode.parseBarcodeAnswer({
    found: true,
    source: 'openfoodfacts',
    cached: false,
    searched: ['local', 'usda', 'cache', 'openfoodfacts'],
    attribution: { text: 'Data: Open Food Facts · ODbL', url: 'https://world.openfoodfacts.org/product/5449000000996', licence: 'ODbL' },
    food: { description: 'Coca-Cola', servingSize: 330, servingSizeUnit: 'ml', foodNutrients: [] },
  });
  assert.equal(hit.found, true);
  assert.equal(hit.source, 'openfoodfacts');
  assert.deepEqual(hit.searched, ['local', 'usda', 'cache', 'openfoodfacts']);
  assert.equal(hit.food.description, 'Coca-Cola');

  const miss = barcode.parseBarcodeAnswer({
    found: false,
    code: '5449000000996',
    cached: true,
    searched: ['local', 'cache'],
    attribution: { text: 'Open Food Facts', contributeUrl: 'https://world.openfoodfacts.org/cgi/product.pl?code=5449000000996', licence: 'ODbL' },
  });
  assert.equal(miss.found, false);
  assert.equal(miss.code, '5449000000996');
  assert.equal(miss.cached, true);
  assert.equal(miss.reason, undefined, 'an ordinary miss carries no reason');

  const unconfigured = barcode.parseBarcodeAnswer({ found: false, code: '1', reason: 'provider_not_configured', attribution: {}, searched: [] });
  assert.equal(unconfigured.reason, barcode.REASON_PROVIDER_NOT_CONFIGURED);

  for (const junk of [null, 'nope', {}, { found: true }, { found: true, food: {} }, { found: true, food: { description: '  ' } }]) {
    assert.equal(barcode.parseBarcodeAnswer(junk), null, `${JSON.stringify(junk)} is not an answer`);
  }
});

test('the Open Food Facts attribution is printed as sent: the product page on a hit, the contribute form on a miss', () => {
  const hit = barcode.parseBarcodeAnswer({
    found: true,
    food: { description: 'X' },
    attribution: { text: 'Data: Open Food Facts · ODbL', url: 'https://world.openfoodfacts.org/product/1', licence: 'ODbL' },
  });
  assert.deepEqual(barcode.attributionLine(hit), {
    text: 'Data: Open Food Facts · ODbL',
    href: 'https://world.openfoodfacts.org/product/1',
    licence: 'ODbL',
  });
  const miss = barcode.parseBarcodeAnswer({
    found: false,
    code: '1',
    attribution: { text: 'Open Food Facts', contributeUrl: 'https://world.openfoodfacts.org/cgi/product.pl?code=1', licence: 'ODbL' },
  });
  assert.deepEqual(barcode.attributionLine(miss), {
    text: 'Open Food Facts',
    href: 'https://world.openfoodfacts.org/cgi/product.pl?code=1',
    licence: 'ODbL',
  });
  // A local food has no licence line at all, and none is invented.
  const local = barcode.parseBarcodeAnswer({ found: true, source: 'local', food: { description: 'Mine' }, attribution: { text: 'Your food', url: null, licence: null } });
  assert.deepEqual(barcode.attributionLine(local), { text: 'Your food', href: null, licence: null });
  assert.equal(barcode.attributionLine(barcode.parseBarcodeAnswer({ found: true, food: { description: 'X' }, attribution: {} })), null);
  assert.equal(barcode.attributionLine(null), null);
});

test('the macros come out of foodNutrients, because the payload has no flat calories field', () => {
  const food = {
    description: 'Coca-Cola',
    foodNutrients: [
      { nutrientId: 1008, nutrientName: 'Energy', unitName: 'KCAL', value: 42 },
      { nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: 0 },
      { nutrientId: 1005, nutrientName: 'Carbohydrate, by difference', unitName: 'G', value: 10.6 },
      { nutrientId: 1004, nutrientName: 'Total lipid (fat)', unitName: 'G', value: 0 },
    ],
  };
  assert.deepEqual(barcode.barcodeMacros(food), { calories: 42, protein: 0, carbs: 10.6, fat: 0 });
  assert.deepEqual(barcode.barcodeMacros({ description: 'X' }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  assert.equal(barcode.servingTextOf({ description: 'X', householdServingFullText: '1 can' }), '1 can');
  assert.equal(barcode.servingTextOf({ description: 'X', servingSize: 330, servingSizeUnit: 'ml' }), '330 ml');
  assert.equal(barcode.servingTextOf({ description: 'X' }), '1 serving');
});

test('each lookup failure reads as itself: a bad code, a busy budget, an upstream that is down', () => {
  const at = (status, data) => ({ response: { status, data } });
  assert.equal(barcode.lookupErrorCopy(at(400, { code: 'GTIN_INVALID', message: 'A barcode is 8, 12, 13 or 14 digits.' })), barcode.GTIN_INVALID_HINT);
  assert.equal(barcode.lookupErrorCopy(at(429, { code: 'BARCODE_RATE_LIMITED', retryAfterSec: 12 })), 'Too many lookups. Try again in 12 seconds.');
  assert.equal(barcode.lookupErrorCopy(at(429, { code: 'BARCODE_RATE_LIMITED', retryAfterSec: 1 })), 'Too many lookups. Try again in 1 second.');
  assert.match(barcode.lookupErrorCopy(at(429, {})), /Try again in a moment/);
  assert.match(barcode.lookupErrorCopy(at(503, { code: 'BARCODE_UPSTREAM_UNAVAILABLE', message: "Couldn't look up this code right now." })), /Couldn't look up this code/);
  assert.match(barcode.missCopy({ found: false, code: '1', reason: 'provider_not_configured' }), /not switched on for this server/);
  assert.match(barcode.missCopy({ found: false, code: '1' }), /not in the food database yet/);
});

/* ------------------------------------------------------------------- week */

const nutrition = (calories, protein, carbs, fat) => ({ calories, protein, carbs, fat });

test('a week is seven local days whether or not anything was logged on them', () => {
  // Wednesday 23 September 2026, local.
  const now = new Date(2026, 8, 23, 12, 0, 0);
  assert.equal(week.weekStart(now).getDate(), 21, 'Monday starts the week');
  assert.deepEqual(week.weekDayKeys(now), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
  // A Sunday belongs to the week that started six days earlier.
  assert.deepEqual(week.weekStart(new Date(2026, 8, 27, 9, 0, 0)).getDate(), 21);

  const rows = week.weekRows(
    [
      { timestamp: new Date(2026, 8, 21, 8, 0, 0).toISOString(), nutrition: nutrition(500, 30, 50, 15) },
      { timestamp: new Date(2026, 8, 21, 19, 0, 0).toISOString(), nutrition: nutrition(700, 40, 60, 25) },
      { timestamp: new Date(2026, 8, 23, 13, 0, 0).toISOString(), nutrition: nutrition(600, 35, 55, 20) },
      { timestamp: 'not a date', nutrition: nutrition(999, 9, 9, 9) },
      { timestamp: new Date(2026, 7, 1, 13, 0, 0).toISOString(), nutrition: nutrition(999, 9, 9, 9) },
    ],
    now,
  );
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r.logged), [true, false, true, false, false, false, false]);
  assert.deepEqual(rows[0], { dateKey: '2026-09-21', index: 0, kcal: 1200, protein: 70, carbs: 110, fat: 40, count: 2, logged: true, isToday: false, isFuture: false });
  assert.equal(rows[2].isToday, true);
  assert.equal(rows[3].isFuture, true, 'Thursday has not happened yet');
  assert.equal(rows[1].isFuture, false, 'Tuesday was simply not logged');
  assert.equal(rows[1].kcal, 0, 'the number is zero, which is exactly why the view prints NOTHING_LOGGED instead');
  assert.equal(week.NOTHING_LOGGED, 'Nothing logged');
});

test('the average is over the days that were logged, and a blank week has none at all', () => {
  const now = new Date(2026, 8, 23, 12, 0, 0);
  const rows = week.weekRows(
    [
      { timestamp: new Date(2026, 8, 21, 8, 0, 0).toISOString(), nutrition: nutrition(1000, 50, 100, 30) },
      { timestamp: new Date(2026, 8, 23, 8, 0, 0).toISOString(), nutrition: nutrition(2000, 100, 200, 60) },
    ],
    now,
  );
  assert.deepEqual(week.weekAverages(rows), { days: 2, kcal: 1500, protein: 75, carbs: 150, fat: 45 }, 'two logged days, not seven');
  assert.equal(week.weekAverages(week.weekRows([], now)), null, 'nothing logged is no average, never 0 kcal');
  assert.equal(week.weekAverages(null), null);
});

test('Atwater 4/4/9, the same arithmetic the server derives macros with', () => {
  assert.equal(week.macroCalories(30, 50, 15), 30 * 4 + 50 * 4 + 15 * 9);
  assert.equal(week.macroCalories(0, 0, 0), 0);
  assert.equal(week.macroCalories(-5, 10, 0), 40, 'a negative gram is no gram');
  assert.equal(week.macroCalories(NaN, 10, 0), 40);
});

test('quick add refuses what the server would, and every keyed write gets a legal id', () => {
  assert.equal(week.quickAddError(600), null);
  assert.equal(week.quickAddError(0), 'Enter the calories for this meal.');
  assert.equal(week.quickAddError(NaN), 'Enter the calories for this meal.');
  assert.equal(week.quickAddError(5001), 'kcal must be a number between 1 and 5000');
  assert.equal(week.quickAddError(5000), null);
  const id = week.mealRequestId('quick');
  assert.match(id, /^[A-Za-z0-9_-]{16,100}$/, 'services/clientRequests.js: 16-100 of [A-Za-z0-9_-]');
  assert.notEqual(id, week.mealRequestId('quick'), 'one id per attempt');
  const yesterday = week.yesterdayKey(new Date(2026, 8, 23, 12, 0, 0));
  assert.equal(yesterday, '2026-09-22');
  assert.equal(week.dayKeyOf(new Date(2026, 0, 1)), '2026-01-01');
});

/* -------------------------------------------------------- source contracts */

test('the scan button is gated on the capability and the lookup is the literal route', () => {
  assert.match(meals, /import \{ useFoodBarcode \} from '\.\.\/lib\/capabilities'/);
  assert.match(meals, /const canScan = useFoodBarcode\(\);/);
  assert.match(meals, /\{canScan \? \(\s*<IconButton label=\{SCAN_LABEL\}/, 'no scan button until the server can answer');
  assert.match(scanner, /api\.get\(`\/food\/barcode\/\$\{encodeURIComponent\(gtin\)\}`\)/);
  // Continuous scan, but one lookup per code: the budget is six a minute.
  assert.match(scanner, /if \(lastCode\.current === gtin \|\| lookup\.isPending\) return;/);
  assert.match(scanner, /setInterval\(/);
  // The camera is asked for on open, and released on close.
  assert.match(scanner, /navigator\.mediaDevices\s*\.getUserMedia\(\{ video: \{ facingMode: 'environment' \} \}\)/);
  assert.match(scanner, /streamRef\.current\?\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
  // No detector (iOS Safari) or a refused camera: the typed field, and a line saying so.
  assert.match(scanner, /setCamera\('unsupported'\)/);
  assert.match(scanner, /setCamera\('blocked'\)/);
  assert.match(barcode.CAMERA_UNAVAILABLE, /cannot scan a barcode, so type the digits/);
  // A hit goes into the log through the same serving picker a search hit uses.
  assert.match(meals, /const selected = selectedFoodFrom\(food as FoodSearchItem, 0\);/);
  // An unknown code is saved with the food, so the next scan resolves locally.
  assert.match(meals, /api\s*\.post\('\/food', \{\s*gtin: pendingGtin,/);
});

test('the meals writes are the literal routes, keyed, and carry the device day', () => {
  assert.match(meals, /api\.post\('\/meals\/copy', \{\s*fromDate: yesterdayKey\(\),\s*toDate: dayKeyOf\(new Date\(\)\),\s*clientRequestId: mealRequestId\('copy'\),\s*\.\.\.localDayParams\(\),\s*\}\)/);
  assert.match(meals, /api\.post\('\/meals\/quick-add', \{\s*mealType,\s*kcal: num\(kcal\),/);
  assert.match(meals, /clientRequestId: mealRequestId\('quick'\)/);
  // by-range keeps the range+offset shape this API takes; there is no from/to pair.
  assert.match(meals, /api\.get<RangeResponse>\('\/meals\/by-range', \{ params: \{ range, \.\.\.localDayParams\(\) \} \}\)/);
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of ['GET /api/food/barcode/:gtin', 'POST /api/food', 'POST /api/meals/copy', 'POST /api/meals/quick-add', 'GET /api/meals/by-range']) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
  // PUT /meals/macro-targets does not exist on this API, so nothing calls it.
  assert.ok(!pinned.has('PUT /api/meals/macro-targets'));
  assert.doesNotMatch(meals, /macro-targets/);
});

/* ------------------------------------------------------------------ render */

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { WeekRows } = await import('../src/pages/Meals.tsx');
const { BarcodeResult } = await import('../src/pages/meals/BarcodeScanner.tsx');

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '').replace(/&#x2F;/g, '/');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return decode(renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui)))));
}

test('the week rows name every day, and a day with nothing says so instead of 0 kcal', () => {
  const start = week.weekStart(new Date());
  const day = (offset, hour = 9) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, hour).toISOString();
  const html = mount(
    h(WeekRows, {
      meals: [
        { _id: 'a', food_name: 'Porridge', timestamp: day(0), nutrition: nutrition(500, 20, 80, 10) },
        { _id: 'b', food_name: 'Chicken', timestamp: day(0, 19), nutrition: nutrition(700, 50, 40, 25) },
      ],
    }),
  );
  assert.match(html, /Your week/);
  assert.match(html, /aria-label="Days this week"/);
  assert.equal((html.match(/<li /g) || []).length, 7, 'seven rows, always');
  assert.equal((html.match(/Nothing logged/g) || []).length + (html.match(/Still to come/g) || []).length, 6);
  assert.doesNotMatch(html, />0<\/span> kcal/, 'a blank day is never drawn as a zero');
  assert.match(html, /1,200|1200/, "Monday's two meals are added up");
  assert.match(html, /Daily average/);
  assert.match(html, /Over the 1 day you logged\./, 'one logged day averages over one');
});

test('a week with nothing logged has seven rows and no average line', () => {
  const html = mount(h(WeekRows, { meals: [] }));
  assert.equal((html.match(/<li /g) || []).length, 7);
  assert.doesNotMatch(html, /Daily average/, 'no logged day, no average');
});

test('an unknown barcode offers to create the food and still prints the attribution', () => {
  const answer = barcode.parseBarcodeAnswer({
    found: false,
    code: '5449000000996',
    cached: false,
    searched: ['local', 'usda', 'cache', 'openfoodfacts'],
    attribution: { text: 'Open Food Facts', contributeUrl: 'https://world.openfoodfacts.org/cgi/product.pl?code=5449000000996', licence: 'ODbL' },
  });
  const html = mount(h(BarcodeResult, { answer, onAdd() {}, onCreateFood() {} }));
  assert.match(html, /data-testid="barcode-not-found"/);
  assert.match(html, /No product for that code/);
  assert.match(html, /5449000000996/, 'the code is shown so it can be checked against the packet');
  assert.match(html, /not in the food database yet/);
  assert.match(html, /Create food/);
  assert.match(html, /href="https:\/\/world\.openfoodfacts\.org\/cgi\/product\.pl\?code=5449000000996"/);
  assert.match(html, /Open Food Facts/);
  assert.doesNotMatch(html, /data-testid="barcode-found"/);
});

test('a server with no lookup tier says so, and offers no "create" it cannot back', () => {
  const answer = barcode.parseBarcodeAnswer({ found: false, code: '12345670', reason: 'provider_not_configured', attribution: {}, searched: ['local'] });
  const html = mount(h(BarcodeResult, { answer, onAdd() {} }));
  assert.match(html, /Barcode lookup is not switched on for this server yet/);
  assert.doesNotMatch(html, /Create food/, 'no handler, no button');
});

test('a hit shows the food, one serving of macros, and the product-page attribution', () => {
  const answer = barcode.parseBarcodeAnswer({
    found: true,
    source: 'openfoodfacts',
    cached: false,
    searched: ['local', 'usda', 'cache', 'openfoodfacts'],
    attribution: { text: 'Data: Open Food Facts · ODbL', url: 'https://world.openfoodfacts.org/product/5449000000996', licence: 'ODbL' },
    food: {
      description: 'Coca-Cola',
      brandName: 'Coca-Cola',
      householdServingFullText: '1 can',
      foodNutrients: [
        { nutrientId: 1008, nutrientName: 'Energy', unitName: 'KCAL', value: 139 },
        { nutrientId: 1005, nutrientName: 'Carbohydrate, by difference', unitName: 'G', value: 35 },
      ],
    },
  });
  const html = mount(h(BarcodeResult, { answer, onAdd() {} }));
  assert.match(html, /data-testid="barcode-found"/);
  assert.match(html, /Coca-Cola/);
  assert.match(html, /1 can/);
  assert.match(html, /139/);
  assert.match(html, /Add to meal/);
  assert.match(html, /href="https:\/\/world\.openfoodfacts\.org\/product\/5449000000996"/);
});
