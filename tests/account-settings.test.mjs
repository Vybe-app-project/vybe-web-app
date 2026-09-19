/**
 * Account and settings against API 4e22914: the timezone sync decision, the
 * hidden-words parser, the removed entitlement readers, and the source pins
 * for the new controls and the `PUT /users/settings` allow-list.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/** Import-free modules load straight from source (the units.test.mjs pattern). */
async function loadModule(relative) {
  const source = read(relative);
  assert.doesNotMatch(source, /^\s*import\s/m, `${relative} must stay import-free so tests can load it directly`);
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(relative),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`);
}

const tz = await loadModule('src/lib/timezoneSync.ts');
const hidden = await loadModule('src/lib/hiddenWords.ts');
const a11y = await loadModule('src/lib/accessibility.ts');
const types = await loadModule('src/lib/accountTypes.ts');

/** controllers/userController.js SETTINGS_KEYS at 4e22914. */
const BACKEND_SETTINGS_KEYS = ['privacy', 'notifications', 'health', 'hiddenWords', 'commentDefault', 'units', 'locale', 'timezone', 'accessibility'];

/* ------------------------------------------------------------------ timezone */

test('timezone sync: the decision table', () => {
  const NY = 'America/New_York';
  const decide = (input) => tz.timezoneSyncDecision({ lastSentZone: null, ...input });
  assert.deepEqual(decide({ browserZone: null, storedZone: undefined }), { action: 'skip', reason: 'no-browser-zone' });
  assert.deepEqual(decide({ browserZone: NY, storedZone: undefined, visible: false }), { action: 'skip', reason: 'hidden' });
  assert.deepEqual(decide({ browserZone: NY, storedZone: undefined, pendingDeletion: true }), { action: 'skip', reason: 'pending-deletion' });
  assert.deepEqual(decide({ browserZone: NY, storedZone: NY }), { action: 'skip', reason: 'same' });
  // The server canonicalises aliases, so the stored name can differ forever; what this session sent wins.
  assert.deepEqual(decide({ browserZone: 'Asia/Calcutta', storedZone: 'Asia/Kolkata', lastSentZone: 'Asia/Calcutta' }), { action: 'skip', reason: 'already-sent' });
  assert.deepEqual(decide({ browserZone: 'Europe/Paris', storedZone: undefined }), { action: 'put', zone: 'Europe/Paris' });
  assert.deepEqual(decide({ browserZone: 'Europe/Paris', storedZone: null }), { action: 'put', zone: 'Europe/Paris' });
  assert.deepEqual(decide({ browserZone: 'Europe/Paris', storedZone: NY, lastSentZone: NY }), { action: 'put', zone: 'Europe/Paris' }, 'moved zones');
  // Visible defaults to true; an empty browser zone is "none".
  assert.deepEqual(decide({ browserZone: '', storedZone: undefined }), { action: 'skip', reason: 'no-browser-zone' });
  assert.equal(decide({ browserZone: NY, storedZone: undefined }).action, 'put');
});

test('the already-sent memory is scoped to the account that wrote it', () => {
  const { TZ_SENT_KEY, readSentZone, rememberSentZone, forgetSentZone } = tz;
  const NY = 'America/New_York';
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  assert.equal(TZ_SENT_KEY, 'vybe.tzSent');
  assert.equal(readSentZone(storage, 'a'), null, 'nothing sent yet');

  // Account A sends its zone; a reload of the same tab still knows it.
  rememberSentZone(storage, 'a', NY);
  assert.equal(readSentZone(storage, 'a'), NY);
  assert.deepEqual(JSON.parse(map.get(TZ_SENT_KEY)), { userId: 'a', zone: NY }, 'stored with the account that sent it');

  // A signs out, B signs in on the same tab (sessionStorage survives): B has sent nothing.
  assert.equal(readSentZone(storage, 'b'), null, 'another account never inherits the entry');
  assert.equal(tz.timezoneSyncDecision({ browserZone: NY, storedZone: undefined, lastSentZone: readSentZone(storage, 'b') }).action, 'put', 'so B gets a PUT');
  assert.equal(tz.timezoneSyncDecision({ browserZone: NY, storedZone: undefined, lastSentZone: readSentZone(storage, 'a') }).action, 'skip', 'while A would not');

  // B sending replaces A's entry outright.
  rememberSentZone(storage, 'b', 'Europe/Paris');
  assert.equal(readSentZone(storage, 'a'), null);
  assert.equal(readSentZone(storage, 'b'), 'Europe/Paris');

  // Forgetting clears it for everyone.
  forgetSentZone(storage);
  assert.equal(map.size, 0);
  assert.equal(readSentZone(storage, 'b'), null);

  // The legacy bare-zone value, a corrupt entry, a missing storage and a throwing storage all read as "nothing sent".
  map.set(TZ_SENT_KEY, NY);
  assert.equal(readSentZone(storage, 'a'), null, 'a pre-scoping value is not trusted');
  map.set(TZ_SENT_KEY, '{"userId":"a"}');
  assert.equal(readSentZone(storage, 'a'), null);
  map.set(TZ_SENT_KEY, 'not json');
  assert.equal(readSentZone(storage, 'a'), null);
  assert.equal(readSentZone(null, 'a'), null);
  assert.equal(readSentZone(storage, ''), null, 'no account, no memory');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(readSentZone(throwing, 'a'), null);
  assert.doesNotThrow(() => rememberSentZone(throwing, 'a', NY));
  assert.doesNotThrow(() => forgetSentZone(throwing));
  assert.doesNotThrow(() => rememberSentZone(null, 'a', NY));
});

test('browserTimeZone() answers a non-empty IANA name under Node 24 and never throws', () => {
  const zone = tz.browserTimeZone();
  assert.equal(typeof zone, 'string');
  assert.ok(zone.length > 0);
  assert.doesNotThrow(() => new Intl.DateTimeFormat(undefined, { timeZone: zone }), 'the zone is one Intl accepts');
  const original = Intl.DateTimeFormat;
  try {
    Intl.DateTimeFormat = () => { throw new Error('no Intl'); };
    assert.equal(tz.browserTimeZone(), null);
  } finally {
    Intl.DateTimeFormat = original;
  }
});

/* ------------------------------------------------------------------ hidden words */

test('parseHiddenWords: the server rules, entry by entry', () => {
  const { parseHiddenWords, HIDDEN_WORDS_MAX_CUSTOM, HIDDEN_WORDS_MAX_LENGTH } = hidden;
  assert.equal(HIDDEN_WORDS_MAX_CUSTOM, 200);
  assert.equal(HIDDEN_WORDS_MAX_LENGTH, 40);
  // The pinned backend example (hidden-words.test.js): case-insensitive dedupe keeps the first spelling.
  assert.deepEqual(parseHiddenWords('Weak sauce, weak SAUCE\n🤡'), { words: ['Weak sauce', '🤡'], errors: [] });
  assert.deepEqual(parseHiddenWords('weak   sauce'), { words: ['weak sauce'], errors: [] });
  assert.deepEqual(parseHiddenWords(',,\n\n'), { words: [], errors: [] });
  assert.deepEqual(parseHiddenWords(' \r\n , '), { words: [], errors: [] });
  assert.deepEqual(parseHiddenWords('a'.repeat(41)), { words: [], errors: ['Each hidden word must be 40 characters or fewer'] });
  assert.deepEqual(parseHiddenWords('a'.repeat(40)).errors, []);
  assert.deepEqual(parseHiddenWords('!!!'), { words: [], errors: ['"!!!" has no letters, numbers or emoji to match'] });
  assert.deepEqual(parseHiddenWords('bad\u0007word'), { words: [], errors: ['Hidden words cannot contain control characters'] });
  assert.deepEqual(parseHiddenWords('Café, cafe'), { words: ['Café'], errors: [] }, 'NFKD + stripped marks dedupe');
  assert.deepEqual(parseHiddenWords('Loser, l0ser, LOSER!'), { words: ['Loser'], errors: [] }, 'leet folding matches the server');
  assert.deepEqual(parseHiddenWords('10k, 3 sets'), { words: ['10k', '3 sets'], errors: [] }, 'plain numbers are not leet');
  const many = Array.from({ length: 201 }, (_, i) => `word${i}`).join('\n');
  const overflow = parseHiddenWords(many);
  assert.equal(overflow.words.length, 201, 'words stay usable so the counter can show the overflow');
  assert.deepEqual(overflow.errors, ['Hidden words are limited to 200 entries']);
  // Valid entries survive alongside an invalid one; the invalid one is reported once.
  const mixed = parseHiddenWords(`ok, ${'x'.repeat(41)}, also ok, ${'y'.repeat(50)}`);
  assert.deepEqual(mixed.words, ['ok', 'also ok']);
  assert.deepEqual(mixed.errors, ['Each hidden word must be 40 characters or fewer']);
});

test('formatHiddenWords and parseHiddenWords round-trip; sameHiddenWords is order-sensitive', () => {
  const words = ['Weak sauce', '🤡', 'Café'];
  assert.equal(hidden.formatHiddenWords(words), 'Weak sauce\n🤡\nCafé');
  assert.deepEqual(hidden.parseHiddenWords(hidden.formatHiddenWords(words)).words, words);
  assert.equal(hidden.formatHiddenWords(undefined), '');
  assert.equal(hidden.sameHiddenWords(words, [...words]), true);
  assert.equal(hidden.sameHiddenWords(words, ['🤡', 'Weak sauce', 'Café']), false);
  assert.equal(hidden.sameHiddenWords(words, words.slice(0, 2)), false);
});

/* ------------------------------------------------------------------ accessibility */

test('applyAccessibility is a no-op without a DOM and the attribute names are stable', () => {
  assert.equal(a11y.REDUCE_MOTION_ATTR, 'data-reduce-motion');
  assert.equal(a11y.LARGE_TEXT_ATTR, 'data-large-text');
  assert.doesNotThrow(() => a11y.applyAccessibility({ reduceMotion: true, largeText: true }));
  assert.doesNotThrow(() => a11y.applyAccessibility(null));
  assert.equal(a11y.reduceMotionRequested(), false);
});

/* ------------------------------------------------------------------ contract types */

test('SETTINGS_KEYS, COMMENT_POLICIES and ACCESSIBILITY_KEYS mirror the backend', () => {
  assert.deepEqual([...types.SETTINGS_KEYS], BACKEND_SETTINGS_KEYS);
  assert.deepEqual([...types.COMMENT_POLICIES], ['everyone', 'followers', 'following', 'off']);
  assert.deepEqual([...types.ACCESSIBILITY_KEYS], ['reduceMotion', 'largeText']);
  assert.match(read('src/lib/hooks.ts'), /export \* from '\.\/accountTypes';/, 'hooks.ts re-exports the contract');
});

/* ------------------------------------------------------------------ source pins */

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(abs) : /\.(ts|tsx)$/.test(entry.name) ? [abs] : [];
  });

test('the dead entitlement fields are gone: no reader of isPremium or isSubscribed anywhere', () => {
  for (const file of walk(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /isPremium|isSubscribed/, `${path.relative(root, file)} still reads a removed field`);
    assert.doesNotMatch(source, />\s*Premium\s*</, `${path.relative(root, file)} still renders a Premium badge`);
  }
  // Badges key on what the API sends now.
  assert.match(read('src/pages/UserRow.tsx'), /const verified = user\.isIdentityVerified === true;/);
  assert.match(read('src/pages/admin/AdminUsers.tsx'), /Verified \/ Admin \/ Deleted/);
  assert.match(read('src/pages/admin/AdminUsers.tsx'), /moderationSuspension\?\.active === true/);
});

test('the account types are wired into the session user and the public user', () => {
  const hooks = read('src/lib/hooks.ts');
  const auth = read('src/lib/auth.ts');
  for (const field of ['settings', 'hiddenWords', 'pendingDeletion', 'deletion', 'hasPassword']) {
    assert.match(hooks, new RegExp(`${field}\\?: AccountFields\\['${field}'\\];`), `PublicUser.${field}`);
    assert.match(auth, new RegExp(`${field}\\?: AccountFields\\['${field}'\\];`), `User.${field}`);
  }
  assert.doesNotMatch(hooks, /settings\?: \{ privacy\?: string \}/);
  // PUT /users/settings answers without hasPassword; the merge keeps it.
  assert.match(auth, /export const mergeAccount = /);
  assert.match(auth, /set\(\(s\) => \(\{ user: u \? mergeAccount\(s\.user, u\) : null \}\)\)/, 'setUser merges');
});

test('every PUT /users/settings body the web sends is inside the backend allow-list', () => {
  const callSites = [];
  for (const file of walk(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    const re = /api\.put\(\s*['"]\/users\/settings['"]\s*,\s*([^)]*)\)/g;
    for (const match of source.matchAll(re)) callSites.push({ file: path.relative(root, file), arg: match[1].trim() });
  }
  assert.ok(callSites.length >= 3, `expected the privacy, preference-sync and settings-card writers, found ${callSites.length}`);
  for (const { file, arg } of callSites) {
    if (arg.startsWith('{')) {
      const first = arg.match(/^\{\s*([A-Za-z]+)/)?.[1];
      assert.ok(first && BACKEND_SETTINGS_KEYS.includes(first), `${file}: literal body starts with "${first}", not an allow-listed key`);
    } else {
      assert.equal(arg, 'patch', `${file}: a non-literal body must be the typed \`patch\` variable`);
      const source = read(file);
      assert.match(source, /patch: SettingsPatch/, `${file}: \`patch\` must be typed SettingsPatch`);
    }
  }
  // The pinned privacy writer is untouched.
  assert.match(read('src/pages/Settings.tsx'), /api\.put\('\/users\/settings', \{ privacy \}\)/);
});

test('Settings mounts the preference cards once and the new controls send only their own key', () => {
  const settings = read('src/pages/Settings.tsx');
  const prefs = read('src/pages/SettingsPreferences.tsx');
  const pieces = read('src/pages/SettingsPieces.tsx');
  assert.match(settings, /import AccountPreferenceSections from '\.\/SettingsPreferences';/);
  // One SettingsCard / ToggleRow for the whole page, so the deep-link handler finds every card the same way.
  assert.match(settings, /import \{ SettingsCard, ToggleRow \} from '\.\/SettingsPieces';/);
  assert.match(prefs, /import \{ SettingsCard, ToggleRow \} from '\.\/SettingsPieces';/);
  assert.match(pieces, /export function SettingsCard\(/);
  assert.match(pieces, /export function ToggleRow\(/);
  assert.match(pieces, /role="region" aria-labelledby=\{`\$\{id\}-title`\}/);
  assert.match(settings, /getElementById\(`\$\{id\}-title`\)\?\.closest\('\[role="region"\]'\)/, 'the deep-link handler this shape serves');
  for (const file of [settings, prefs]) {
    assert.doesNotMatch(file, /function (SettingsCard|ToggleRow|PrefCard|PrefToggleRow)\(/, 'no private copy of the pieces');
  }
  assert.doesNotMatch(prefs, /Pref(Card|ToggleRow)/);
  assert.match(prefs, /<SettingsCard\s+id="comments"/);
  assert.match(prefs, /<SettingsCard id="accessibility"/);
  assert.equal((settings.match(/<AccountPreferenceSections \/>/g) || []).length, 1, 'one mount point');
  assert.match(settings, /<PrivacySection \/>\s*<AccountPreferenceSections \/>/, 'mounted right after Privacy');
  assert.match(settings, /<UnitsSection \/>/);
  // Comments: default policy + approve first.
  assert.match(prefs, /label="Who can comment by default"/);
  assert.match(prefs, /patch: \{ commentDefault: next \}/);
  assert.match(prefs, /patchCommentDefault\(\{ policy: value \}\)/);
  assert.match(prefs, /patchCommentDefault\(\{ approveFirst \}\)/);
  assert.match(prefs, /title="Approve comments first"/);
  // Hidden words: three switches + the editor, saved as hiddenWords.custom and re-hydrated from the answer.
  assert.match(prefs, /patch: \{ hiddenWords: next \}/);
  assert.match(prefs, /patch: \{ hiddenWords: \{ custom: words \} \}/);
  assert.match(prefs, /id="hidden-words"/);
  assert.match(prefs, /label="Your hidden words"/);
  assert.match(prefs, /Save hidden words/);
  assert.match(prefs, /settingsFieldError\(e, 'hiddenWords'\)/, 'the server message lands under the field');
  assert.match(prefs, /export function HiddenWordsEditor\(/);
  for (const title of ['Hide comments with hidden words', 'Use Vybe’s default list', 'Also filter message requests']) assert.match(prefs, new RegExp(`title="${title}"`));
  // Accessibility: applied at once, rolled back on failure.
  assert.match(prefs, /id="accessibility"/);
  assert.match(prefs, /patch: \{ accessibility: \{ reduceMotion \} \}/);
  assert.match(prefs, /patch: \{ accessibility: \{ largeText \} \}/);
  assert.match(prefs, /rollback: apply\(\{ reduceMotion \}\)/);
  assert.match(prefs, /title="Reduce motion"/);
  assert.match(prefs, /title="Larger text"/);
  // Every writer keeps hasPassword and the ['me'] query in step.
  assert.match(prefs, /setUser\(mergeAccount\(useAuth\.getState\(\)\.user, user as User\)\)/);
  assert.match(prefs, /qc\.setQueryData\(\['me'\], ctx\.previous\)/, 'rollback on error');
  // Pinned accessible names elsewhere are untouched.
  assert.match(settings, /title="Private account"/);
  // The delete card moved to its own file in the Wave C1 data lifecycle merge; the id survives there.
  assert.match(read('src/pages/settings/DeleteAccount.tsx'), /id="del-phrase"/);
  assert.match(read('src/components/UnitsControl.tsx'), /label = 'Units'/);
});

test('units: the store keeps its key and API, gains a hydrate path and a persister seam', () => {
  const units = read('src/lib/units.ts');
  assert.match(units, /UNITS_STORAGE_KEY = 'vybe\.units'/);
  assert.match(units, /export const setUnitsPersister = /);
  assert.match(units, /export const hydrateUnits = /);
  assert.match(units, /if \(system !== previous\) persister\?\.\(system, previous\);/, 'only a member-initiated change persists');
  const hydrateBody = units.slice(units.indexOf('export const hydrateUnits'), units.indexOf('export const useUnits'));
  assert.ok(hydrateBody.length > 0);
  assert.doesNotMatch(hydrateBody, /persister/, 'hydrateUnits never writes back');
  assert.match(read('src/components/UnitsControl.tsx'), /onChange=\{\(k: string\) => setSystem\(k as UnitSystem\)\}/);
});

test('the preference sync is mounted once and guards the cases that must never write', () => {
  const app = read('src/App.tsx');
  const sync = read('src/lib/accountPreferences.ts');
  assert.match(app, /import \{ AccountPreferencesSync \} from '\.\/lib\/accountPreferences';/);
  assert.match(app, /<SessionRefresh \/>\s*<AccountPreferencesSync \/>/);
  assert.equal((app.match(/<AccountPreferencesSync \/>/g) || []).length, 1);
  assert.match(sync, /pendingDeletion/);
  assert.match(sync, /visibilitychange/);
  // The already-sent memory is read and written per account, survives a reload, and is dropped on sign-out only.
  assert.match(sync, /lastSentZone: sentZoneFor\(userId\)/);
  assert.match(sync, /markSent\(userId, zone\);/);
  assert.match(sync, /rememberSentZone\(sessionStore\(\), userId, zone\)/, 'the last-sent zone survives a reload');
  assert.match(sync, /if \(previousUserId\.current\) forgetSent\(\);/, 'a sign-out forgets it; the signed-out first render does not');
  assert.doesNotMatch(sync, /sessionStorage\.(get|set|remove)Item/, 'storage access goes through the tested helpers');
  assert.match(sync, /if \(decision\.action !== 'put' \|\| timezoneInFlight\) return;/, 'one request in flight');
  assert.match(sync, /hydrateUnits\(units\);/);
  assert.match(sync, /setUnitsPersister\(null\)/, 'unregistered on sign-out');
  assert.match(sync, /applyAccessibility\(userId \? \{ reduceMotion, largeText \} : null\)/);
  assert.match(sync, /putSettings\(\{ timezone: zone \}\)/);
  assert.match(sync, /putSettings\(\{ units: system \}\)/);
  assert.doesNotMatch(sync, /locale/, 'locale is typed only; no writer');
});

test('reduced motion and large text: CSS mirrors the OS rules under the account attributes', () => {
  const css = read('src/styles.css');
  assert.match(css, /:root\[data-reduce-motion='true'\] \{ --duration-1: 1ms; --duration-2: 1ms; --duration-3: 1ms; --duration-4: 1ms; \}/);
  assert.match(css, /:root\[data-reduce-motion='true'\] \.skeleton::after \{ animation: none; \}/);
  assert.match(css, /:root\[data-reduce-motion='true'\] \.anim-nav-progress \{ animation: none;/);
  assert.match(css, /:root\[data-reduce-motion='true'\] \.typing-dot \{ animation: none;/);
  assert.match(css, /:root\[data-reduce-motion='true'\]::view-transition-new\(\*\) \{ animation: none !important; \}/);
  assert.match(css, /^html \{[^}]*font-size: 15px;/m, 'the base the step is measured from');
  assert.match(css, /:root\[data-large-text='true'\] \{ font-size: 17px; \}/, 'an absolute step from the 15px base, not a percentage of the browser default');
  assert.equal((css.match(/prefers-reduced-motion/g) || []).length, 5, 'the OS blocks are untouched');
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /export function prefersReducedMotion\(\): boolean \{[\s\S]*?getAttribute\('data-reduce-motion'\) === 'true'/);
  assert.match(ui, /export const useReducedMotion = \(\) => useMediaQuery\('\(prefers-reduced-motion: reduce\)'\);/, 'hook signature unchanged');
});
