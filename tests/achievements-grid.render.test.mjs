/**
 * The achievement card grid under react-dom/server: Claim hidden under the
 * flag, Awarded vs Earned, New markers, retired rows, the weeksKept unit and
 * explainer, and the category sections.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { AchievementGrid, detailsButtonId, earnedLine, groupByCategory } = await import('../src/pages/AchievementCard.tsx');
const { seed } = await import('./achievements-seed.mjs');

const noop = () => {};
const render = (items, claimAllowed, extra = {}) =>
  renderToString(h(MemoryRouter, null, h(AchievementGrid, { items, claimAllowed, onClaim: noop, onOpen: noop, ...extra })));

const byName = (rows, name) => rows.find((r) => r.name === name);
const rows = seed();
const met = { ...byName(rows, 'ten-likes-received'), canClaim: true, isEarned: false, progress: 10, required: 10, progressPercentage: 100 };
const backfill = byName(rows, 'first-workout');
const auto = byName(rows, 'ten-workouts');
const fourWeeks = byName(rows, 'four-weeks-kept');

test('under auto-award a met row shows progress and Criteria met, never Claim; with the flag off Claim appears', () => {
  const flagOn = render([met], false);
  assert.ok(!flagOn.includes('Claim reward'), 'no Claim control under the flag');
  assert.match(flagOn, /role="progressbar"/);
  assert.match(flagOn, /aria-valuenow="100"/);
  assert.ok(flagOn.includes('Criteria met'));
  assert.ok(flagOn.includes('10 / 10 kudos received'));
  assert.ok(flagOn.includes('Details'));
  const flagOff = render([met], true);
  assert.ok(flagOff.includes('Claim reward'));
  // An earned row never offers Claim, whatever the flag says.
  assert.ok(!render([auto], true).includes('Claim reward'));
});

test('a backfilled award reads Awarded without a date; an auto award reads Earned with its date and New until acked', () => {
  const back = render([backfill], false);
  assert.ok(back.includes('Awarded'));
  assert.ok(!back.includes('Sep 1, 2026'), 'backfill shows no date');
  assert.ok(!back.includes('Aug 31, 2026'));
  assert.match(back, /aria-label="Earned"/);
  assert.ok(!/>New</.test(back), 'backfill is never New');
  assert.equal(earnedLine(backfill), 'Awarded');

  const fresh = render([auto], false);
  assert.ok(fresh.includes('Earned Sep 12, 2026'));
  assert.match(fresh, />New</);
  assert.equal(earnedLine(auto), 'Earned Sep 12, 2026');
  const acked = render([{ ...auto, ackedAt: '2026-09-12T12:05:00.000Z' }], false);
  assert.ok(acked.includes('Earned Sep 12, 2026'));
  assert.ok(!/>New</.test(acked), 'acked award is no longer New');
  // Legacy earned rows (no awardedBy) fall back to the date, then to "recently".
  assert.equal(earnedLine({ ...auto, awardedBy: undefined }), 'Earned Sep 12, 2026');
  assert.equal(earnedLine({ ...auto, awardedBy: 'claim', earnedAt: null }), 'Earned recently');
  assert.equal(earnedLine({ ...auto, isEarned: false }), '');
});

test('retired rows appear only when already earned', () => {
  const html = render(rows, false);
  assert.ok(!html.includes('Energy in Motion'), 'retired unearned row is absent');
  assert.ok(html.includes('Three-Day Rhythm'), 'retired earned row stays');
  assert.ok(html.includes('Consistency'), 'its category section renders');
  const none = render(seed({ retiredEarned: false }), false);
  assert.ok(!none.includes('Three-Day Rhythm'));
  assert.ok(!none.includes('Consistency'));
});

test('four-weeks-kept shows the Rhythm unit and its explainer', () => {
  const html = render([fourWeeks], false);
  assert.ok(html.includes('1 / 4 weeks kept'));
  assert.ok(html.includes('Weeks kept counts weeks in a row in which you met your Weekly Rhythm target.'));
  assert.ok(html.includes('25%'));
  assert.ok(!html.includes('Claim reward'));
  const one = render([{ ...fourWeeks, criteria: { type: 'weeksKept', value: 1 }, required: 1, progress: 0, progressPercentage: 0 }], false);
  assert.ok(one.includes('0 / 1 week kept'));
});

test('the grid groups by category in display order with per-group earned counts and labelled card targets', () => {
  const html = render(rows, false);
  const training = html.indexOf('Training');
  const milestones = html.indexOf('Milestones');
  const community = html.indexOf('Community');
  assert.ok(training > -1 && milestones > training && community > milestones, 'Training, then Milestones, then Community');
  assert.ok(html.includes('2/3 earned'), 'Training: two of three earned');
  assert.ok(html.includes('0/3 earned'), 'Milestones: none earned, retired row excluded');
  assert.ok(html.includes('1/5 earned'), 'Community: one of five earned');
  assert.match(html, /aria-label="First Move: details"/);
  // The details target carries a stable id, so focus can land on it after Claim replaces itself.
  assert.equal(detailsButtonId(backfill._id), `achievement-${backfill._id}-details`);
  assert.ok(html.includes(`id="${detailsButtonId(backfill._id)}" aria-label="First Move: details"`), 'details button id precedes its label');
  assert.equal(new Set(html.match(/id="achievement-[0-9a-f]{24}-details"/g)).size, 12, 'one id per visible card');
  assert.match(html, /aria-label="Four weeks kept progress"/);
  const catalogue = render(rows, false, { showEarnedCounts: false });
  assert.ok(catalogue.includes('3 badges'));
  assert.ok(!catalogue.includes('earned<'));
  assert.deepEqual(groupByCategory(rows).map(([c, list]) => [c, list.length]), [['workout', 3], ['milestone', 3], ['streak', 1], ['social', 5]]);
  // Criteria met rows lead their group.
  const social = groupByCategory(rows).find(([c]) => c === 'social')[1];
  assert.equal(social[0].name, 'ten-likes-received');
});

test('nothing renders as NaN or undefined', () => {
  for (const html of [render(rows, false), render(rows, true), render([{ ...fourWeeks, progress: undefined, required: undefined, progressPercentage: undefined }], false)]) {
    assert.ok(!html.includes('NaN'));
    assert.ok(!html.includes('undefined'));
  }
});
