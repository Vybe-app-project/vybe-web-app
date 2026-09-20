import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Render-level tests for the Feature flags table
 * (src/pages/admin/AdminFlagsTable.tsx) over mocked GET /api/admin/flags
 * rows. Mounted through react-dom/server with no QueryClient, router or
 * toast provider, like tests/admin-cards.render.test.mjs: the table must
 * stay prop-driven so a hook dependency fails here first.
 */
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { FlagsTable, FlagEditor } = await import('../src/pages/admin/AdminFlagsTable.tsx');
const flags = await import('../src/lib/adminFlags.ts');

const prose = (html) => html.replace(/<!-- -->/g, '');
const ID_A = '64f0c0ffee1234567890abcd';
const ID_B = '64f0c0ffee1234567890abce';

const row = (over = {}) => ({
  name: 'programs',
  enabled: false,
  percentage: 100,
  allowlist: [],
  note: '',
  updatedBy: null,
  updatedAt: null,
  seeded: false,
  ...over,
});

const ROWS = [
  row({ name: 'live', enabled: true, percentage: 100, seeded: true, note: 'Launch: on for everyone', updatedBy: 'operator', updatedAt: '2026-09-20T10:15:00.000Z' }),
  row({ name: 'programs', enabled: true, percentage: 25, allowlist: [ID_A, ID_B], seeded: true, updatedBy: 'charlie', updatedAt: '2026-09-20T11:00:00.000Z' }),
  row({ name: 'gymOwnerClaim', enabled: false, percentage: 100, seeded: false }),
  row({ name: 'trendingReview', enabled: false, percentage: 100, seeded: true, updatedBy: 'operator', updatedAt: '2026-09-19T09:00:00.000Z' }),
];

const noop = () => {};

/** The page's own shaping: registry merge, grouping, then per-row state. */
function sections(rows, { features = null, expanded = null, errors = {}, pending = new Set(), unregistered = new Set(), onlyReturned = false } = {}) {
  const entries = flags.mergeWithRegistry(rows).filter((e) => !onlyReturned || e.row);
  return flags.groupEntries(entries).map((g) => ({
    key: g.key,
    title: g.title,
    description: g.description,
    rows: g.entries.map((entry) => ({
      entry,
      live: flags.publicFeatureState(features, entry.name),
      pending: pending.has(entry.name),
      error: errors[entry.name] ?? null,
      unregistered: unregistered.has(entry.name),
    })),
  }));
}

const render = (rows, opts = {}, props = {}) =>
  prose(renderToString(h(FlagsTable, { sections: sections(rows, opts), expanded: opts.expanded ?? null, onExpand: noop, onToggle: noop, onSave: noop, liveKnown: opts.features !== null, ...props })));

test('the table lists every registry group plus the unknown group, names, notes, switches, rollout, updated and seeded state', () => {
  const html = render(ROWS, { features: { live: true, programs: false } });
  assert.match(html, /data-testid="admin-flags-table"/);
  for (const header of ['Flag', 'State', 'Rollout', 'Public read', 'Updated']) assert.match(html, new RegExp(`<th scope="col"[^>]*>${header}`), header);
  // Group headings in display order, the unknown group last.
  const order = ['Earlier waves', 'G-1 · Messaging v2', 'G-3 · Programs and routines', 'G-4 · Gym community v2', 'G-7 · Insights and recap v2', 'Not in the web registry'];
  let last = -1;
  for (const title of order) {
    const at = html.indexOf(title);
    assert.ok(at > last, `${title} appears after the previous group`);
    last = at;
  }
  assert.match(html, /<th scope="colgroup" colSpan="6"/);

  // Rows and their controls.
  assert.match(html, /data-flag="live"/);
  assert.match(html, /role="switch" aria-checked="true" aria-label="Enable live"/);
  assert.match(html, /role="switch" aria-checked="false" aria-label="Enable gymOwnerClaim"/);
  assert.match(html, /Live video surfaces\. Offered only when a livestream relay is also configured\./, 'the registry note');
  assert.match(html, /Note: Launch: on for everyone/, 'the stored note beside it');
  assert.match(html, /25%/);
  assert.match(html, /2 ids allowlisted/);
  assert.match(html, /0 ids allowlisted/);
  assert.match(html, /operator/);
  assert.match(html, /charlie/);
  assert.match(html, /<time [^>]*dateTime="2026-09-20T11:00:00\.000Z"/, 'timestamps carry their ISO form');
  assert.match(html, />Seeded</);
  assert.match(html, />Default</, 'an unseeded row is marked as the code default');

  // Stays-false decision beside the row.
  assert.match(html, /Stays off · D-98/);
  assert.match(html, /second reviewer/);

  // The name only the API knows.
  assert.match(html, /data-flag="trendingReview"/);
  assert.equal((html.match(/Not in the web registry/g) || []).length, 2, 'the group heading and the row note');

  // Registry names the API did not return have no controls.
  assert.match(html, /data-flag="welcomeBack"/);
  assert.match(html, /Not registered on this API build/);
  assert.match(html, /No controls/);
  assert.doesNotMatch(html, /aria-label="Enable welcomeBack"/);

  // Public read column from GET /api/capabilities.
  assert.match(html, /On<span class="sr-only"> for a signed-out reader<\/span>/);
  assert.match(html, /Off<span class="sr-only"> for a signed-out reader<\/span>/);
  assert.match(html, /aria-label="Not reported by GET \/api\/capabilities"/);

  // Edit buttons are keyboard-reachable and named.
  assert.match(html, /aria-expanded="false" aria-controls="flag-editor-live"/);
  assert.match(html, /Edit<span class="sr-only"> live<\/span>/);
  assert.doesNotMatch(html, /data-testid="admin-flag-editor"/, 'no editor open by default');
});

test('an open editor renders the percentage input, the allowlist and note textareas with counts, and Save disabled until something changes', () => {
  const html = render(ROWS, { features: { programs: false }, expanded: 'programs' });
  assert.match(html, /data-testid="admin-flag-editor"/);
  assert.match(html, /id="flag-editor-programs"/);
  assert.match(html, /aria-expanded="true" aria-controls="flag-editor-programs"/);
  assert.match(html, /<form[^>]*aria-label="Edit programs"/);
  assert.match(html, /<label[^>]*>Percentage<\/label>/);
  assert.match(html, /type="number"[^>]*min="0" max="100" step="1" value="25"/);
  assert.match(html, /<label[^>]*>Allowlist<\/label>/);
  assert.match(html, new RegExp(`<textarea[^>]*>${ID_A}\\n${ID_B}</textarea>`), 'one id per line');
  assert.match(html, /2 ids of 200/);
  assert.match(html, /<label[^>]*>Note<\/label>/);
  assert.match(html, /maxLength="500"/);
  assert.match(html, /0 of 500/);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled[^>]*>(?:<span[^>]*>)*Save changes/, 'nothing changed yet');
  assert.match(html, /Nothing changed yet\./);
  assert.match(html, />Cancel</);
  assert.match(html, /Signed-out readers see it only at 100\./);
});

test('the API\'s field error reads inline on its field; a row-level error reads beside the switch', () => {
  const errors = {
    programs: { kind: 'invalid', field: 'allowlist', message: 'Allowlist entries must be 24-character hex user ids, at most 200.', retryAfterSec: null },
    live: { kind: 'rate-limited', field: null, message: 'Rate limited. Try again in 42 s.', retryAfterSec: 42 },
  };
  const html = render(ROWS, { features: {}, expanded: 'programs', errors });
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /role="alert"[^>]*>[\s\S]*?Allowlist entries must be 24-character hex user ids, at most 200\./);
  assert.match(html, /role="alert" class="mt-1\.5 text-xs text-danger">Rate limited\. Try again in 42 s\./);
});

test('a pending row disables its switch; an unregistered row (FLAG_NOT_FOUND) loses its controls', () => {
  const pending = render(ROWS, { features: {}, pending: new Set(['live']) });
  assert.match(pending, /role="switch" aria-checked="true" aria-label="Enable live" disabled/);
  const gone = render(ROWS, { features: {}, unregistered: new Set(['trendingReview']) });
  assert.doesNotMatch(gone, /aria-label="Enable trendingReview"/);
  assert.match(gone, /data-flag="trendingReview"[\s\S]*?Not registered on this API build/);
});

test('the empty states: nothing returned, and everything hidden by the search', () => {
  const nothing = prose(renderToString(h(FlagsTable, { sections: [], expanded: null, onExpand: noop, onToggle: noop, onSave: noop })));
  assert.match(nothing, /No flags/);
  const hidden = prose(renderToString(h(FlagsTable, { sections: [], expanded: null, onExpand: noop, onToggle: noop, onSave: noop, hiddenBySearch: 41, onClearSearch: noop })));
  assert.match(hidden, /No flags match/);
  assert.match(hidden, /41 flags are hidden by the search\./);
  assert.match(hidden, />Clear search</);
});

test('FlagEditor warns when an enabled flag reaches nobody and shows the stays-false note it is given', () => {
  const html = prose(
    renderToString(
      h(FlagEditor, {
        row: row({ name: 'presenceLevel', enabled: true, percentage: 0, allowlist: [] }),
        error: null,
        onSave: noop,
        onCancel: noop,
        staysFalseNote: h('p', { 'data-testid': 'stays-false-note' }, 'Stays off by decision D-101'),
      }),
    ),
  );
  assert.match(html, /Enabled, but reaching nobody/);
  assert.match(html, /data-testid="stays-false-note"/);
  assert.match(html, /Stays off by decision D-101/);
  const fine = prose(renderToString(h(FlagEditor, { row: row({ enabled: false, percentage: 0 }), error: null, onSave: noop, onCancel: noop })));
  assert.doesNotMatch(fine, /reaching nobody/, 'a disabled flag at 0 % is not a mistake');
});

test('fetching dims the bodies; the only-returned view has no unregistered rows', () => {
  const html = render(ROWS, { features: {}, onlyReturned: true }, { fetching: true });
  assert.match(html, /<tbody class="admin-fetching"/);
  assert.doesNotMatch(html, /Not registered on this API build/);
  assert.doesNotMatch(html, /data-flag="welcomeBack"/);
});
