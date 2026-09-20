/** The recap viewer: RecapBody renders the API's recap in the viewer's unit; the routes, nav and API calls are pinned in source. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { RecapBody, RecapHeadline } = await import('../src/pages/RecapBody.tsx');
const { compareDeltas, recapHeadline } = await import('../src/lib/recapView.ts');

const byDay = ['14', '15', '16', '17', '18', '19', '20'].map((d, i) => ({ date: `2026-09-${d}`, sessions: [1, 0, 1, 1, 0, 1, 0][i], minutes: [50, 0, 48, 44, 0, 50, 0][i] }));

const readyWeek = {
  _id: '6aad635402be1805f4b9ef72',
  kind: 'week',
  periodKey: '2026-W38',
  periodLabel: 'Sep 14–20, 2026',
  periodStart: '2026-09-14T04:00:00.000Z',
  periodEnd: '2026-09-21T04:00:00.000Z',
  timezone: 'America/New_York',
  timezoneOffsetMinutes: 240,
  status: 'ready',
  final: true,
  version: 1,
  generatedAt: '2026-09-21T11:00:03.000Z',
  viewedAt: null,
  shares: [],
  summary: { sessions: 4, minutes: 192, prCount: 1 },
  data: {
    sessions: 4,
    minutes: 192,
    volumeKg: 14200,
    activeDays: ['2026-09-14', '2026-09-16', '2026-09-17', '2026-09-19'],
    byDay,
    prs: [{ exerciseId: 'bench', name: 'Bench press', type: 'heaviestWeightKg', value: 100, unit: 'kg', previousValue: 95, workoutId: '6aad635402be1805f4b9ef99' }],
    topExercises: [{ exerciseId: 'bench', name: 'Bench press', sessions: 3, sets: 12 }, { name: 'Squat', sessions: 2, sets: 8 }],
    weeksKept: { count: 8, targetDays: 3 },
    gyms: null,
    buddies: null,
    previous: { sessions: 3, minutes: 150, volumeKg: 12000 },
    progress: null,
  },
};

const lockedMonth = {
  ...readyWeek,
  _id: '6aad635402be1805f4b9ef73',
  kind: 'month',
  periodKey: '2026-09',
  periodLabel: 'September 2026',
  status: 'locked',
  final: false,
  data: {
    ...readyWeek.data,
    sessions: 2,
    minutes: 90,
    volumeKg: 6000,
    prs: [],
    weeksKept: null,
    previous: null,
    progress: { sessions: 2, needed: 3, unlocksOn: '2026-09-26' },
  },
};

const quietWeek = {
  ...readyWeek,
  _id: '6aad635402be1805f4b9ef74',
  periodKey: '2026-W37',
  periodLabel: 'Sep 7–13, 2026',
  status: 'quiet',
  summary: { sessions: 0, minutes: 0, prCount: 0 },
  data: { ...readyWeek.data, sessions: 0, minutes: 0, volumeKg: 0, activeDays: [], byDay: byDay.map((d) => ({ ...d, sessions: 0, minutes: 0 })), prs: [], topExercises: [], weeksKept: null, previous: null },
};

const render = (recap, unit) => renderToString(h(MemoryRouter, null, h(RecapBody, { recap, unit })));

test('a ready week shows the period numbers in the viewer unit, the records and the most trained list', () => {
  const html = render(readyWeek, 'lb');
  for (const text of ['3 h 12 min', '31,306 lb', 'Bench press', 'Heaviest weight', '209.4 lb → 220.5 lb', 'aria-label="Most trained"', 'aria-label="Records"', 'aria-label="Sessions by day"', '4 active days', '8 weeks kept · 3+ days a week', '3 sessions · 12 sets']) {
    assert.ok(html.includes(text), `ready week shows ${text}`);
  }
  assert.ok(!html.includes('>Gyms<') && !html.includes('aria-label="Gyms"'), 'no Gyms section when the API sent null');
  assert.ok(!html.includes('>Buddies<') && !html.includes('aria-label="Buddies"'), 'no Buddies section when the API sent null');
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('undefined'));
  assert.ok(render(readyWeek, 'kg').includes('14,200 kg'), 'metric viewers see kilograms');
  // Each day cell carries its description as screen-reader text, not as aria-label on a static <li>.
  assert.match(html, /<span class="sr-only">Monday, Sep 14: 1 session, 50 min<\/span>/);
  assert.ok(!html.includes('aria-label="Monday, Sep 14'), 'no aria-label on the day cell');
  assert.match(html, /<li title="Tuesday, Sep 15: rest"/);
  // A week grid names its weekdays in the cells, so it has no header row.
  assert.ok(!html.includes('data-testid="recap-weekday-header"'));
});

test('the comparison is closed by default and opens behind an expanded toggle', () => {
  const closed = render(readyWeek, 'lb');
  assert.ok(!closed.includes('vs last week'), 'no delta until the member asks');
  assert.match(closed, /<button[^>]*aria-expanded="false"[^>]*data-testid="recap-compare-toggle"[^>]*>/);
  assert.ok(closed.includes('Compare with last week'));
  assert.ok(!closed.includes('Hide comparison'));

  const stats = recapHeadline(readyWeek.data, 'lb');
  const deltas = compareDeltas(readyWeek.data, 'lb', 'week');
  const open = renderToString(h(RecapHeadline, { stats, deltas, kind: 'week', compareOpen: true, onToggleCompare: () => {} }));
  assert.ok(open.includes('vs last week'));
  assert.ok(open.includes('+1') && open.includes('+42 min') && open.includes('+4,850 lb'));
  assert.ok(open.includes('Hide comparison'));
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /aria-controls="([^"]+)"/);
  const controls = /aria-controls="([^"]+)"/.exec(open)[1];
  assert.ok(open.includes(`id="${controls}"`), 'the toggle points at the tile grid');

  const shut = renderToString(h(RecapHeadline, { stats, deltas, kind: 'week', compareOpen: false, onToggleCompare: () => {} }));
  assert.ok(!shut.includes('vs last week'));
  // Nothing to compare with, no toggle.
  const none = renderToString(h(RecapHeadline, { stats, deltas: {}, kind: 'week', compareOpen: false, onToggleCompare: () => {} }));
  assert.ok(!none.includes('recap-compare-toggle'));
});

test('a locked month explains the unlock rule from the API progress block and cannot be shared yet', () => {
  const html = render(lockedMonth, 'kg');
  assert.ok(html.includes('2 of 3 sessions so far. Unlocks on Sep 26 with 3 sessions or more.'));
  assert.ok(html.includes('This recap unlocks later in the month. Share it once it is ready.'));
  assert.match(html, /role="progressbar"[^>]*aria-valuemax="3"/);
  assert.ok(!html.includes('vs last month'), 'no comparison on a locked month');
  assert.ok(!html.includes('recap-compare-toggle'), 'nothing to compare with on a locked month');
  assert.ok(!html.includes('26th'), 'the unlock day is never hard-coded');
  // A month grid gets a Monday-first weekday header so the leading offset reads as calendar, not as a gap.
  assert.match(html, /<div aria-hidden="true" class="[^"]*grid-cols-7[^"]*" data-testid="recap-weekday-header">/);
  for (const weekday of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) assert.ok(html.includes(`>${weekday}</span>`), `header shows ${weekday}`);
  assert.ok(html.indexOf('recap-weekday-header') < html.indexOf('aria-label="Sessions by day"'), 'the header sits above the grid');
});

test('a quiet week says so plainly and compares to nothing', () => {
  const html = render(quietWeek, 'lb');
  assert.ok(html.includes('A quiet week. The next one is a fresh start.'));
  assert.ok(!html.includes('vs last week'));
  assert.ok(!html.includes('recap-compare-toggle'));
  assert.ok(!html.includes('0 lb') && !html.includes('0 kg'), 'no zero volume stat');
  assert.ok(!html.includes('NaN'));
});

test('gyms and buddies render only when the API sent a non-empty list', () => {
  const withBlocks = {
    ...readyWeek,
    data: {
      ...readyWeek.data,
      gyms: [{ communityId: '6aad635402be1805f4b9ef80', name: 'Iron Works', visits: 3 }],
      buddies: [{ userId: '6aad635402be1805f4b9ef81', username: 'sam', fullName: 'Sam Rivera', sessions: 2 }],
    },
  };
  const html = render(withBlocks, 'kg');
  assert.ok(html.includes('aria-label="Gyms"') && html.includes('Iron Works') && html.includes('3 visits'));
  assert.ok(html.includes('aria-label="Buddies"') && html.includes('Sam Rivera') && html.includes('2 sessions together'));
  assert.ok(html.includes('href="/u/6aad635402be1805f4b9ef81"'));
  const empty = render({ ...readyWeek, data: { ...readyWeek.data, gyms: [], buddies: [] } }, 'kg');
  assert.ok(!empty.includes('aria-label="Gyms"') && !empty.includes('aria-label="Buddies"'));
});

test('the viewer routes, nav entries and API calls are wired', () => {
  const app = read('src/App.tsx');
  assert.match(app, /path="recaps"/);
  assert.match(app, /path="recaps\/:id"/);
  assert.match(app, /import\('\.\/pages\/Recaps'\)/);
  assert.match(app, /import\('\.\/pages\/RecapDetail'\)/);

  const layout = read('src/components/Layout.tsx');
  assert.match(layout, /pattern: '\/recaps'/);
  assert.match(layout, /pattern: '\/recaps\/:id'/);
  assert.match(layout, /to: '\/recaps', label: 'Recaps'/);

  const detail = read('src/pages/RecapDetail.tsx');
  assert.match(detail, /api\.get\(`\/recaps\/\$\{id\}`\)/);
  assert.match(detail, /api\.post\(`\/recaps\/\$\{id\}\/viewed`\)/);
  assert.match(detail, /api\.post\(`\/recaps\/\$\{id\}\/shared`, \{ destination: 'vybe', variant: 'feed' \}\)/);
  assert.match(detail, /api\.post\('\/posts\/create'/);
  assert.match(detail, /navigate\(`\/p\/\$\{post\._id\}`/);
  // The post is created before the share is recorded, never the other way round.
  assert.ok(detail.indexOf("api.post('/posts/create'") < detail.indexOf('api.post(`/recaps/${id}/shared`'));
  // Viewed fires once, only while viewedAt is null.
  assert.match(detail, /viewedAt/);
  assert.match(detail, /useRef/);
  // Weights are opt-in on a web share: off when the dialog opens, one switch, only when the card would show volume.
  assert.match(detail, /const \[includeWeights, setIncludeWeights\] = useState\(false\)/);
  assert.match(detail, /setIncludeWeights\(false\);\s*setShareOpen\(true\)/);
  assert.match(detail, /hiddenFields: shareHiddenFields\(includeWeights\)/);
  assert.match(detail, /\{offersWeights\(recap\.data\) \? \(\s*<Checkbox/);
  assert.match(detail, /description=\{shareDescription\(recap\)\}/);
  assert.match(detail, /placeholder=\{captionPlaceholder\(recap\.kind\)\}/);
  assert.ok(!detail.includes('Hide gyms') && !detail.includes('Hide buddies') && !detail.includes('HIDDEN_FIELDS.map'), 'no switch that changes nothing');

  const list = read('src/pages/Recaps.tsx');
  assert.match(list, /api\.get\('\/recaps\/current'/);
  assert.match(list, /api\.get\('\/recaps',/);
  assert.match(list, /limit: 20/);
  assert.match(list, /browserTimeZone\(\)/);
  assert.match(list, /localDayParams\(\)/);
  assert.match(list, /dedupeHistory\(/);
  assert.match(list, /aria-label=\{historyRowLabel\(row\)\}/);

  // The author-only link on shared recap cards is decided client-side (the API never says 403 on GET /recaps/:id).
  assert.match(read('src/pages/PostCard.tsx'), /to=\{isOwn \? `\/recaps\/\$\{post\.recapSummary\.recapId\}` : null\}/);
  const publicPost = read('src/pages/PublicPost.tsx');
  assert.match(publicPost, /<RecapSummaryCard summary=\{post\.recapSummary\} className="mt-3" \/>/);

  // weekly_recap / monthly_recap inbox rows open the viewer, not the member's own profile
  // (notificationCopy is what pages/Notifications.tsx imports; notificationRoutes is kept in step).
  assert.match(read('src/lib/notificationCopy.ts'), /idOf\(d\.recapId\)/);
  assert.match(read('src/lib/notificationRoutes.ts'), /idOf\(d\.recapId\)/);
});

test('the shared recap card links to the viewer only when asked to', async () => {
  const { RecapSummaryCard } = await import('../src/pages/RecapSummaryCard.tsx');
  const summary = { recapId: '6aad635402be1805f4b9ef72', kind: 'week', periodKey: '2026-W38', periodLabel: 'Sep 14–20, 2026', sessions: 4, minutes: 192, volumeKg: 14200, prCount: 1, topExercises: ['Bench press'], hiddenFields: [] };
  const linked = renderToString(h(MemoryRouter, null, h(RecapSummaryCard, { summary, to: '/recaps/6aad635402be1805f4b9ef72' })));
  assert.match(linked, /href="\/recaps\/6aad635402be1805f4b9ef72"/);
  assert.ok(linked.includes('View recap'));
  assert.match(linked, /aria-label="Weekly recap: Sep 14–20, 2026"/);
  assert.match(linked, /data-testid="recap-summary-card"/);
  const plain = renderToString(h(MemoryRouter, null, h(RecapSummaryCard, { summary, to: null })));
  assert.ok(!plain.includes('View recap') && !plain.includes('href="/recaps/'));
  const omitted = renderToString(h(MemoryRouter, null, h(RecapSummaryCard, { summary })));
  assert.ok(!omitted.includes('View recap'));
});
