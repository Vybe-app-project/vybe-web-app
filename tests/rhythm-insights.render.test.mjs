/**
 * The retention surfaces render from props alone (renderToString inside a
 * MemoryRouter): the Home rhythm card, the Vybe score pieces, the Progress
 * insights card, the weekly training-load strip and the Year in Vybe body.
 *
 * What these pin is the register: seven day cells whatever the API sent, a
 * filled day that is ink and not the action colour, no zero and no NaN
 * anywhere, a repair or a suggestion only when the API offered one, a
 * calibrating score that shows the gap instead of a number, and no verdict
 * colour or trend arrow on any of it.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { RhythmCardView, recapRowCopy, newestUnviewed } = await import('../src/pages/RhythmCard.tsx');
const { VybeScoreMetric, VybeScoreParts, VybeScoreRow } = await import('../src/components/VybeScore.tsx');
const { InsightsCard } = await import('../src/pages/progress/InsightsCard.tsx');
const { TrainingLoad } = await import('../src/pages/progress/TrainingLoad.tsx');
const { RecapYearMonths, RecapYearTotals, RecapBody } = await import('../src/pages/RecapBody.tsx');
const insights = await import('../src/lib/insights.ts');

const render = (ui) => renderToString(h(MemoryRouter, null, ui));
const count = (html, needle) => html.split(needle).length - 1;

// components/icons.tsx TrendingUp / TrendingDown by their path data.
const TRENDING_UP = 'm3 17 6-6 4 4 8-8';
const TRENDING_DOWN = 'm3 7 6 6 4-4 8 8';
const VERDICT_CLASS = /\b(text|bg|border)-(success|danger|accent)\b/;

const clean = (html, where) => {
  assert.ok(!html.includes('NaN'), `${where}: NaN`);
  assert.ok(!html.includes('undefined'), `${where}: undefined`);
  assert.doesNotMatch(html, VERDICT_CLASS, `${where}: verdict colour`);
  assert.ok(!html.includes(TRENDING_UP) && !html.includes(TRENDING_DOWN), `${where}: trend arrow`);
};

/* --------------------------------------------------------------- fixtures */

const rhythmView = (over = {}) => ({
  target: 3,
  weekStartsOn: 'monday',
  timezone: 'America/New_York',
  timezoneOffsetMinutes: 240,
  visibility: 'private',
  pause: null,
  currentWeek: {
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
    days: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'].map((date, i) => ({
      date,
      counted: i === 0 || i === 2,
      activities: [],
    })),
  },
  weeksKept: 5,
  longestWeeksKept: 7,
  restTokens: { bank: 0, max: 2, ledger: [] },
  history: [],
  hasMoreHistory: false,
  nextMilestone: { weeks: 12, in: 7 },
  comeback: { idleDays: 1, celebrateOnce: false },
  celebrations: [],
  computedAt: '2026-09-19T15:00:00.000Z',
  ...over,
});

const score = (over = {}) => ({
  window: 'week',
  days: 7,
  outOf: 100,
  total: 72,
  band: 'ok',
  showTotal: true,
  computedAt: '2026-09-20T12:00:00.000Z',
  parts: [
    { key: 'sessions', outOf: 40, points: 36, state: 'scored', reason: null, missing: null, inputs: { daysCounted: 3, target: 3, activeMinutes: 118, minutesTarget: 150 } },
    { key: 'movement', outOf: 30, points: 24, state: 'scored', reason: null, missing: null, inputs: { daysAtGoal: 5, daysWithSteps: 7, goal: 7500, goalSource: 'default' } },
    { key: 'meals', outOf: 30, points: 12, state: 'scored', reason: null, missing: null, inputs: { daysLogged: 2, needed: 3, weeksConsistent: null } },
  ],
  movedBy: [{ key: 'sessions', delta: 12, detail: { from: 24, to: 36 } }],
  ...over,
});

const calibratingScore = () => score({
  total: null,
  band: null,
  parts: [
    score().parts[0],
    { key: 'movement', outOf: 30, points: null, state: 'not_enough_data', reason: 'steps_days', missing: 2, inputs: { daysAtGoal: 1, daysWithSteps: 2, goal: 7500, goalSource: 'default' } },
    score().parts[2],
  ],
  movedBy: [],
});

const loadBlock = (over = {}) => ({
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

/* ------------------------------------------------------- the Home card */

test('the rhythm card draws seven days, fills the trained ones in ink, and names each one in full', () => {
  const html = render(h(RhythmCardView, { rhythm: rhythmView() }));
  assert.match(html, /data-testid="rhythm-card"/);
  assert.equal(count(html, 'data-counted="'), 7, 'seven cells, always');
  assert.equal(count(html, 'data-counted="true"'), 2);
  assert.equal(count(html, 'data-counted="false"'), 5);
  // The filled day is the ink ramp the training heatmap uses; the one blue on
  // Home stays with the action that wants it.
  assert.match(html, /data-counted="true"[^>]*class="[^"]*bg-text-1/);
  assert.match(html, /data-counted="false"[^>]*class="[^"]*border-line[^"]*bg-surface-2/);
  assert.ok(!html.includes('bg-brand'), 'no accent fill on the day strip');
  // A letter repeats twice a week, so each cell speaks its day and date.
  assert.ok(html.includes('Monday, Sep 14: trained'));
  assert.ok(html.includes('Tuesday, Sep 15: rest'));
  assert.ok(html.includes('Sunday, Sep 20: rest'));
  assert.ok(html.includes('2 of 3 days this week — one more keeps it.'));
  assert.ok(html.includes('5 weeks kept'));
  assert.ok(html.includes('7 weeks to 12'));
  assert.match(html, /aria-label="Days trained this week"/);
  clean(html, 'rhythm card');
});

test('the chain is absent under two weeks, and no zero reaches the card', () => {
  const one = render(h(RhythmCardView, { rhythm: rhythmView({ weeksKept: 1 }) }));
  assert.ok(!one.includes('weeks kept') && !one.includes('1 week kept'), 'one kept week is not a chain');
  assert.ok(!one.includes('data-testid="rhythm-weeks-kept"'));
  const none = render(h(RhythmCardView, { rhythm: rhythmView({ weeksKept: 0, nextMilestone: { weeks: 4, in: 4 } }) }));
  assert.ok(!none.includes('0 weeks'), 'never a zero chain');
  assert.ok(!none.includes('weeks to 4'), 'no milestone line without a chain to measure');
  clean(none, 'no chain');
});

test('the repair line shows only while the API has a rest week banked', () => {
  const empty = render(h(RhythmCardView, { rhythm: rhythmView({ restTokens: { bank: 0, max: 2 } }) }));
  assert.ok(!empty.includes('data-testid="rhythm-rest-bank"'), 'an empty bank is not an offer');
  assert.ok(!empty.includes('rest week'), 'and it is not mentioned either');
  const banked = render(h(RhythmCardView, { rhythm: rhythmView({ restTokens: { bank: 1, max: 2 } }) }));
  assert.match(banked, /data-testid="rhythm-rest-bank"/);
  assert.ok(banked.includes('1 rest week banked. A banked week covers one that comes up short.'));
  clean(banked, 'rest bank');
});

test('the Monday suggestion row appears only with a card on the rhythm, and offers Not now', () => {
  const plain = render(h(RhythmCardView, { rhythm: rhythmView() }));
  assert.ok(!plain.includes('data-testid="rhythm-suggestion"'), 'no card, no row');
  assert.ok(!plain.includes('Monday suggestion'));

  const withCard = rhythmView({
    suggestion: {
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
    },
  });
  const html = render(h(RhythmCardView, { rhythm: withCard, onSuggestion: () => {} }));
  assert.match(html, /data-testid="rhythm-suggestion"/);
  assert.ok(html.includes('Monday suggestion'));
  assert.ok(html.includes('4 weeks kept at 3 days. Move to 4?'));
  // One blue text action, and a way to decline that is not a dead end.
  assert.match(html, /class="[^"]*btn-link[^"]*"[^>]*>(?:<span[^>]*>)?Move to 4 days/);
  assert.ok(html.includes('Not now'));
  assert.ok(html.includes('How this was judged'), 'the basis is disclosable');
  assert.match(html, /aria-expanded="false"/);
  clean(html, 'suggestion');
});

test('welcome back replaces the week line, offers the API\'s repair and one dismiss', () => {
  const record = {
    id: 'wb1',
    previousActiveAt: '2026-08-01T00:00:00.000Z',
    returnedAt: '2026-09-20T00:00:00.000Z',
    idleDays: 50,
    target: { current: 3, lowerTo: 2, weeksKept: 6 },
    focusOffer: null,
    breakOffer: { weeks: 7 },
  };
  const html = render(h(RhythmCardView, { rhythm: rhythmView(), welcomeBack: record, onWelcomeBack: () => {} }));
  assert.match(html, /data-testid="rhythm-welcome-back"/);
  assert.ok(html.includes('Welcome back — 50 days since your last session. Your 6 weeks kept are still here.'));
  assert.ok(!html.includes('2 of 3 days this week'), 'the greeting takes the line\'s place');
  assert.ok(html.includes('Count 7 weeks as a break'));
  assert.equal(count(html, 'Got it'), 1, 'exactly one dismiss');
  // With nothing offered it is a greeting and a dismiss, and still not a scold.
  const bare = render(h(RhythmCardView, {
    rhythm: rhythmView(),
    welcomeBack: { ...record, breakOffer: { weeks: 0 }, target: { current: 3, lowerTo: null, weeksKept: 0 } },
    onWelcomeBack: () => {},
  }));
  assert.ok(!bare.includes('Count') && !bare.includes('Lower to'));
  assert.equal(count(bare, 'Got it'), 1);
  clean(html, 'welcome back');
  clean(bare, 'welcome back bare');
});

test('the unopened recap is one quiet row, named for the period the API listed', () => {
  const html = render(h(RhythmCardView, { rhythm: rhythmView(), recap: { id: 'r1', kind: 'week' } }));
  assert.match(html, /data-testid="rhythm-recap-row"/);
  assert.ok(html.includes('Your week in review is ready'));
  assert.ok(html.includes('href="/recaps/r1"'));
  assert.equal(recapRowCopy('week'), 'Your week in review is ready');
  assert.equal(recapRowCopy('month'), 'Your month in review is ready');
  assert.equal(recapRowCopy('year'), 'Your year in Vybe is ready');
  // The suggestion outranks the row: one secondary row at a time keeps the height fixed.
  const both = render(h(RhythmCardView, {
    rhythm: rhythmView({ suggestion: { id: 's', kind: 'lower', from: 3, to: 2, basis: [], createdAt: 'x', expiresAt: 'y' } }),
    recap: { id: 'r1', kind: 'week' },
  }));
  assert.ok(!both.includes('data-testid="rhythm-recap-row"'));
  // Only an unopened, ready recap is offered.
  const rows = [
    { _id: 'a', kind: 'week', viewedAt: '2026-09-01T00:00:00.000Z', status: 'ready' },
    { _id: 'b', kind: 'month', viewedAt: null, status: 'quiet' },
    { _id: 'c', kind: 'year', viewedAt: null, status: 'ready' },
  ];
  assert.deepEqual(newestUnviewed(rows), { id: 'c', kind: 'year' });
  assert.equal(newestUnviewed([]), null);
  assert.equal(newestUnviewed(undefined), null);
  clean(html, 'recap row');
});

test('the skeleton is the card\'s own geometry and no sentence renders before the query resolves', () => {
  const loading = render(h(RhythmCardView, { rhythm: null }));
  assert.match(loading, /data-testid="rhythm-card"/, 'the frame is reserved so the feed does not move');
  assert.ok(!loading.includes('data-testid="rhythm-days"'), 'no day strip before the days are known');
  assert.ok(!loading.includes('data-testid="rhythm-line"'), 'no line before the numbers are known');
  assert.ok(!loading.includes('weeks kept') && !loading.includes('Monday suggestion') && !loading.includes('Welcome back'));
  assert.equal(count(loading, 'skeleton'), 4, 'one block per row of the card: header, strip, line, slot');
  // The four fixed rows are the same heights in both states, so nothing shifts.
  for (const geometry of ['min-h-12', 'h-10', 'h-14']) {
    assert.ok(loading.includes(geometry), geometry);
    assert.ok(render(h(RhythmCardView, { rhythm: rhythmView() })).includes(geometry), `${geometry} when ready`);
  }
  clean(loading, 'skeleton');
});

test('the Vybe score is the card\'s one big number and links to Progress', () => {
  const html = render(h(RhythmCardView, { rhythm: rhythmView(), score: score() }));
  assert.match(html, /data-testid="rhythm-score"/);
  assert.ok(html.includes('href="/workouts/progress"'));
  assert.ok(html.includes('Vybe score'));
  assert.ok(html.includes('72'));
  assert.ok(html.includes('of 100'));
  assert.ok(html.includes('OK'));
  assert.match(html, /aria-label="Vybe score 72 of 100\. Open Progress"/);
  // No score, no number: the header is the title and the chain.
  const without = render(h(RhythmCardView, { rhythm: rhythmView() }));
  assert.ok(!without.includes('data-testid="rhythm-score"'));
  assert.ok(!without.includes('Vybe score'));
  clean(html, 'home score');
});

/* -------------------------------------------------------- the Vybe score */

test('the score headline prints the API total with its band as a word, never a colour', () => {
  const html = render(h(VybeScoreMetric, { headline: insights.scoreHeadline(score()) }));
  assert.match(html, /data-calibrating="false"/);
  assert.ok(html.includes('72') && html.includes('of 100'));
  assert.match(html, /data-testid="vybe-score-band"[^>]*>OK</);
  assert.match(html, /class="[^"]*t-metric/, 'the one place type gets big');
  // The band is ink, not a semantic colour.
  assert.match(html, /class="text-text-1[^"]*" data-testid="vybe-score-band"/);
  clean(html, 'score headline');
});

test('a calibrating score shows the API\'s exact gap in the number\'s place, never a 0', () => {
  const headline = insights.scoreHeadline(calibratingScore());
  const html = render(h(VybeScoreMetric, { headline }));
  assert.match(html, /data-calibrating="true"/);
  assert.ok(html.includes('Calibrating'));
  assert.ok(!html.includes('of 100'), 'no budget while there is no total');
  assert.ok(!/>0</.test(html), 'never a zero');
  assert.ok(!html.includes('data-testid="vybe-score-band"'), 'no band without a total');
  assert.ok(!html.includes('t-metric'), 'a word does not take the metric size');
  const card = render(h(InsightsCard, { score: calibratingScore() }));
  assert.ok(card.includes('Log steps on 2 more days, or connect the Health app.'), 'the gap is the API\'s, to the day');
  clean(html, 'calibrating');
  clean(card, 'calibrating card');
});

test('the parts list shows the inputs each number came from, and "Off" instead of a zero', () => {
  const html = render(h(VybeScoreParts, { score: score() }));
  assert.match(html, /data-testid="vybe-score-parts"/);
  for (const label of ['Sessions', 'Movement', 'Meals']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('36 of 40') && html.includes('24 of 30') && html.includes('12 of 30'));
  assert.ok(html.includes('3 days of 3 · 118 of 150 min'));
  assert.ok(html.includes('5 days at 7,500 steps or more'));
  assert.ok(html.includes('Vybe default'));
  const off = render(h(VybeScoreParts, { score: score({ outOf: 70, parts: [score().parts[0], score().parts[1], { key: 'meals', outOf: 0, points: null, state: 'off', reason: null, missing: null, inputs: {} }] }) }));
  assert.match(off, /data-state="off"/);
  assert.ok(off.includes('Off'));
  assert.ok(off.includes('No meals logged in 28 days. Log one and this part scores.'));
  assert.ok(!off.includes('0 of 0'), 'an off part is not a zero score');
  clean(html, 'parts');
  clean(off, 'parts off');
});

test('the profile row is "Vybe score · 72 · OK" with the About trigger, and nothing ranked', () => {
  const html = render(h(VybeScoreRow, { headline: insights.scoreHeadline(score()), onAbout: () => {} }));
  assert.match(html, /data-testid="vybe-score-row"/);
  assert.ok(html.includes('Vybe score'));
  assert.ok(html.includes('72') && html.includes('OK'));
  assert.ok(html.includes('About this score'));
  assert.match(html, /aria-haspopup="dialog"/);
  assert.ok(!html.includes('t-metric'), 'a profile row is not a hero metric');
  assert.doesNotMatch(html, /\brank|\bout of \d+ (people|members)/i);
  clean(html, 'profile row');
});

/* ------------------------------------------------------ Progress insights */

test('the insights card discloses the score, its parts and the one comparison as hint text', () => {
  const html = render(h(InsightsCard, { score: score(), onAbout: () => {} }));
  assert.match(html, /data-testid="insights-card"/);
  assert.ok(html.includes('Vybe score'));
  assert.ok(html.includes('This week'), 'the eyebrow names the window the API scored');
  assert.ok(html.includes('72'));
  assert.match(html, /data-testid="vybe-score-parts"/);
  assert.match(html, /data-testid="insights-moved"/);
  assert.ok(html.includes('Sessions +12 points vs your previous week'));
  assert.ok(html.includes('About this score'));
  // Nothing invented: no sentence beyond the API's own comparison.
  assert.ok(!html.includes('great') && !html.includes('keep it up'));
  clean(html, 'insights card');

  // A first window compares with nothing, and says nothing.
  const first = render(h(InsightsCard, { score: score({ movedBy: [] }) }));
  assert.ok(!first.includes('data-testid="insights-moved"'));
  // No score at all: the card is absent, not empty.
  assert.equal(render(h(InsightsCard, { score: null })), '');
  // The skeleton keeps the card's shape while the read is in flight.
  const loading = render(h(InsightsCard, { score: null, loading: true }));
  assert.match(loading, /aria-busy="true"/);
  assert.ok(!loading.includes('72'));
  clean(loading, 'insights skeleton');
});

test('the focus row shows the server\'s own label, and exists only while the flag is on', () => {
  const off = render(h(InsightsCard, { score: score() }));
  assert.ok(!off.includes('data-testid="insights-focus-row"'));
  const on = render(h(InsightsCard, { score: score(), focusEnabled: true, focus: { kind: 'recover', label: 'Recover', eventDate: null, setAt: null, note: null }, onEditFocus: () => {} }));
  assert.match(on, /data-testid="insights-focus-row"/);
  assert.ok(on.includes('This week’s focus'));
  assert.ok(on.includes('Recover'), 'the API\'s label, not one derived here');
  const none = render(h(InsightsCard, { score: score(), focusEnabled: true, focus: null, onEditFocus: () => {} }));
  assert.ok(none.includes('Choose one'), 'no focus is an invitation, not a blank');
  clean(on, 'focus row');
});

test('training load renders the server\'s sentence and a bar per week, with no y-axis', () => {
  const html = render(h(TrainingLoad, { load: loadBlock() }));
  assert.match(html, /data-testid="training-load"/);
  assert.ok(html.includes('This week is steady with your usual.'));
  assert.equal(count(html, 'data-testid="training-load-bar"'), 4, 'one bar per week the API sent');
  assert.ok(html.includes('Week 37: 640 load from 3 sessions'));
  assert.ok(html.includes('Week 35: no sessions'));
  assert.ok(html.includes('Week 38: 1 session, no load yet'));
  assert.match(html, /data-load="unknown"/, 'a week the API could not total is not a zero');
  assert.ok(html.includes('Your usual is the average of the last four weeks.'));
  // The numbers are a disclosure, not the headline.
  assert.ok(html.includes('Show numbers'));
  assert.ok(!html.includes('Ratio 1.08'), 'closed by default');
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes('bg-brand'), 'no accent fill on the strip');
  clean(html, 'training load');
});

test('training load is absent for a minor, and says the API\'s gap when it is short', () => {
  assert.equal(render(h(TrainingLoad, { load: loadBlock({ state: 'off', label: null, reason: 'age', weekly: [] }) })), '', 'off for a minor is no card at all');
  assert.equal(render(h(TrainingLoad, { load: null })), '');
  const short = render(h(TrainingLoad, { load: loadBlock({ state: 'not_enough_data', label: null, reason: 'rate_sessions', missing: 2, weekly: [] }) }));
  assert.ok(short.includes('Rate 2 more sessions to see this week against your usual.'));
  assert.ok(!short.includes('data-testid="training-load-bars"'), 'no strip without a series');
  assert.ok(!short.includes('Show numbers'), 'nothing to disclose');
  const offer = render(h(TrainingLoad, { load: loadBlock({ label: 'well_above', offer: 'lighter_session' }) }));
  assert.ok(offer.includes('Want a lighter session today?'));
  assert.doesNotMatch(offer, /risk|injury|overtraining|danger/i);
  clean(short, 'load short');
  clean(offer, 'load offer');
});

/* ------------------------------------------------------- Year in Vybe */

const yearRecap = (over = {}) => ({
  _id: 'y1',
  kind: 'year',
  periodKey: '2026',
  periodLabel: '2026',
  periodStart: '2026-01-01T05:00:00.000Z',
  periodEnd: '2027-01-01T05:00:00.000Z',
  timezone: 'America/New_York',
  timezoneOffsetMinutes: 300,
  status: 'ready',
  final: true,
  version: 1,
  generatedAt: '2027-01-05T12:00:00.000Z',
  viewedAt: null,
  shares: [],
  summary: { sessions: 140, minutes: 7100, prCount: 2 },
  data: {
    sessions: 140,
    importedSessions: 3,
    minutes: 7100,
    volumeKg: 400000,
    activeDays: [],
    activeDayCount: 118,
    byDay: [],
    byMonth: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, sessions: i === 8 ? 18 : i * 2, minutes: i * 90 })),
    prs: [{ exerciseId: 'bench', name: 'Bench press', type: 'heaviestWeightKg', value: 100, unit: 'kg', previousValue: 95 }],
    topExercises: [{ exerciseId: 'bench', name: 'Bench press', sessions: 40, sets: 160 }],
    weeksKept: { count: 41, targetDays: 3 },
    gyms: null,
    buddies: null,
    previous: { sessions: 120, minutes: 6000, volumeKg: 350000, activeDays: 100, prs: 1 },
    progress: null,
  },
  ...over,
});

test('the year body draws twelve months, every one present, and the totals keep their boxes', () => {
  const months = render(h(RecapYearMonths, { recap: yearRecap() }));
  assert.match(months, /data-testid="recap-year-months"/);
  assert.equal(count(months, 'data-testid="recap-year-bar"'), 12, 'the year\'s shape is the point');
  assert.ok(months.includes('September: 18 sessions'));
  assert.ok(months.includes('January: no sessions'));
  assert.ok(months.includes('118 active days'), 'a year lists no days, so the count comes from activeDayCount');
  for (const label of ['Jan', 'Sep', 'Dec']) assert.ok(months.includes(`>${label}<`), label);
  assert.match(months, /aria-label="Sessions by month"/);
  assert.ok(!months.includes('bg-brand'), 'no accent fill on the strip');
  clean(months, 'year months');

  const totals = render(h(RecapYearTotals, { recap: yearRecap(), unit: 'kg' }));
  assert.match(totals, /data-testid="recap-year-totals"/);
  assert.ok(totals.includes('140') && totals.includes('118 h 20 min') && totals.includes('400,000 kg'));
  assert.match(totals, /class="[^"]*t-metric/, 'the year\'s numbers are the hero metric');
  // Nothing there: the next action in the number's place, never a zero.
  const bare = yearRecap();
  const empty = render(h(RecapYearTotals, { recap: { data: { ...bare.data, sessions: 0, minutes: 0, volumeKg: 0, prs: [] } }, unit: 'kg' }));
  assert.ok(empty.includes('Log a session') && empty.includes('Log some sets') && empty.includes('Beat a best'));
  assert.ok(!empty.includes('>0<') && !empty.includes('0 kg'));
  clean(totals, 'year totals');
  clean(empty, 'year totals empty');
});

test('the year body compares with last year behind the toggle, and locks by the API\'s own count', () => {
  const html = render(h(RecapBody, { recap: yearRecap(), unit: 'kg' }));
  assert.match(html, /data-testid="recap-body" data-status="ready"/);
  assert.ok(html.includes('Compare with last year'));
  assert.ok(!html.includes('vs last year'), 'no comparison until the member asks');
  assert.ok(html.includes('Bests you set this year.'));
  assert.ok(html.includes('41 weeks kept · 3+ days a week'));
  assert.ok(!html.includes('data-testid="recap-weekday-header"'), 'a year has no day grid');
  clean(html, 'year body');

  const locked = render(h(RecapBody, {
    recap: yearRecap({ status: 'locked', final: false, data: { ...yearRecap().data, sessions: 5, previous: null, progress: { sessions: 5, needed: 12, unlocksOn: '2026-12-31' } } }),
    unit: 'kg',
  }));
  assert.ok(locked.includes('This year is still locked'));
  assert.ok(locked.includes('5 of 12 sessions so far. Unlocks on Dec 31 with 12 sessions or more.'));
  assert.ok(locked.includes('once the year closes'));
  assert.ok(!locked.includes('12-session'), 'the floor is the API\'s number, never spelled as a rule here');
  assert.match(locked, /aria-valuemax="12"/);
  clean(locked, 'year locked');
});

test('a week and a month render exactly as they did: the year branch is additive', () => {
  const weekRecap = {
    ...yearRecap(),
    kind: 'week',
    periodLabel: 'Sep 14–20, 2026',
    data: {
      ...yearRecap().data,
      sessions: 4,
      minutes: 192,
      volumeKg: 14200,
      activeDays: ['2026-09-14', '2026-09-16'],
      activeDayCount: 2,
      byDay: [
        { date: '2026-09-14', sessions: 1, minutes: 50 },
        { date: '2026-09-15', sessions: 0, minutes: 0 },
      ],
      byMonth: [],
      weeksKept: { count: 8, targetDays: 3 },
    },
  };
  const html = render(h(RecapBody, { recap: weekRecap, unit: 'kg' }));
  assert.ok(!html.includes('data-testid="recap-year-months"'));
  assert.ok(!html.includes('data-testid="recap-year-totals"'));
  assert.ok(html.includes('Compare with last week'));
  assert.ok(html.includes('Monday, Sep 14: 1 session, 50 min'));
  assert.ok(html.includes('Bests you set this week.'));
  assert.ok(html.includes('2 active days'));
  clean(html, 'week body');
});
