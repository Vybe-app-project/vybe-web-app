/** The recap share card on posts: viewer's unit, hidden volume never resurfaces, wired into cards. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const lib = await import('../src/lib/recapSummary.ts');
const LB = 0.45359237;
const week = { recapId: '6aad635402be1805f4b9ef72', kind: 'week', periodKey: '2026-W37', periodLabel: 'Sep 7–13, 2026', sessions: 4, minutes: 250, volumeKg: 21000 * LB, prCount: 2, topExercises: ['Bench press', 'Squat', 'Row'], hiddenFields: [] };
const month = { recapId: '6aad635402be1805f4b9ef73', kind: 'month', periodKey: '2026-08', periodLabel: 'August 2026', sessions: 15, minutes: 900, prCount: 0, topExercises: [], weeksKept: 4, hiddenFields: ['weights'] };

test('stats follow the viewer unit and skip hidden or empty numbers', () => {
  assert.deepEqual(lib.recapStats(week, 'lb').map((s) => [s.key, s.value]), [['sessions', '4'], ['time', '4 h 10 min'], ['volume', '21,000 lb'], ['prs', '2']]);
  assert.deepEqual(lib.recapStats(week, 'kg').map((s) => s.value)[2], '9,525 kg');
  // weights hidden (server dropped volumeKg), no PRs, month shows weeks kept
  assert.deepEqual(lib.recapStats(month, 'kg').map((s) => [s.key, s.value]), [['sessions', '15'], ['time', '15 h'], ['weeks', '4']]);
  assert.deepEqual(lib.recapStats({ ...week, sessions: 0, minutes: 0, volumeKg: 0, prCount: 0 }, 'kg'), []);
  assert.equal(lib.recapKindLabel('week'), 'Weekly recap');
  assert.equal(lib.recapKindLabel('month'), 'Monthly recap');
  // v2-be-h9-recaps-year: buildPostRecapSummary passes `kind: 'year'` through,
  // so a shared Year in Vybe card is a card the web renders, not one it drops.
  assert.equal(lib.recapKindLabel('year'), 'Year in Vybe');
  assert.equal(lib.hasRecapSummary(week), true);
  assert.equal(lib.hasRecapSummary({ recapId: 'x', kind: 'year' }), true);
  assert.equal(lib.hasRecapSummary({ recapId: 'x', kind: 'decade' }), false);
  assert.equal(lib.hasRecapSummary({ kind: 'year' }), false, 'a card without a recapId is not a card');
  assert.equal(lib.hasRecapSummary(null), false);
  // Weeks kept means something over a month or a year, never over one week.
  const year = { ...month, kind: 'year', periodKey: '2026', periodLabel: '2026', weeksKept: 41 };
  assert.deepEqual(lib.recapStats(year, 'kg').map((s) => [s.key, s.value]), [['sessions', '15'], ['time', '15 h'], ['weeks', '41']]);
  assert.ok(!lib.recapStats({ ...week, weeksKept: 4 }, 'kg').some((s) => s.key === 'weeks'));
});

test('the card renders the period, the numbers and the most trained exercises', async () => {
  const { createElement: h } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { RecapSummaryCard } = await import('../src/pages/RecapSummaryCard.tsx');
  // The recap has no unit of its own: the viewer's units setting decides. Under
  // renderToString zustand serves the store's initial snapshot (setState is not
  // seen), so the card shows whichever unit the store started with; the unit
  // rule itself is pinned by recapStats above.
  const html = renderToString(h(MemoryRouter, null, h(RecapSummaryCard, { summary: week })));
  assert.match(html, /aria-label="Weekly recap: Sep 7–13, 2026"/);
  assert.ok(html.includes('9,525 kg') || html.includes('21,000 lb'), 'volume prints in the viewer unit');
  for (const text of ['4 h 10 min', 'Bench press', 'Squat', 'Row']) assert.ok(html.includes(text), `card shows ${text}`);
  const quiet = renderToString(h(MemoryRouter, null, h(RecapSummaryCard, { summary: { ...week, sessions: 0, minutes: 0, volumeKg: 0, prCount: 0, topExercises: [] } })));
  assert.ok(quiet.includes('A quiet stretch.'));
  assert.ok(!html.includes('NaN') && !quiet.includes('NaN'));
});

test('feed cards and the public post page render the recap card after the workout card', () => {
  for (const source of [read('src/pages/PostCard.tsx'), read('src/pages/PublicPost.tsx')]) {
    // PostCard adds an author-only `to=` after className; PublicPost never does.
    assert.match(source, /hasRecapSummary\(post\.recapSummary\) \? <RecapSummaryCard summary=\{post\.recapSummary\} className="mt-3"[^>]*\/> : null/);
    assert.ok(source.indexOf('<WorkoutSummaryCard summary') < source.indexOf('<RecapSummaryCard summary'));
    assert.ok(source.indexOf('<RecapSummaryCard summary') < source.indexOf('<PostContent text={post.content}'));
  }
  assert.match(read('src/lib/hooks.ts'), /recapSummary\?: RecapSummary;/);
});
