import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

/**
 * The staff console's Feature flags page (Wave G pre-work) against the
 * FROZEN admin flags contract: GET /api/admin/flags -> { flags: [...] } and
 * PUT /api/admin/flags/:name -> the row, 404 FLAG_NOT_FOUND, 400 FLAG_INVALID
 * { field }, 400 UNSUPPORTED_FIELD. The routes are not deployed yet, so
 * everything here runs on mocked bodies; the source pins keep the page on the
 * two literal calls the contract audit will match once the API lands.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const flags = await import('../src/lib/adminFlags.ts');

const ID_A = '64f0c0ffee1234567890abcd';
const ID_B = '64f0c0ffee1234567890abce';
const ID_C = '64F0C0FFEE1234567890ABCF';

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

/* ------------------------------------------------------------ registry */

test('the registry carries the nine live flags and the thirty Wave G flags, grouped by package', () => {
  const names = flags.KNOWN_FLAGS.map((f) => f.name);
  assert.equal(names.length, 39);
  assert.equal(new Set(names).size, 39, 'no duplicate names');
  for (const live of ['live', 'reviewPrompt', 'sessions', 'telemetry.crashReports', 'reports.eventTarget', 'achievementAutoAward', 'invites', 'healthImport', 'progression']) {
    assert.equal(flags.knownFlag(live)?.group, 'earlier', live);
  }
  const byGroup = (key) => flags.KNOWN_FLAGS.filter((f) => f.group === key).map((f) => f.name);
  assert.deepEqual(byGroup('G-1'), ['messageRequests', 'voiceNotes', 'trainingMode', 'sharedObjectCards']);
  assert.deepEqual(byGroup('G-2'), ['feedForYou', 'explore', 'hiddenDetails', 'composerV2']);
  assert.deepEqual(byGroup('G-3'), ['programs', 'routineShareLinks']);
  assert.deepEqual(byGroup('G-4'), ['gymModerationQueue', 'gymNotificationLevels', 'gymAnnouncements', 'gymOwnership', 'gymRegular', 'gymOwnerClaim']);
  assert.deepEqual(byGroup('G-5'), ['pushCollapse', 'friendDigest', 'linkUnfurl', 'pushActions']);
  assert.deepEqual(byGroup('G-6'), ['challengesV2', 'challengePhotoProof', 'buddyRhythm', 'presenceLevel']);
  assert.deepEqual(byGroup('G-7'), ['insightsV2', 'trainingLoad', 'rhythmSuggestions', 'mealsWeeks', 'focus', 'welcomeBack']);
  for (const f of flags.KNOWN_FLAGS) assert.ok(f.note.length > 10, `${f.name} has a note`);
  // Every group a known flag names exists, and 'unknown' is last.
  const groupKeys = flags.FLAG_GROUPS.map((g) => g.key);
  for (const f of flags.KNOWN_FLAGS) assert.ok(groupKeys.includes(f.group), `${f.name} group ${f.group}`);
  assert.equal(groupKeys.at(-1), 'unknown');
});

test('the three "stays false by decision" flags carry their D-ids and nothing else does', () => {
  assert.deepEqual(Object.keys(flags.STAYS_FALSE).sort(), ['challengePhotoProof', 'gymOwnerClaim', 'presenceLevel']);
  assert.equal(flags.staysFalseDecision('gymOwnerClaim')?.decision, 'D-98');
  assert.equal(flags.staysFalseDecision('challengePhotoProof')?.decision, 'D-99');
  assert.equal(flags.staysFalseDecision('presenceLevel')?.decision, 'D-101');
  assert.equal(flags.staysFalseDecision('programs'), null);
  for (const name of Object.keys(flags.STAYS_FALSE)) assert.ok(flags.knownFlag(name), `${name} is in the registry`);
});

/* -------------------------------------------------------- normalising */

test('normalizeFlagRows reads { flags: [...] }, settles every type and drops rows without a name', () => {
  const rows = flags.normalizeFlagRows({
    flags: [
      { name: 'live', enabled: true, percentage: 100, allowlist: [], note: 'launch', updatedBy: 'operator', updatedAt: '2026-09-20T10:00:00.000Z', seeded: true },
      { name: 'programs', enabled: 'yes', percentage: '25', allowlist: [ID_A, 7, ''], note: null, seeded: false },
      { name: 'weird', percentage: 250 },
      { enabled: true },
      null,
      { name: 'live', enabled: false },
    ],
  });
  assert.equal(rows.length, 3, 'the nameless rows are dropped and the duplicate name is kept once');
  assert.deepEqual(rows[0], { name: 'live', enabled: true, percentage: 100, allowlist: [], note: 'launch', updatedBy: 'operator', updatedAt: '2026-09-20T10:00:00.000Z', seeded: true });
  assert.equal(rows[1].enabled, false, 'only exactly true counts');
  assert.equal(rows[1].percentage, 25, 'a digit string is read');
  assert.deepEqual(rows[1].allowlist, [ID_A], 'non-string entries are dropped');
  assert.equal(rows[1].note, '');
  assert.equal(rows[1].seeded, false);
  assert.equal(rows[2].percentage, 100, 'an out-of-range percentage falls back to the code default');
  assert.equal(rows[2].seeded, true, 'seeded is only false when the API says so');
  assert.deepEqual(flags.normalizeFlagRows({}), []);
  assert.deepEqual(flags.normalizeFlagRows('<html>'), []);
  assert.equal(flags.normalizeFlagRow({ name: '  ' }), null);
});

/* ------------------------------------------------------------ grouping */

test('mergeWithRegistry lists every registry flag, marks the ones the API did not return, and appends unknown names', () => {
  const rows = [row({ name: 'live', enabled: true, seeded: true }), row({ name: 'trendingReview' }), row({ name: 'programs' }), row({ name: 'aaaCustom' })];
  const entries = flags.mergeWithRegistry(rows);
  assert.equal(entries.length, flags.KNOWN_FLAGS.length + 2);
  const live = entries.find((e) => e.name === 'live');
  assert.equal(live.row.enabled, true);
  assert.equal(live.known.group, 'earlier');
  const missing = entries.find((e) => e.name === 'welcomeBack');
  assert.equal(missing.row, null, 'a registry name the API did not return has no row');
  assert.equal(missing.known.name, 'welcomeBack');
  const unknown = entries.filter((e) => e.group === 'unknown');
  assert.deepEqual(unknown.map((e) => e.name), ['aaaCustom', 'trendingReview'], 'unknown names sort alphabetically after the registry');
  for (const e of unknown) {
    assert.equal(e.known, null);
    assert.equal(e.note, flags.UNKNOWN_NOTE);
    assert.ok(e.row, 'an unknown name always has the API row that introduced it');
  }
  assert.equal(entries.find((e) => e.name === 'gymOwnerClaim').staysFalse.decision, 'D-98');
});

test('groupEntries keeps display order, registry order inside a group, and omits empty groups', () => {
  const rows = [row({ name: 'welcomeBack' }), row({ name: 'zeta' }), row({ name: 'insightsV2' }), row({ name: 'programs' })];
  const only = flags.mergeWithRegistry(rows).filter((e) => e.row !== null);
  const groups = flags.groupEntries(only.reverse());
  assert.deepEqual(groups.map((g) => g.key), ['G-3', 'G-7', 'unknown']);
  assert.deepEqual(groups[1].entries.map((e) => e.name), ['insightsV2', 'welcomeBack'], 'registry order, not the input order');
  assert.equal(groups[2].title, 'Not in the web registry');
  assert.deepEqual(flags.groupEntries([]), []);
});

test('sortEntries is stable across group, registry and alphabetical tiers', () => {
  const rows = [row({ name: 'b-unknown' }), row({ name: 'a-unknown' }), row({ name: 'focus' }), row({ name: 'live' }), row({ name: 'messageRequests' })];
  const sorted = flags.sortEntries(flags.mergeWithRegistry(rows).filter((e) => e.row));
  assert.deepEqual(sorted.map((e) => e.name), ['live', 'messageRequests', 'focus', 'a-unknown', 'b-unknown']);
});

test('the search box matches name, group title, note, decision id and the stored note, every term must match', () => {
  const rows = [row({ name: 'gymOwnerClaim' }), row({ name: 'live', note: 'launch day', updatedBy: 'charlie' }), row({ name: 'mystery' })];
  const entries = flags.mergeWithRegistry(rows).filter((e) => e.row);
  const names = (q) => flags.searchEntries(entries, q).map((e) => e.name);
  assert.deepEqual(names(''), ['live', 'gymOwnerClaim', 'mystery'], 'registry order is kept');
  assert.deepEqual(names('D-98'), ['gymOwnerClaim']);
  assert.deepEqual(names('gym community'), ['gymOwnerClaim'], 'the group title matches');
  assert.deepEqual(names('LAUNCH'), ['live'], 'the stored note matches, case-insensitively');
  assert.deepEqual(names('charlie'), ['live'], 'updatedBy matches');
  assert.deepEqual(names('web registry'), ['mystery'], 'the unknown note matches');
  assert.deepEqual(names('live relay'), ['live'], 'every term must match somewhere');
  assert.deepEqual(names('nothing-here'), []);
});

test('summarizeFlags counts what the API returned and how many names sit outside each registry', () => {
  const rows = [row({ name: 'live', enabled: true, seeded: true }), row({ name: 'programs', seeded: true }), row({ name: 'custom' })];
  assert.deepEqual(flags.summarizeFlags(rows), { total: 3, on: 1, seeded: 2, unknown: 1, missing: flags.KNOWN_FLAGS.length - 2 });
  assert.deepEqual(flags.summarizeFlags([]), { total: 0, on: 0, seeded: 0, unknown: 0, missing: flags.KNOWN_FLAGS.length });
});

/* ------------------------------------------------------- diff builder */

test('parseAllowlist splits on newlines, commas, semicolons and spaces, lower-cases, de-duplicates and reports the rest', () => {
  const parsed = flags.parseAllowlist(`${ID_A}\n${ID_B}, ${ID_C};${ID_A}  not-an-id\n${ID_B.toUpperCase()}`);
  assert.deepEqual(parsed.ids, [ID_A, ID_B, ID_C.toLowerCase()]);
  assert.deepEqual(parsed.invalid, ['not-an-id']);
  assert.equal(parsed.duplicates, 2);
  assert.deepEqual(flags.parseAllowlist('   \n '), { ids: [], invalid: [], duplicates: 0 });
  assert.deepEqual(flags.parseAllowlist('64f0c0ffee1234567890abc').invalid, ['64f0c0ffee1234567890abc'], '23 hex chars is not an id');
});

test('buildFlagPatch sends only the changed fields; the allowlist compares as a set and the note trimmed', () => {
  const current = row({ enabled: true, percentage: 25, allowlist: [ID_A, ID_B], note: 'ramp' });
  assert.deepEqual(flags.buildFlagPatch(current, { enabled: true, percentage: 25, allowlist: [ID_B, ID_A], note: '  ramp ' }), {});
  assert.deepEqual(flags.buildFlagPatch(current, { enabled: false, percentage: 25, allowlist: [ID_A, ID_B], note: 'ramp' }), { enabled: false });
  assert.deepEqual(flags.buildFlagPatch(current, { enabled: true, percentage: 50, allowlist: [ID_A, ID_B], note: 'ramp' }), { percentage: 50 });
  assert.deepEqual(flags.buildFlagPatch(current, { enabled: true, percentage: 25, allowlist: [ID_A], note: 'ramp' }), { allowlist: [ID_A] });
  assert.deepEqual(flags.buildFlagPatch(current, { enabled: true, percentage: 25, allowlist: [ID_A, ID_B.toUpperCase()], note: 'ramp' }), {}, 'case does not make a different set');
  assert.deepEqual(flags.buildFlagPatch(current, { enabled: true, percentage: 25, allowlist: [ID_A, ID_B], note: 'ramp done ' }), { note: 'ramp done' });
  const everything = flags.buildFlagPatch(current, { enabled: false, percentage: 0, allowlist: [], note: '' });
  assert.deepEqual(everything, { enabled: false, percentage: 0, allowlist: [], note: '' });
  assert.equal(flags.isEmptyPatch({}), true);
  assert.equal(flags.isEmptyPatch({ note: '' }), false);
});

test('readDraft validates the editor text against the contract and only builds a patch when every field is valid', () => {
  const current = row({ enabled: true, percentage: 25, allowlist: [ID_A], note: 'ramp' });
  const draft = flags.draftFromRow(current);
  assert.deepEqual(draft, { percentage: '25', allowlist: ID_A, note: 'ramp' });
  const unchanged = flags.readDraft(current, draft);
  assert.deepEqual(unchanged.errors, {});
  assert.deepEqual(unchanged.patch, {});
  assert.equal(unchanged.allowlistCount, 1);
  assert.equal(unchanged.noteLength, 4);

  const changed = flags.readDraft(current, { percentage: ' 50 ', allowlist: `${ID_A}\n${ID_B}`, note: 'ramp to half' });
  assert.deepEqual(changed.patch, { percentage: 50, allowlist: [ID_A, ID_B], note: 'ramp to half' });
  assert.equal(changed.values.enabled, true, 'the editor never changes enabled; the switch does');

  for (const bad of ['', '-1', '101', '1.5', '12a', '1000']) {
    const r = flags.readDraft(current, { ...draft, percentage: bad });
    assert.equal(r.errors.percentage, 'Enter a whole number from 0 to 100.', `percentage ${JSON.stringify(bad)}`);
    assert.deepEqual(r.patch, {}, 'no patch while invalid');
    assert.equal(r.values, null);
  }
  assert.deepEqual(flags.readDraft(current, { ...draft, percentage: '0' }).patch, { percentage: 0 });
  assert.deepEqual(flags.readDraft(current, { ...draft, percentage: '100' }).patch, { percentage: 100 });

  const invalidIds = flags.readDraft(current, { ...draft, allowlist: `${ID_A}\nabc\nxyz` });
  assert.match(invalidIds.errors.allowlist, /^These are not 24-character hex user ids: abc, xyz\.$/);
  assert.match(flags.readDraft(current, { ...draft, allowlist: 'abc' }).errors.allowlist, /^This is not a 24-character hex user id: abc\.$/);
  const many = Array.from({ length: flags.ALLOWLIST_MAX + 1 }, (_, i) => (BigInt(`0x${ID_A}`) + BigInt(i)).toString(16).padStart(24, '0')).join('\n');
  assert.equal(flags.readDraft(current, { ...draft, allowlist: many }).errors.allowlist, `At most ${flags.ALLOWLIST_MAX} ids; there are ${flags.ALLOWLIST_MAX + 1}.`);
  assert.equal(flags.readDraft(current, { ...draft, allowlist: many.split('\n').slice(0, flags.ALLOWLIST_MAX).join(',') }).errors.allowlist, undefined, 'exactly 200 is allowed');

  const longNote = flags.readDraft(current, { ...draft, note: 'x'.repeat(flags.NOTE_MAX + 1) });
  assert.equal(longNote.errors.note, `At most ${flags.NOTE_MAX} characters; there are ${flags.NOTE_MAX + 1}.`);
  assert.equal(flags.readDraft(current, { ...draft, note: 'x'.repeat(flags.NOTE_MAX) }).errors.note, undefined, 'exactly 500 is allowed');
  assert.equal(flags.ALLOWLIST_MAX, 200);
  assert.equal(flags.NOTE_MAX, 500);
});

/* ------------------------------------------------------- error mapper */

test('mapFlagError: FLAG_NOT_FOUND, FLAG_INVALID with a field, UNSUPPORTED_FIELD, 429 and the rest', () => {
  const notFound = flags.mapFlagError({ status: 404, code: 'FLAG_NOT_FOUND', message: 'Flag not found' }, 'trendingReview');
  assert.equal(notFound.kind, 'not-found');
  assert.equal(notFound.field, null);
  assert.match(notFound.message, /^trendingReview is not a registered flag on this API build\. Flags are declared in code; there are no ad-hoc flags\.$/);
  assert.equal(flags.mapFlagError({ status: 404, code: null }, 'x').kind, 'not-found', 'a bare 404 reads the same way');

  const pct = flags.mapFlagError({ status: 400, code: 'FLAG_INVALID', message: 'percentage must be 0-100', field: 'percentage' }, 'programs');
  assert.deepEqual(pct, { kind: 'invalid', field: 'percentage', message: 'Percentage must be a whole number from 0 to 100.', retryAfterSec: null });
  assert.equal(flags.mapFlagError({ status: 400, code: 'FLAG_INVALID', field: 'allowlist' }, 'p').message, 'Allowlist entries must be 24-character hex user ids, at most 200.');
  assert.equal(flags.mapFlagError({ status: 400, code: 'FLAG_INVALID', field: 'note' }, 'p').message, 'The note must be 500 characters or fewer.');
  assert.equal(flags.mapFlagError({ status: 400, code: 'FLAG_INVALID', field: 'enabled' }, 'p').message, 'Enabled must be true or false.');
  const odd = flags.mapFlagError({ status: 400, code: 'FLAG_INVALID', message: 'body must be an object', field: 'body' }, 'p');
  assert.equal(odd.kind, 'invalid');
  assert.equal(odd.field, null, 'a field outside the contract is not placed inline');
  assert.equal(odd.message, 'body must be an object.');
  assert.equal(flags.mapFlagError({ status: 400, code: 'FLAG_INVALID' }, 'p').message, 'The API rejected one of the fields.');

  const unsupported = flags.mapFlagError({ status: 400, code: 'UNSUPPORTED_FIELD', field: 'allowlist' }, 'p');
  assert.equal(unsupported.kind, 'unsupported');
  assert.equal(unsupported.field, 'allowlist');
  assert.equal(unsupported.message, 'This API build does not accept the field "allowlist". Reload the console and try again.');
  const unsupportedOther = flags.mapFlagError({ status: 400, code: 'UNSUPPORTED_FIELD', field: 'colour' }, 'p');
  assert.equal(unsupportedOther.field, null);
  assert.equal(unsupportedOther.message, 'This API build does not accept the field "colour". Reload the console and try again.');
  assert.equal(flags.mapFlagError({ status: 400, code: 'UNSUPPORTED_FIELD' }, 'p').message, 'This API build does not accept one of the fields sent. Reload the console and try again.');

  const limited = flags.mapFlagError({ status: 429, code: 'RATE_LIMITED', retryAfterSec: 42 }, 'p');
  assert.deepEqual(limited, { kind: 'rate-limited', field: null, message: 'Rate limited. Try again in 42 s.', retryAfterSec: 42 });
  assert.equal(flags.mapFlagError({ status: 429, code: null, retryAfterSec: 600 }, 'p').message, 'Rate limited. Try again in 10 min.');
  assert.equal(flags.mapFlagError({ status: 429, code: null }, 'p').message, 'Rate limited. Try again in a moment.');
  assert.equal(flags.mapFlagError({ status: 429, code: null, retryAfterSec: 0.4 }, 'p').retryAfterSec, 1, 'a fractional wait rounds up, never to zero');

  assert.deepEqual(flags.mapFlagError({ status: 403, code: null, message: 'Super administrator required' }, 'p'), { kind: 'forbidden', field: null, message: 'Super administrator required.', retryAfterSec: null });
  assert.equal(flags.mapFlagError({ status: 401, code: null }, 'p').message, 'Staff access is required to change flags.');
  assert.equal(flags.mapFlagError({ status: null, code: 'ERR_NETWORK', kind: 'network' }, 'p').kind, 'offline');
  assert.equal(flags.mapFlagError({ status: null, code: 'ECONNABORTED', kind: 'timeout' }, 'p').kind, 'offline');
  assert.deepEqual(flags.mapFlagError({ status: 500, code: 'INTERNAL', message: 'Something broke' }, 'p'), { kind: 'other', field: null, message: 'Something broke.', retryAfterSec: null });
  assert.equal(flags.mapFlagError({ status: 500, code: null }, 'p').message, 'Could not save the flag.');
});

test('the mapper accepts parseApiError output as-is', async () => {
  const { parseApiError } = await import('../src/lib/apiError.ts');
  const e = { isAxiosError: true, message: 'Request failed with status code 400', config: {}, response: { status: 400, data: { success: false, code: 'FLAG_INVALID', message: 'allowlist has 201 entries', field: 'allowlist' }, headers: {} } };
  const mapped = flags.mapFlagError(parseApiError(e), 'programs');
  assert.equal(mapped.kind, 'invalid');
  assert.equal(mapped.field, 'allowlist');
  const limited = { isAxiosError: true, message: 'x', config: {}, response: { status: 429, data: 'Too many requests', headers: { 'retry-after': '30' } } };
  assert.deepEqual(flags.mapFlagError(parseApiError(limited), 'p'), { kind: 'rate-limited', field: null, message: 'Rate limited. Try again in 30 s.', retryAfterSec: 30 });
});

/* --------------------------------------------------------- live effect */

test('publicFeatureState reads GET /api/capabilities features, null when the name is absent', () => {
  const body = { success: true, capabilities: { push: false }, features: { live: true, programs: false, odd: 'yes' } };
  const features = flags.featuresOf(body);
  assert.equal(flags.publicFeatureState(features, 'live'), true);
  assert.equal(flags.publicFeatureState(features, 'programs'), false);
  assert.equal(flags.publicFeatureState(features, 'odd'), false, 'only exactly true is on');
  assert.equal(flags.publicFeatureState(features, 'welcomeBack'), null);
  assert.equal(flags.publicFeatureState(null, 'live'), null);
  assert.equal(flags.featuresOf({ capabilities: {} }), null);
  assert.equal(flags.featuresOf('<html>'), null);
});

/* --------------------------------------------------------- source pins */

test('the page is routed under the admin layout and in the console nav', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const AdminFlags = lazy\(\(\) => import\('\.\/pages\/admin\/AdminFlags'\)\);/);
  assert.match(app, /<Route path="flags" element=\{<AdminFlags \/>\} \/>/);
  // Nested under the RequireAdmin outlet: the route sits between the "system" row and the console catch-all.
  const start = app.indexOf('<Route path="system"');
  const end = app.indexOf('<Route path="*" element={<Navigate to="/admin" replace />} />');
  assert.ok(start > 0 && end > start);
  assert.ok(app.slice(start, end).includes('<Route path="flags"'), 'the flags route is inside the admin layout');

  const layout = read('src/pages/admin/AdminLayout.tsx');
  assert.match(layout, /\{ to: '\/admin\/flags', label: 'Feature flags', Icon: Zap \}/);
  // The entries other suites pin are untouched.
  assert.match(layout, /\{ to: '\/admin\/audit', label: 'Audit log', Icon: List, superOnly: true \}/);
  assert.match(layout, /\{ to: '\/admin\/system', label: 'System', Icon: Server \}/);
});

test('the page makes exactly the two contract calls as staff, re-reads capabilities after a PUT, and confirms the stays-false flags', () => {
  const page = read('src/pages/admin/AdminFlags.tsx');
  assert.match(page, /adminApi\.get\('\/admin\/flags'\)/, 'GET /api/admin/flags is a literal the contract audit can pin');
  assert.match(page, /adminApi\.put\(`\/admin\/flags\/\$\{encodeURIComponent\(name\)\}`, patch\)/, 'PUT /api/admin/flags/:name');
  assert.match(page, /adminApi\.get\('\/capabilities'\)/, 'the live effect is the public read');
  assert.doesNotMatch(page, /\bapi\.(get|post|put|patch|delete)\(/, 'never the member client');
  assert.doesNotMatch(page, /useCapabilities|useFeature\b/, 'the console keeps its own capabilities query');
  const otherCalls = page.match(/adminApi\.(get|post|put|patch|delete)\(/g) || [];
  assert.equal(otherCalls.length, 3, 'GET flags, PUT flag, GET capabilities and nothing else');
  assert.doesNotMatch(page, /adminApi\.(post|patch|delete)\(/);

  // Optimistic switch with rollback; capabilities invalidated after every PUT.
  assert.match(page, /onMutate: async \(\{ name, patch \}\) => \{/);
  assert.match(page, /const previous = qc\.getQueryData<AdminFlagRow\[\]>\(FLAGS_KEY\);/);
  assert.match(page, /if \(context\?\.previous\) qc\.setQueryData\(FLAGS_KEY, context\.previous\);/);
  assert.match(page, /void qc\.invalidateQueries\(\{ queryKey: CAPABILITIES_KEY \}\);/);
  assert.match(page, /const CAPABILITIES_KEY = \['system', 'capabilities'\] as const;/, 'the same key AdminSystem reads');
  assert.match(page, /mapFlagError\(parseApiError\(e\), name\)/);
  assert.match(page, /if \(mapped\.kind === 'not-found'\) setUnregistered/);
  // A field error the open editor cannot show (enabled, or the editor is closed) still toasts.
  assert.match(page, /if \(!readsInline\(mapped, expandedRef\.current === name\)\) toast\.error/);
  // Only a form save closes the editor; a switch toggle leaves an open draft alone.
  assert.match(page, /if \(isFormPatch\(patch\)\) setExpanded\(\(current\) => \(current === name \? null : current\)\);/);
  // A fresh GET clears the FLAG_NOT_FOUND lock for any name it returns.
  assert.match(page, /\}, \[flags\.data, flags\.dataUpdatedAt\]\);/);
  assert.match(page, /const next = new Set\(\[\.\.\.prev\]\.filter\(\(name\) => !names\.has\(name\)\)\);/);
  // Refresh stays focusable while fetching.
  assert.doesNotMatch(page, /disabled=\{flags\.isFetching/);
  assert.match(page, /aria-busy=\{refreshing \|\| undefined\}/);

  // A stays-false flag asks first.
  assert.match(page, /const decision = staysFalseDecision\(name\);/);
  assert.match(page, /if \(next && decision\) \{\s*setConfirm\(\{ name, \.\.\.decision \}\);\s*return;\s*\}/);
  assert.match(page, /<ConfirmDialog/);
  assert.match(page, /confirmLabel="Enable anyway"/);
  assert.match(page, /save\.mutate\(\{ name, patch: \{ enabled: true \} \}\);/);

  // Copy: sentence case, the honest 404 for a build without the route.
  assert.match(page, /title="Feature flags"/);
  assert.match(page, /This API build has no flags route/);
  assert.match(page, /label="Search flags"/);
  assert.match(page, /label="Refresh flags"/);
});

test('the table is prop-driven and imports nothing the Node loader cannot read', () => {
  const table = read('src/pages/admin/AdminFlagsTable.tsx');
  assert.doesNotMatch(table, /from '\.\/AdminLayout'/, 'AdminLayout pulls in the console stylesheet');
  assert.doesNotMatch(table, /useQuery|useMutation|useNavigate|useAuth/);
  assert.match(table, /import \{ TimeStamp \} from '\.\/adminCards';/);
  assert.match(table, /label=\{`Enable \$\{entry\.name\}`\}/, 'the switch is labelled by flag name');
  assert.match(table, /maxLength=\{NOTE_MAX\}/);
  assert.match(table, /aria-expanded=\{expanded\}/);
  assert.match(table, /aria-controls=\{editorId\}/);
  assert.match(table, /<th scope="rowgroup" colSpan=\{COLUMNS\}/, 'the group heading heads rows, not columns');
  // The switch stays focusable during a PUT; rows are never dimmed (12 px text would fall under 4.5:1).
  assert.match(table, /busy=\{pending\}/);
  assert.doesNotMatch(table, /opacity-70/);
  // The percentage unit is in the copy, not a detached trailing adornment.
  assert.doesNotMatch(table, /trailing=/);
  // The editor is not remounted on row values; it compares seed and row instead.
  assert.doesNotMatch(table, /key=\{`\$\{row\.name\}:/);
  assert.match(table, /const changedUnderneath = rolloutChanged\(seed, row\);/);
  assert.match(table, /serverFieldError\(error, field, submitted, draft\)/);
});

/* ------------------------------------------------ editor and row helpers */

test('readsInline: only a field the open editor shows reads inline; enabled and a closed editor are the row\'s', () => {
  const invalid = (field) => ({ kind: 'invalid', field, message: 'x', retryAfterSec: null });
  assert.equal(flags.readsInline(invalid('allowlist'), true), true);
  assert.equal(flags.readsInline(invalid('percentage'), true), true);
  assert.equal(flags.readsInline(invalid('note'), true), true);
  assert.equal(flags.readsInline(invalid('allowlist'), false), false, 'editor closed: the row shows it');
  assert.equal(flags.readsInline(invalid('enabled'), true), false, 'the editor never shows enabled');
  assert.equal(flags.readsInline(invalid(null), true), false, 'row-level');
  assert.equal(flags.readsInline(null, true), false);
});

test('serverFieldError: the API\'s message stays only while the field still reads as submitted', () => {
  const err = { kind: 'invalid', field: 'allowlist', message: 'Allowlist entries must be 24-character hex user ids, at most 200.', retryAfterSec: null };
  const sent = { percentage: '25', allowlist: 'nope', note: '' };
  assert.equal(flags.serverFieldError(err, 'allowlist', sent, sent), err.message);
  assert.equal(flags.serverFieldError(err, 'allowlist', sent, { ...sent, allowlist: ID_A }), null, 'edited: the local check takes over');
  assert.equal(flags.serverFieldError(err, 'allowlist', sent, { ...sent, note: 'other field edited' }), err.message, 'another field does not clear it');
  assert.equal(flags.serverFieldError(err, 'percentage', sent, sent), null, 'not that field');
  assert.equal(flags.serverFieldError(err, 'allowlist', null, sent), err.message, 'no submit recorded: the message shows');
  assert.equal(flags.serverFieldError(null, 'allowlist', sent, sent), null);
});

test('isFormPatch and rolloutChanged: a switch-only body is not the form\'s; only percentage, allowlist and note count as changed underneath', () => {
  assert.equal(flags.isFormPatch({ enabled: true }), false);
  assert.equal(flags.isFormPatch({}), false);
  assert.equal(flags.isFormPatch({ percentage: 10 }), true);
  assert.equal(flags.isFormPatch({ enabled: true, note: 'x' }), true);
  const seed = row({ percentage: 25, allowlist: [ID_A], note: 'a' });
  assert.equal(flags.rolloutChanged(seed, seed), false);
  assert.equal(flags.rolloutChanged(seed, row({ ...seed, enabled: true, updatedAt: '2026-09-20T12:00:00.000Z' })), false, 'a switch save is not a rollout change');
  assert.equal(flags.rolloutChanged(seed, row({ ...seed, percentage: 50 })), true);
  assert.equal(flags.rolloutChanged(seed, row({ ...seed, allowlist: [ID_A, ID_B] })), true);
  assert.equal(flags.rolloutChanged(seed, row({ ...seed, allowlist: [ID_A.toUpperCase()] })), false, 'allowlist compared as a case-insensitive set');
  assert.equal(flags.rolloutChanged(seed, row({ ...seed, note: 'a ' })), false, 'note compared trimmed');
  assert.equal(flags.rolloutChanged(seed, row({ ...seed, note: 'b' })), true);
});
