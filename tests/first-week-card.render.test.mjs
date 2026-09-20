/**
 * Render-level checks for the first-week Get started card and its starter
 * dialog body. Both are presentational (every value arrives as a prop), so
 * they render the same under react-dom/server as in the browser; the
 * container around them (queries, the store, the Modal portal) is covered by
 * the live browser pass.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { FIRST_WEEK_BANNED, STEP_HREFS, firstWeekStrings } = await import('../src/lib/firstWeek.ts');
const { FirstWeekCardView, StarterSessionChoices } = await import('../src/pages/FirstWeekCard.tsx');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/<!-- -->/g, '');
const textOf = (html) => decode(html).replace(/<[^>]+>/g, ' ');

const bannedPattern = new RegExp(`\\b(${FIRST_WEEK_BANNED.filter((w) => w !== '!').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const assertClean = (html) => {
  const text = textOf(html);
  assert.doesNotMatch(text, bannedPattern);
  assert.ok(!text.includes('!'), 'no exclamation mark');
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}\b/, 'no hex colour');
};

/** The element (opening tag through closing tag) carrying a data-testid, for nesting checks. */
const rowFor = (html, key) => {
  const start = html.indexOf(`data-testid="first-week-row-${key}"`);
  assert.ok(start >= 0, `row ${key} present`);
  const tagStart = html.lastIndexOf('<', start);
  const end = html.indexOf('</li>', start);
  return html.slice(tagStart, end);
};

const noop = () => {};
const row = (key, isToday = false) => ({ key, isToday, href: STEP_HREFS[key] });

const view = (props = {}) =>
  decode(
    mount(
      h(FirstWeekCardView, {
        dayLine: firstWeekStrings.day(3),
        rows: [row('first-move'), row('social-spark'), row('join-gym', true), row('first-meal')],
        doneTitles: [],
        progress: { done: 0, total: 4 },
        state: 'ready',
        onDismiss: noop,
        ...props,
      }),
    ),
  );

test('day 3, 1 of 4 done, today join-gym: the day line, the badge placement, the dismiss label, the people link, the done line', () => {
  const html = view({
    rows: [row('social-spark'), row('join-gym', true), row('first-meal')],
    doneTitles: ['Log a workout'],
    progress: { done: 1, total: 4 },
  });
  assert.match(html, /data-testid="first-week-card"[^>]*role="region"/);
  assert.match(html, /<h2[^>]*>Get started<\/h2>/);
  assert.match(html, /data-testid="first-week-day-line"[^>]*>Day 3 of your first week</);
  assert.match(html, />1 of 4 done</);
  assert.equal((html.match(/>Today</g) || []).length, 1, 'exactly one Today badge');
  assert.match(rowFor(html, 'join-gym'), /data-testid="first-week-today-tag"[^>]*>Today</, 'the badge sits inside the join-gym row');
  assert.doesNotMatch(rowFor(html, 'social-spark'), /Today/);
  assert.match(html, /aria-label="Not now, hide this card"[^>]*data-testid="first-week-dismiss"|data-testid="first-week-dismiss"[^>]*aria-label="Not now, hide this card"/);
  assert.match(rowFor(html, 'social-spark'), /href="\/discover\?tab=people"/);
  assert.match(rowFor(html, 'join-gym'), /href="\/gyms"/);
  assert.match(rowFor(html, 'first-meal'), /href="\/meals\?log=1"/);
  assert.match(html, /data-testid="first-week-done-line"[\s\S]*?Log a workout — done/);
  assert.doesNotMatch(html, /first-week-row-first-move/, 'a done step has no row');
  assert.match(html, /Find your gym’s community\./);
  assert.match(html, /Kudos on a post counts too\./);
  assert.match(html, /A snack counts\./);
  assertClean(html);
});

test('day 1 draws no people row; the container passes rows already filtered', () => {
  const html = view({ dayLine: firstWeekStrings.day(1), rows: [row('first-move', true), row('join-gym'), row('first-meal')] });
  assert.doesNotMatch(html, /first-week-row-social-spark/);
  assert.match(html, /Day 1 of your first week/);
  assert.match(rowFor(html, 'first-move'), /Today/);
  assertClean(html);
});

test('the first-move row is a button while the starter is offered and a link once a log exists', () => {
  const offered = view({ rows: [row('first-move', true)], starterOffered: true, onOpenStarter: noop });
  const buttonRow = rowFor(offered, 'first-move');
  assert.match(buttonRow, /^<button type="button"/);
  assert.match(buttonRow, /aria-haspopup="dialog"/);
  assert.doesNotMatch(buttonRow, /href=/);
  assert.match(buttonRow, /Log a workout/);
  assert.match(buttonRow, /Any length counts\./);

  const linked = view({ rows: [row('first-move', true)], starterOffered: false });
  const linkRow = rowFor(linked, 'first-move');
  assert.match(linkRow, /^<a /);
  assert.match(linkRow, /href="\/workouts\/logs\?log=1"/);
});

test('loading, error and offline states', () => {
  const loading = view({ state: 'loading', rows: [] });
  assert.match(loading, /role="status"[^>]*aria-busy="true"/);
  assert.match(loading, /Checking your first steps/);
  assert.doesNotMatch(loading, /first-week-row-/);
  assert.match(loading, /Day 3 of your first week/, 'the header is known before the steps are');

  const error = view({ state: 'error', rows: [], onRetry: noop });
  assert.match(error, /Couldn’t load your first steps\./);
  assert.match(error, /<button[^>]*aria-label="Retry loading your first steps"[^>]*>[\s\S]*?Retry/);
  const idle = error.match(/<button[^>]*aria-label="Retry loading your first steps"[^>]*>/)?.[0];
  assert.ok(idle && !/aria-busy|disabled/.test(idle), 'Retry is idle before a press');

  const retrying = view({ state: 'error', rows: [], onRetry: noop, isRetrying: true });
  const busy = retrying.match(/<button[^>]*aria-label="Retry loading your first steps"[^>]*>/)?.[0];
  assert.ok(busy, 'Retry stays while the reads are refetched');
  assert.match(busy, /aria-busy="true"/, 'Retry shows busy while the reads are in flight');
  assert.match(busy, /disabled/, 'a second press is ignored while retrying');

  const offline = view({ state: 'offline', rows: [] });
  assert.match(offline, /You’re offline\. Your first steps will show when you’re back online\./);
  for (const html of [loading, error, offline]) assertClean(html);
});

test('every row is keyboard reachable: links or buttons only, each with a 44 px minimum height', () => {
  const html = view();
  const rows = ['first-move', 'social-spark', 'join-gym', 'first-meal'].map((k) => rowFor(html, k));
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.match(r, /^<(a|button) /);
    assert.match(r, /min-h-11/);
  }
  const dismiss = html.match(/<button[^>]*data-testid="first-week-dismiss"[^>]*>/)?.[0];
  assert.ok(dismiss, 'dismiss is a button');
  assert.match(dismiss, /type="button"/);
});

/* --------------------------------------------------------- starter choices */

const SEED = {
  _id: 'w1',
  title: 'Foundation Full Body',
  category: 'strength',
  duration: 28,
  exercises: [
    { name: 'Bodyweight Squat', sets: 3, reps: 12, rest: 45 },
    { name: 'Incline Push-Up', sets: 3, reps: 10, rest: 45 },
    { name: 'Glute Bridge', sets: 3, reps: 15, rest: 30 },
    { name: 'Dead Bug', sets: 3, reps: 10, rest: 30 },
  ],
};

const choices = (template) => decode(mount(h(StarterSessionChoices, { template, onClose: noop })));

test('with the seeded template: Start here · 28 min to the starter link, plus Start empty', () => {
  const html = choices(SEED);
  const here = html.match(/<a [^>]*data-testid="starter-start-here"[^>]*>/)?.[0];
  assert.ok(here, 'Start here is a link');
  assert.match(here, /href="\/workouts\/logs\?log=1&starter=1"/);
  assert.doesNotMatch(here, /aria-label=|aria-labelledby=/, 'the visible "Start here · 28 min" is the accessible name (WCAG 2.5.3)');
  assert.match(html, /Start here · 28 min/);
  assert.match(html, /Four moves, bodyweight, about 28 minutes\. Any length counts\./);
  const empty = html.match(/<a [^>]*data-testid="starter-start-empty"[^>]*>/)?.[0];
  assert.ok(empty, 'Start empty is a link');
  assert.match(empty, /href="\/workouts\/logs\?log=1"/);
  assert.doesNotMatch(empty, /aria-label=|aria-labelledby=/, 'the visible "Start empty" is the accessible name (WCAG 2.5.3)');
  assert.match(html, /Start empty/);
  assert.match(html, /Add your own exercises\./);
  assert.doesNotMatch(html, /starter-unavailable|aria-busy/);
  assertClean(html);
});

test('without a template: the unavailable line and only the empty link', () => {
  const html = choices(null);
  assert.match(html, /data-testid="starter-unavailable"[^>]*>The starter session isn’t available right now\. Start empty instead\.</);
  assert.doesNotMatch(html, /starter-start-here/);
  assert.match(html, /data-testid="starter-start-empty"/);
  assert.equal((html.match(/<a /g) || []).length, 1, 'one link');
  assertClean(html);
});

test('while the catalogue is read: aria-busy, no Start here yet, Start empty already there', () => {
  const html = choices('loading');
  assert.match(html, /role="status"[^>]*aria-busy="true"/);
  assert.match(html, /Checking the starter session/);
  assert.doesNotMatch(html, /starter-start-here/);
  assert.match(html, /data-testid="starter-start-empty"/);
  assertClean(html);
});

test('a template without a duration reads 18 min', () => {
  const html = choices({ ...SEED, duration: undefined });
  assert.match(html, /Start here · 18 min/);
  assert.match(html, /Four moves, bodyweight, about 18 minutes\. Any length counts\./);
});
