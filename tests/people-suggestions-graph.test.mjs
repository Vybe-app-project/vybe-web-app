import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

/**
 * P9: suggestions from `GET /users/suggestions` (the people graph). It sends
 * `reason` as `{ code, label }` and `activity: { sessions30d }`, where
 * `/searching/suggest` sent the legacy string and no activity. The chip row
 * has to read both, and it must never print a zero session count -- a row
 * that earned its place through an invite or a shared gym genuinely has one.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const people = await import('../src/lib/peopleSuggestions.ts');

const texts = (row) => people.reasonChips(row).map((c) => c.text);

test('the reason codes are the six the people graph emits, and `contact` is reserved', () => {
  assert.deepEqual([...people.REASON_CODES], ['invited_you', 'mutual_follow', 'follows_you', 'same_gym', 'trains_like_you', 'recently_active']);
  assert.ok(!people.REASON_CODES.includes('contact'), 'reserved server-side, never sent');
});

test('reason.label is the sentence, and the legacy string shape still reads reasonText', () => {
  assert.equal(people.reasonLabelOf({ reason: { code: 'same_gym', label: 'Also at Iron Works' } }), 'Also at Iron Works');
  assert.equal(people.reasonCodeOf({ reason: { code: 'same_gym', label: 'x' } }), 'same_gym');
  // The older route: a string reason has no label, so the sentence is reasonText.
  assert.equal(people.reasonLabelOf({ reason: 'same-gym', reasonText: 'Also at Iron Works' }), 'Also at Iron Works');
  assert.equal(people.reasonCodeOf({ reason: 'same-gym' }), null);
  // reason: null is what the server sends when no code applies.
  assert.equal(people.reasonLabelOf({ reason: null }), null);
  assert.equal(people.reasonLabelOf({}), null);
  assert.equal(people.reasonLabelOf(null), null);
});

test('"12 sessions this month" is printed, "0 sessions" never is', () => {
  assert.equal(people.sessionsLabel({ sessions30d: 12 }), '12 sessions this month');
  assert.equal(people.sessionsLabel({ sessions30d: 1 }), '1 session this month');
  assert.equal(people.sessionsLabel({ sessions30d: 0 }), null, 'an invite or a gym-mate can honestly be 0');
  assert.equal(people.sessionsLabel({ sessions30d: -1 }), null);
  assert.equal(people.sessionsLabel({}), null);
  assert.equal(people.sessionsLabel(null), null);
  assert.equal(people.sessionsLabel(undefined), null);
});

test('a people-graph row chips its label and its count, in that order', () => {
  assert.deepEqual(texts({ reason: { code: 'mutual_follow', label: 'Followed by Alex and 2 others' }, activity: { sessions30d: 12 } }), [
    'Followed by Alex and 2 others',
    '12 sessions this month',
  ]);
  // Zero activity: the reason stands alone.
  assert.deepEqual(texts({ reason: { code: 'same_gym', label: 'Also at Iron Works' }, activity: { sessions30d: 0 } }), ['Also at Iron Works']);
  // "Invited you" keeps its accent and is not said twice.
  const invited = people.reasonChips({ reason: { code: 'invited_you', label: 'Invited you' }, activity: { sessions30d: 3 } });
  assert.deepEqual(invited.map((c) => [c.text, c.accent]), [['Invited you', true], ['3 sessions this month', false]]);
  // The check-in chip still fires when the label does not already carry it.
  assert.deepEqual(texts({ reason: { code: 'same_gym', label: 'Also at Iron Works' }, activeThisWeek: true }), [
    'Also at Iron Works',
    'Trains at your gym · there this week',
  ]);
  assert.deepEqual(texts({ reason: { code: 'same_gym', label: 'Also at Iron Works · there this week' }, activeThisWeek: true }), [
    'Also at Iron Works · there this week',
  ]);
  // No reason and no activity is no chip: nothing is invented.
  assert.deepEqual(people.reasonChips({ reason: null, activity: { sessions30d: 0 } }), []);
});

test('the list reads the people-graph route and parses its `users` array', () => {
  const row = read('src/pages/SuggestionRow.tsx');
  assert.match(row, /api\.get\('\/users\/suggestions', \{ params: \{ limit \} \}\)/);
  assert.deepEqual(people.parseSuggestions({ success: true, count: 1, users: [{ _id: 'a', username: 'a' }], sources: {} }).map((u) => u._id), ['a']);
  assert.deepEqual(people.parseSuggestions({ users: 'nope' }), []);
  assert.deepEqual(people.parseSuggestions(null), []);
  // Search's empty box shows three of them.
  assert.match(read('src/pages/Search.tsx'), /<SuggestionList limit=\{3\} heading="For you" \/>/);
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  assert.ok(pinned.has('GET /api/users/suggestions'));
});

/* ------------------------------------------------------------------ render */

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { default: SuggestionRow } = await import('../src/pages/SuggestionRow.tsx');

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');

function mount(row) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return decode(renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, h(SuggestionRow, { row }))))));
}

test('a suggestion row shows who, why, and how much they train', () => {
  const html = mount({
    _id: 'u2',
    username: 'maya.kim',
    fullName: 'Maya Kim',
    reason: { code: 'same_gym', label: 'Also at Iron Works' },
    activity: { sessions30d: 12 },
  });
  assert.match(html, /Maya Kim/);
  assert.match(html, /aria-label="Why this suggestion"/);
  assert.equal((html.match(/data-testid="reason-chip"/g) || []).length, 2);
  assert.match(html, /Also at Iron Works/);
  assert.match(html, /12 sessions this month/);
  assert.match(html, /href="\/u\/u2"/);
});

test('a zero-activity row says why it is there and nothing about sessions', () => {
  const html = mount({
    _id: 'u3',
    username: 'sam',
    fullName: 'Sam Reyes',
    reason: { code: 'invited_you', label: 'Invited you' },
    activity: { sessions30d: 0 },
  });
  assert.equal((html.match(/data-testid="reason-chip"/g) || []).length, 1);
  assert.match(html, /Invited you/);
  assert.doesNotMatch(html, /0 sessions/);
  assert.doesNotMatch(html, /sessions this month/);
});

test('a row with no reason at all carries no chip row', () => {
  const html = mount({ _id: 'u4', username: 'quiet', fullName: 'Quiet One', reason: null });
  assert.doesNotMatch(html, /data-testid="reason-chip"/);
  assert.doesNotMatch(html, /aria-label="Why this suggestion"/);
});
