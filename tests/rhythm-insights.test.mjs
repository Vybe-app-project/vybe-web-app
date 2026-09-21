/**
 * The rhythm and insights view models (src/lib/rhythm.ts, src/lib/insights.ts)
 * and the year half of src/lib/recapView.ts.
 *
 * What these pin is the promise the package makes: every verdict on the wire
 * is a key the server decided, and this code renders exactly one English
 * form per key. Nothing re-judges a week, re-scores a total or invents a
 * sentence — so a fixture with a status, a band or a label must come out the
 * other side saying only what that key means, and a fixture missing a number
 * must come out saying nothing at all rather than "0".
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/**
 * Every string a person can read in a source, and nothing of the code around
 * it: comments explain the bans and must not trip them, and a class list is
 * not copy. The same extractor tests/progress-hub-contract.test.mjs uses.
 */
function readableText(relative) {
  const source = read(relative);
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text);
      for (const span of node.templateSpans) out.push(span.literal.text);
    } else if (ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out.map((t) => t.trim()).filter(Boolean);
}

/** A string that only a browser reads: a class list, a token, a key, a path. */
const isCode = (text) => (
  /^[a-z0-9@./:#%[\]()_-]+$/i.test(text)
  || /(^|\s)(flex|grid|mt-|mb-|ml-|mr-|px-|py-|pt-|pb-|gap-|min-|max-|text-|bg-|border|rounded|divide|shrink|truncate|tabular|type-|t-|sr-only|items-|justify-|w-|h-|inline|absolute|relative|pressable|line-clamp|space-y|first:|last:|hover:|aria-)/.test(text)
);

const rhythm = await import('../src/lib/rhythm.ts');
const insights = await import('../src/lib/insights.ts');
const recaps = await import('../src/lib/recapView.ts');

/* ---------------------------------------------------------------- fixtures */

const week = (over = {}) => ({
  weekKey: '2026-W38',
  startDate: '2026-09-14',
  endDate: '2026-09-20',
  target: 3,
  daysDone: 2,
  kept: false,
  remaining: 1,
  status: 'in_progress',
  repaired: false,
  tokenUsed: false,
  days: [
    { date: '2026-09-14', counted: true, activities: [] },
    { date: '2026-09-15', counted: false, activities: [] },
    { date: '2026-09-16', counted: true, activities: [] },
    { date: '2026-09-17', counted: false, activities: [] },
    { date: '2026-09-18', counted: false, activities: [] },
    { date: '2026-09-19', counted: false, activities: [] },
    { date: '2026-09-20', counted: false, activities: [] },
  ],
  ...over,
});

/* ------------------------------------------------------------ the week strip */

test('the strip is always seven Monday-first cells, and a letter is never the spoken name', () => {
  const cells = rhythm.weekCells(week());
  assert.equal(cells.length, 7);
  assert.deepEqual(cells.map((c) => c.letter), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  assert.deepEqual(cells.map((c) => c.counted), [true, false, true, false, false, false, false]);
  // Two Tuesdays and two Saturdays share a letter, so each cell says its day and date.
  assert.equal(cells[0].description, 'Monday, Sep 14: trained');
  assert.equal(cells[1].description, 'Tuesday, Sep 15: rest');
  assert.equal(cells[6].description, 'Sunday, Sep 20: rest');

  // A short or missing array still draws seven cells: the card keeps its geometry,
  // and a day the server did not describe is not a trained day.
  const partial = rhythm.weekCells({ days: [{ date: '2026-09-14', counted: true, activities: [] }] });
  assert.equal(partial.length, 7);
  assert.equal(partial.filter((c) => c.counted).length, 1);
  assert.equal(rhythm.weekCells(null).length, 7);
  assert.equal(rhythm.weekCells(undefined).filter((c) => c.counted).length, 0);
  assert.equal(rhythm.weekCells({}).every((c) => c.date === ''), true);
});

test('the week line restates the status the fold decided, and never what was not done', () => {
  assert.equal(rhythm.weekLine(week()), '2 of 3 days this week — one more keeps it.');
  assert.equal(rhythm.weekLine(week({ daysDone: 1, remaining: 2 })), '1 of 3 days this week — 2 more keep it.');
  assert.equal(rhythm.weekLine(week({ daysDone: 3, remaining: 0 })), '3 of 3 days this week.');
  // A closed week reuses the wording of the notice the sweep writes for itself.
  assert.equal(rhythm.weekLine(week({ status: 'kept', daysDone: 3, kept: true, remaining: 0 })), 'Week kept: 3 of 3 days.');
  // The spec form is "t of t days": a week with more days than the target still reads 3 of 3.
  assert.equal(rhythm.weekLine(week({ status: 'kept', daysDone: 5, kept: true })), 'Week kept: 3 of 3 days.');
  assert.equal(rhythm.weekLine(week({ status: 'kept_with_token', tokenUsed: true })), 'Week kept with a rest week from the bank.');
  assert.equal(rhythm.weekLine(week({ status: 'paused' })), 'On a break.');
  assert.equal(rhythm.weekLine(week({ status: 'paused' }), { since: '2026-09-01', until: '2026-09-28' }), 'On a break until Sep 28.');
  assert.equal(rhythm.weekLine(week({ status: 'open', daysDone: 1 })), '1 of 3 days that week.');
  assert.equal(rhythm.weekLine(null), '');
  for (const status of ['kept', 'kept_with_token', 'open', 'paused', 'in_progress']) {
    assert.ok(!rhythm.weekLine(week({ status })).includes('NaN'), status);
  }
});

test('the weekly chain is named only from two, and a zero chain is no line at all', () => {
  assert.equal(rhythm.WEEKS_KEPT_FLOOR, 2);
  assert.equal(rhythm.weeksKeptLabel(0), null, 'a chain of zero is a hole, not a fact');
  assert.equal(rhythm.weeksKeptLabel(1), null, 'one kept week is the week itself, which the line already says');
  assert.equal(rhythm.weeksKeptLabel(2), '2 weeks kept');
  assert.equal(rhythm.weeksKeptLabel(12), '12 weeks kept');
  assert.equal(rhythm.weeksKeptLabel(null), null);
  assert.equal(rhythm.weeksKeptLabel(undefined), null);
  assert.equal(rhythm.milestoneLine({ weeks: 12, in: 7 }), '7 weeks to 12');
  assert.equal(rhythm.milestoneLine({ weeks: 12, in: 1 }), '1 week to 12');
  assert.equal(rhythm.milestoneLine({ weeks: 12, in: 0 }), null);
  assert.equal(rhythm.milestoneLine(null), null);
});

test('the repair path appears only when the API banked something for it', () => {
  // Only the fold writes a rest week; no route, purchase or admin action can add one.
  assert.equal(rhythm.restBankLine({ bank: 0, max: 2 }), null, 'an empty bank is not an offer');
  assert.equal(rhythm.restBankLine({ bank: 1, max: 2 }), '1 rest week banked. A banked week covers one that comes up short.');
  assert.equal(rhythm.restBankLine({ bank: 2, max: 2 }), '2 rest weeks banked. A banked week covers one that comes up short.');
  assert.equal(rhythm.restBankLine(null), null);
  assert.equal(rhythm.restBankLine({}), null);
});

test('the Monday suggestion restates its own basis and then makes the offer', () => {
  const raise = {
    id: 'raise:2026-W38',
    kind: 'raise',
    from: 3,
    to: 4,
    basis: [
      { key: '2026-W35', status: 'kept', daysCounted: 4, target: 3 },
      { key: '2026-W36', status: 'kept', daysCounted: 3, target: 3 },
      { key: '2026-W37', status: 'kept', daysCounted: 4, target: 3 },
      { key: '2026-W38', status: 'kept', daysCounted: 3, target: 3 },
    ],
    createdAt: 'x',
    expiresAt: 'y',
  };
  assert.equal(rhythm.suggestionLine(raise), '4 weeks kept at 3 days. Move to 4?');
  assert.equal(rhythm.suggestionAcceptLabel(raise), 'Move to 4 days');
  const lower = {
    ...raise,
    id: 'lower:2026-W38',
    kind: 'lower',
    from: 3,
    to: 2,
    basis: [
      { key: '2026-W36', status: 'open', daysCounted: 1, target: 3 },
      { key: '2026-W37', status: 'kept', daysCounted: 3, target: 3 },
      { key: '2026-W38', status: 'open', daysCounted: 2, target: 3 },
    ],
  };
  assert.equal(rhythm.suggestionLine(lower), '2 of the last 3 weeks came in under 3 days. Move to 2?');
  assert.equal(rhythm.suggestionAcceptLabel(lower), 'Move to 2 days');
  // No card, no row.
  assert.equal(rhythm.suggestionLine(null), null);
  assert.equal(rhythm.suggestionLine(undefined), null);
  assert.equal(rhythm.suggestionAcceptLabel(null), null);
  assert.equal(rhythm.suggestionLine({ ...raise, from: null, to: null }), null);
  // The basis rows are the disclosure: the sets the sentence was computed from.
  assert.equal(rhythm.basisRowLabel({ key: '2026-W37', status: 'kept', daysCounted: 4, target: 3 }), '4 of 3 days');
  assert.equal(rhythm.basisRowLabel({ key: '2026-W37', status: 'open', daysCounted: 0, target: 1 }), '0 of 1 day');
});

test('no rhythm or insights string carries a word the backend copy test refuses', () => {
  // services/rhythmCopy.js BANNED_WORDS, held on this side of the wire too.
  assert.deepEqual(rhythm.RHYTHM_BANNED_WORDS, ['streak', 'missed', 'lost', 'broke', 'behind', 'fail', 'reminder']);
  const banned = new RegExp(`\\b(${rhythm.RHYTHM_BANNED_WORDS.join('|')})`, 'i');
  // The ban list itself names the words; everything else must not.
  const files = [
    'src/lib/rhythm.ts',
    'src/lib/insights.ts',
    'src/pages/RhythmCard.tsx',
    'src/components/VybeScore.tsx',
    'src/pages/progress/InsightsCard.tsx',
    'src/pages/progress/TrainingLoad.tsx',
    'src/pages/progress/FocusSheet.tsx',
  ];
  const ignore = new Set(rhythm.RHYTHM_BANNED_WORDS);
  let judged = 0;
  for (const file of files) {
    const texts = readableText(file);
    assert.ok(texts.length > 0, `${file} has readable text`);
    for (const text of texts) {
      if (ignore.has(text) || isCode(text)) continue;
      judged += 1;
      assert.doesNotMatch(text, banned, `${file}: "${text}"`);
      // The design's register: no exclamation mark anywhere in this package.
      assert.doesNotMatch(text, /!/, `${file}: "${text}"`);
      // And none of the words the progression hub's own copy test refuses.
      assert.doesNotMatch(text, /crushed|beast|smash|weak\b|weight loss|\blean\b/i, `${file}: "${text}"`);
    }
  }
  assert.ok(judged > 40, `expected the copy of seven files, judged ${judged}`);
});

test('the score is never called a health score, a fitness level or a verdict', () => {
  const sources = [
    'src/lib/insights.ts',
    'src/components/VybeScore.tsx',
    'src/pages/progress/InsightsCard.tsx',
    'src/pages/progress/TrainingLoad.tsx',
    'src/pages/RhythmCard.tsx',
    'src/pages/Profile.tsx',
  ];
  for (const file of sources) {
    // The whole source, comments included: the phrase must not be in the tree at all.
    assert.doesNotMatch(read(file), /health score/i, `${file} must never say "health score"`);
    assert.doesNotMatch(read(file), /fitness (score|level)/i, `${file} must never say "fitness score" or "fitness level"`);
    // And nothing a person reads calls it a diagnosis or a grade.
    for (const text of readableText(file)) {
      if (isCode(text)) continue;
      assert.doesNotMatch(text, /\bdiagnos|\bgrade\b|\brank(ed|ing)?\b/i, `${file}: "${text}"`);
    }
  }
  assert.equal(insights.VYBE_SCORE.name, 'Vybe score');
  assert.equal(insights.VYBE_SCORE.measure, 'Consistency');
});

/* ---------------------------------------------------------------- the score */

const part = (over = {}) => ({ key: 'sessions', outOf: 40, points: 36, state: 'scored', reason: null, missing: null, inputs: {}, ...over });

const score = (over = {}) => ({
  window: 'week',
  days: 7,
  outOf: 100,
  total: 62,
  band: 'ok',
  showTotal: true,
  computedAt: '2026-09-20T12:00:00.000Z',
  parts: [
    part({ key: 'sessions', outOf: 40, points: 36, inputs: { daysCounted: 3, target: 3, activeMinutes: 118, minutesTarget: 150 } }),
    part({ key: 'movement', outOf: 30, points: 26, inputs: { daysAtGoal: 5, daysWithSteps: 7, goal: 7500, goalSource: 'default' } }),
    part({ key: 'meals', outOf: 30, points: 30, inputs: { daysLogged: 4, needed: 3, weeksConsistent: null } }),
  ],
  movedBy: [{ key: 'sessions', delta: 12, detail: { from: 24, to: 36 } }],
  ...over,
});

test('the headline is the API total with its band as a word, and the band is Low / OK / High', () => {
  assert.deepEqual(insights.SCORE_BANDS, { low: 'Low', ok: 'OK', high: 'High' });
  const head = insights.scoreHeadline(score());
  assert.deepEqual(head, { value: '62', outOf: 'of 100', band: 'OK', note: null, calibrating: false });
  assert.equal(insights.scoreHeadline(score({ band: 'low', total: 20 })).band, 'Low');
  assert.equal(insights.scoreHeadline(score({ band: 'high', total: 90 })).band, 'High');
  assert.equal(insights.scoreHeadline(score({ band: 'whatever' })).band, null, 'an unknown band is no word at all');
  assert.equal(insights.scoreHeadline(null), null);
  // A part that is off re-bases the budget; the headline prints the API's own outOf.
  assert.equal(insights.scoreHeadline(score({ outOf: 70, total: 58 })).outOf, 'of 70');
});

test('while a part is short the headline calibrates with the API\'s exact gap, never a zero', () => {
  const calibrating = score({
    total: null,
    band: null,
    parts: [
      part({ key: 'sessions', outOf: 40, points: 36 }),
      part({ key: 'movement', outOf: 30, points: null, state: 'not_enough_data', reason: 'steps_days', missing: 1, inputs: { daysAtGoal: 2, daysWithSteps: 3, goal: 7500, goalSource: 'default' } }),
      part({ key: 'meals', outOf: 30, points: 30 }),
    ],
  });
  assert.equal(insights.isCalibrating(calibrating), true);
  const head = insights.scoreHeadline(calibrating);
  assert.equal(head.calibrating, true);
  assert.equal(head.value, 'Calibrating');
  assert.equal(head.outOf, null, 'no budget while there is no total');
  assert.equal(head.band, null, 'no band while there is no total');
  assert.equal(head.note, 'Log steps on 1 more day, or connect the Health app.');
  assert.ok(!/\b0\b/.test(head.value), 'never a zero in the number\'s place');
  assert.equal(insights.calibratingGap(calibrating), 'Log steps on 1 more day, or connect the Health app.');
  // The plural comes from the API's own `missing`.
  assert.equal(insights.calibratingGap(score({ parts: [part({ state: 'not_enough_data', reason: 'steps_days', missing: 4 })] })), 'Log steps on 4 more days, or connect the Health app.');
  // The total switched off (D-105) is its own note, and still not a number.
  const off = insights.scoreHeadline(score({ showTotal: false }));
  assert.equal(off.calibrating, true);
  assert.equal(off.value, 'Calibrating');
  assert.match(off.note, /insights preferences/);
  // No reason the API can explain: the design's own withheld line.
  assert.equal(insights.scoreHeadline(score({ total: null, parts: [part({ state: 'not_enough_data', reason: 'age', missing: null })] })).note, 'Total shows once every part has data.');
  assert.equal(insights.isCalibrating(score()), false);
  assert.equal(insights.isCalibrating(null), false);
});

test('the reason table is the backend\'s own, word for word', () => {
  // services/rhythmSuggestions.js COPY.reason, pinned there by its own suite.
  assert.equal(insights.REASON_COPY.set_target, 'Pick how many days a week you’ll train and this part scores.');
  assert.equal(insights.REASON_COPY.steps_days(1), 'Log steps on 1 more day, or connect the Health app.');
  assert.equal(insights.REASON_COPY.steps_days(4), 'Log steps on 4 more days, or connect the Health app.');
  assert.equal(insights.REASON_COPY.rate_sessions(2), 'Rate 2 more sessions to see this week against your usual.');
  assert.equal(insights.REASON_COPY.rate_sessions(1), 'Rate 1 more session to see this week against your usual.');
  assert.equal(insights.REASON_COPY.history(3), '3 more days of history and this appears.');
  assert.equal(insights.REASON_COPY.age, '', 'a minor is told nothing about a part that is off for them');
  assert.equal(insights.reasonCopy('age', null), '');
  assert.equal(insights.reasonCopy('something-new', 2), '', 'an unknown reason is silence, not a guess');
});

test('the parts list carries the inputs each number came from, and says "Off" rather than zero', () => {
  const rows = insights.scoreRows(score());
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [['Sessions', '36 of 40'], ['Movement', '26 of 30'], ['Meals', '30 of 30']]);
  assert.equal(rows[0].inputs, '3 days of 3 · 118 of 150 min');
  assert.equal(rows[1].inputs, '5 days at 7,500 steps or more · goal 7,500 steps a day (Vybe default)');
  assert.equal(rows[2].inputs, '4 days logged · 3 a week counts in full');
  assert.equal(rows[0].gap, null);
  // `weeksConsistent` only rides with the mealsWeeks flag on.
  assert.match(insights.scoreRows(score({ parts: [part({ key: 'meals', inputs: { daysLogged: 4, needed: 3, weeksConsistent: 5 } })] }))[0].inputs, /5 weeks in a row/);
  // The goal source names itself, in the design's words.
  assert.match(insights.scoreRows(score({ parts: [part({ key: 'movement', inputs: { daysAtGoal: 2, daysWithSteps: 3, goal: 9000, goalSource: 'setting' } })] }))[0].inputs, /\(your setting\)/);
  assert.match(insights.scoreRows(score({ parts: [part({ key: 'movement', inputs: { daysAtGoal: 2, daysWithSteps: 3, goal: 9000, goalSource: 'health' } })] }))[0].inputs, /\(your Health app goal\)/);
  // A withheld part: an en dash and the exact gap, no number.
  const withheld = insights.scoreRows(score({ parts: [part({ state: 'not_enough_data', points: null, reason: 'set_target', missing: null })] }))[0];
  assert.equal(withheld.value, '—');
  assert.equal(withheld.gap, 'Pick how many days a week you’ll train and this part scores.');
  // An off part keeps its row and explains itself; the budget above it has already re-based.
  const offRow = insights.scoreRows(score({ parts: [part({ key: 'meals', state: 'off', points: null, outOf: 0 })] }))[0];
  assert.equal(offRow.value, 'Off');
  assert.equal(offRow.inputs, 'No meals logged in 28 days. Log one and this part scores.');
  assert.equal(offRow.gap, null);
  assert.deepEqual(insights.scoreRows(null), []);
  for (const row of rows) assert.ok(!String(row.value).includes('NaN') && !String(row.inputs).includes('NaN'));
});

test('movedBy is the one comparison, as neutral text with no arrow and no colour', () => {
  assert.equal(insights.movedHint(score()), 'Sessions +12 points vs your previous week');
  assert.equal(insights.movedHint(score({ movedBy: [{ key: 'meals', delta: -6, detail: { from: 30, to: 24 } }] })), 'Meals −6 points vs your previous week');
  assert.equal(insights.movedHint(score({ movedBy: [] })), null, 'a first window compares with nothing');
  assert.equal(insights.movedHint(score({ movedBy: [{ key: 'meals', delta: 0, detail: { from: 30, to: 30 } }] })), null);
  assert.equal(insights.movedHint(null), null);
  // A real minus sign, the way the Progress tiles print theirs.
  assert.ok(insights.movedHint(score({ movedBy: [{ key: 'meals', delta: -6, detail: { from: 30, to: 24 } }] })).includes('−'));
});

/* ------------------------------------------------------------ training load */

const load = (over = {}) => ({
  state: 'scored',
  label: 'steady',
  reason: null,
  missing: null,
  acute: { load: 640, sessions: 3, rated: 2, estimated: 1 },
  chronic: { weeklyMean: 590, weeks: 4 },
  ratio: 1.08,
  offer: null,
  since: '2026-08-17T10:00:00.000Z',
  weekly: [
    { weekKey: '2026-W35', load: 0, sessions: 0 },
    { weekKey: '2026-W36', load: 300, sessions: 2 },
    { weekKey: '2026-W37', load: 640, sessions: 3 },
    { weekKey: '2026-W38', load: null, sessions: 1 },
  ],
  ...over,
});

test('the load label is the design\'s sentence for the server\'s key, and never a colour word', () => {
  assert.equal(insights.loadLine(load()), 'This week is steady with your usual.');
  assert.equal(insights.loadLine(load({ label: 'well_below' })), 'This week is well below your usual.');
  assert.equal(insights.loadLine(load({ label: 'below' })), 'This week is below your usual.');
  assert.equal(insights.loadLine(load({ label: 'above' })), 'This week is above your usual.');
  assert.equal(insights.loadLine(load({ label: 'well_above' })), 'This week is well above your usual.');
  assert.equal(insights.loadLine(load({ label: 'panic' })), null, 'an unknown label says nothing');
  // Withheld: the server's own gap, never a made-up reassurance.
  assert.equal(insights.loadLine(load({ state: 'not_enough_data', label: null, reason: 'rate_sessions', missing: 2 })), 'Rate 2 more sessions to see this week against your usual.');
  assert.equal(insights.loadLine(load({ state: 'not_enough_data', label: null, reason: 'history', missing: 3 })), '3 more days of history and this appears.');
  // Off for a minor: no card, no explanation, nothing.
  assert.equal(insights.loadLine(load({ state: 'off', label: null, reason: 'age' })), null);
  assert.equal(insights.loadLine(null), null);
  // None of the five words the design bans anywhere near this card.
  for (const value of Object.values(insights.LOAD_LABELS)) {
    assert.doesNotMatch(value, /risk|injury|overtraining|danger|recover now/i, value);
  }
});

test('the load numbers stay behind the disclosure, and the ratings line is the API\'s count', () => {
  assert.equal(insights.loadNumbers(load()), 'This week 640 · Your usual 590 · Ratio 1.08');
  assert.equal(insights.loadRatedLine(load()), '2 of 3 sessions rated; the rest estimated from your median.');
  assert.equal(insights.loadNumbers(load({ state: 'not_enough_data' })), null);
  assert.equal(insights.loadRatedLine(load({ state: 'off' })), null);
  assert.equal(insights.loadOfferLine(load()), null, 'no offer unless the API made one');
  assert.equal(insights.loadOfferLine(load({ offer: 'lighter_session' })), 'Want a lighter session today?');
  assert.equal(insights.LOAD_STRINGS.usualNote, 'Your usual is the average of the last four weeks.');
});

test('the weekly strip scales against its own tallest week, and a null load is not a zero', () => {
  const bars = insights.loadBars(load());
  assert.equal(bars.length, 4);
  assert.deepEqual(bars.map((b) => b.ratio), [0, 300 / 640, 1, 0]);
  assert.equal(bars[3].load, null, 'a week the API could not total stays null');
  assert.equal(bars[3].sessions, 1, 'the count still stands');
  assert.equal(insights.loadBarLabel(bars[0]), 'Week 35: no sessions');
  assert.equal(insights.loadBarLabel(bars[2]), 'Week 37: 640 load from 3 sessions');
  assert.equal(insights.loadBarLabel(bars[3]), 'Week 38: 1 session, no load yet');
  assert.equal(insights.weekKeyLabel('2026-W38'), 'Week 38');
  assert.equal(insights.weekKeyLabel('nonsense'), 'nonsense');
  // A minor gets an empty series, which is no strip at all.
  assert.deepEqual(insights.loadBars(load({ weekly: [] })), []);
  assert.deepEqual(insights.loadBars(null), []);
});

/* -------------------------------------------------------- focus, welcome back */

test('focus offers exactly the four values the route accepts, with the server\'s labels', () => {
  assert.deepEqual(insights.FOCUS_KINDS, ['build', 'event', 'stay_active', 'recover']);
  assert.deepEqual(insights.FOCUS_LABELS, { build: 'Build', event: 'Event', stay_active: 'Stay active', recover: 'Recover' });
  assert.deepEqual(insights.FOCUS_OPTIONS.map((o) => o.kind), ['build', 'event', 'stay_active', 'recover']);
  // The row prints the label the API sent, not one derived from the kind.
  assert.equal(insights.focusValue({ kind: 'recover', label: 'Recover', eventDate: null, setAt: null, note: null }), 'Recover');
  assert.equal(insights.focusValue({ kind: 'event', label: '', eventDate: '2026-11-01', setAt: null, note: null }), 'Event', 'the kind is the fallback, not the source');
  assert.equal(insights.focusValue(null), null);
});

test('welcome back greets from the API numbers and offers only the repair the API named', () => {
  const record = {
    id: 'wb1',
    previousActiveAt: '2026-08-01T00:00:00.000Z',
    returnedAt: '2026-09-20T00:00:00.000Z',
    idleDays: 50,
    target: { current: 3, lowerTo: 2, weeksKept: 6 },
    focusOffer: null,
    breakOffer: { weeks: 7 },
  };
  assert.equal(insights.welcomeBackLine(record), 'Welcome back — 50 days since your last session. Your 6 weeks kept are still here.');
  // The chain is only mentioned above zero.
  assert.equal(insights.welcomeBackLine({ ...record, target: { current: 3, lowerTo: null, weeksKept: 0 } }), 'Welcome back — 50 days since your last session.');
  assert.equal(insights.welcomeBackLine({ ...record, idleDays: 1 }), 'Welcome back — 1 day since your last session. Your 6 weeks kept are still here.');
  assert.equal(insights.welcomeBackLine(null), null);
  // The break offer comes first because the API states its own week count.
  assert.deepEqual(insights.welcomeBackOffer(record), { action: 'keep_target', label: 'Count 7 weeks as a break', countAsBreak: true });
  // No break offer: the target the API named, and nothing invented.
  assert.deepEqual(insights.welcomeBackOffer({ ...record, breakOffer: { weeks: 0 } }), { action: 'lower_target', label: 'Lower to 2 days a week' });
  // Neither offered: a greeting with a dismiss and nothing more.
  assert.equal(insights.welcomeBackOffer({ ...record, breakOffer: { weeks: 0 }, target: { current: 3, lowerTo: null, weeksKept: 6 } }), null);
  assert.equal(insights.welcomeBackOffer(null), null);
});

/* -------------------------------------------------------------- the year */

test('a Year in Vybe names itself, compares with last year and locks by its own rule', () => {
  assert.equal(recaps.recapTitle('year'), 'Year in Vybe');
  assert.equal(recaps.runningBadge({ kind: 'year', final: false }), 'This year so far');
  assert.equal(recaps.runningBadge({ kind: 'year', final: true }), null);
  assert.equal(recaps.compareLabel('year', false), 'Compare with last year');
  assert.equal(recaps.compareLabel('year', true), 'Hide comparison');
  assert.equal(recaps.captionPlaceholder('year'), 'Say something about the year');
  assert.equal(recaps.quietCopy('year'), 'A quiet year. The next one is a fresh start.');
  assert.equal(recaps.lockedTitle('year'), 'This year is still locked');
  assert.equal(recaps.lockedTitle('month'), 'This month is still locked');
  assert.match(recaps.lockedShareMessage('year'), /once the year closes/);
  assert.equal(recaps.lockedShareMessage('month'), recaps.LOCKED_SHARE_MESSAGE);
  // The twelve-session floor is the API's number, never one written here.
  assert.equal(recaps.lockedCopy({ sessions: 5, needed: 12, unlocksOn: '2026-12-31' }, 'year'), '5 of 12 sessions so far. Unlocks on Dec 31 with 12 sessions or more.');
  assert.equal(recaps.lockedCopy({ sessions: 5, needed: 12, unlocksOn: null }, 'year'), '5 of 12 sessions so far. Log 7 more sessions to unlock this year.');
  assert.equal(recaps.lockedCopy(null, 'year'), 'This recap unlocks later in the year.');
  // The month wording is untouched, including the default argument.
  assert.equal(recaps.lockedCopy({ sessions: 2, needed: 3, unlocksOn: null }), '2 of 3 sessions so far. Log 1 more session to unlock this month.');
  const deltas = recaps.compareDeltas({ sessions: 140, minutes: 7100, volumeKg: 400000, previous: { sessions: 120, minutes: 6000, volumeKg: 350000 } }, 'kg', 'year');
  assert.equal(deltas.sessions.label, 'vs last year');
});

test('the twelve months keep their places, zeros included, and each says its own numbers', () => {
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, sessions: i === 0 ? 4 : i === 8 ? 12 : 0, minutes: i === 0 ? 190 : i === 8 ? 600 : 0 }));
  const bars = recaps.monthBars(byMonth);
  assert.equal(bars.length, 12, 'every month present: the year\'s shape is the point');
  assert.deepEqual(bars.map((b) => b.label), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  assert.equal(bars[8].ratio, 1, 'scaled against the busiest month');
  assert.equal(bars[0].ratio, 4 / 12);
  assert.equal(bars[1].ratio, 0);
  assert.equal(bars[0].description, 'January: 4 sessions, 3 h 10 min');
  assert.equal(bars[1].description, 'February: no sessions');
  assert.equal(bars[8].description, 'September: 12 sessions, 10 h');
  assert.equal(recaps.monthLabel('2026-09'), 'Sep');
  assert.equal(recaps.monthLabel('nope'), 'nope');
  assert.deepEqual(recaps.monthBars(null), [], 'a week or a month carries no months');
  assert.deepEqual(recaps.monthBars([]), []);
  for (const bar of bars) assert.ok(!bar.description.includes('NaN'));
});

test('the year\'s tiles keep their boxes and put the next action in the number\'s place', () => {
  const data = { sessions: 140, minutes: 7100, volumeKg: 400000, prs: [{}, {}], activeDays: [], byDay: [], topExercises: [], weeksKept: null, gyms: null, buddies: null, previous: null, progress: null };
  const tiles = recaps.yearTiles(data, 'kg');
  assert.deepEqual(tiles.map((t) => [t.key, t.value]), [['sessions', '140'], ['time', '118 h 20 min'], ['volume', '400,000 kg'], ['records', '2']]);
  // Nothing there: the fallback, never a zero.
  const empty = recaps.yearTiles({ ...data, sessions: 0, minutes: 0, volumeKg: 0, prs: [] }, 'kg');
  assert.deepEqual(empty.map((t) => t.value), [null, null, null, null]);
  assert.deepEqual(empty.map((t) => t.fallback), ['Log a session', 'Log a session', 'Log some sets', 'Beat a best']);
  assert.equal(recaps.yearTiles({ ...data, sessions: 1, prs: [{}] }, 'kg')[0].label, 'Session');
  assert.equal(recaps.yearTiles(data, 'lb')[2].value, '881,849 lb');
  for (const tile of tiles) assert.ok(!String(tile.value).includes('NaN'));
});

test('a year\'s active days come from activeDayCount, since a year lists no days', () => {
  assert.equal(recaps.activeDaysCopy([], 118), '118 active days');
  assert.equal(recaps.activeDaysCopy([], 1), '1 active day');
  // A document written before the field falls back to the list's length.
  assert.equal(recaps.activeDaysCopy(['2026-09-14', '2026-09-16'], null), '2 active days');
  assert.equal(recaps.activeDaysCopy(['2026-09-14']), '1 active day');
  assert.equal(recaps.activeDaysCopy([], 0), '0 active days', 'the count is the API\'s; the card decides whether to print it');
});

test('a year card carries weeks kept, and a week card never does', () => {
  const data = { sessions: 140, minutes: 7100, volumeKg: 400000, prs: [], activeDays: [], byDay: [], topExercises: [], weeksKept: { count: 41, targetDays: 3 }, gyms: null, buddies: null, previous: null, progress: null };
  assert.ok(recaps.shareDescription({ kind: 'year', data }).includes('plus weeks kept.'));
  assert.ok(recaps.shareDescription({ kind: 'month', data }).includes('plus weeks kept.'));
  assert.ok(!recaps.shareDescription({ kind: 'week', data }).includes('weeks kept'));
});
