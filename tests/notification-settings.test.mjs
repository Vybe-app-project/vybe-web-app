import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const lib = await import('../src/lib/notificationSettings.ts');
const hooks = await import('../src/lib/hooks.ts');

/**
 * The push switches as of vybe-backend/services/notificationDelivery.js
 * DEFAULT_NOTIFICATION_SETTINGS (18 keys). When a backend checkout is beside
 * this one (or VYBE_BACKEND_DIR points at one) the live table is parsed
 * instead, so a new switch on the server fails here until the web has a row
 * for it.
 */
const STATIC_BACKEND_DEFAULTS = {
  pauseAll: false,
  messagesFromFollowing: true,
  messagesFromOthers: false,
  newFollowers: true,
  workoutPosts: true,
  likes: true,
  comments: true,
  friendRequests: true,
  planShares: true,
  gymCommunity: true,
  rhythm: true,
  events: true,
  mentions: true,
  weeklyRecap: true,
  sessions: true,
  checkins: true,
  hydration: false,
  achievements: true,
};

function backendDefaults() {
  const candidates = [process.env.VYBE_BACKEND_DIR, path.join(root, '..', 'vybe-backend')].filter(Boolean);
  for (const dir of candidates) {
    const file = path.join(dir, 'services', 'notificationDelivery.js');
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const block = source.match(/const DEFAULT_NOTIFICATION_SETTINGS = Object\.freeze\(\{([\s\S]*?)\}\);/);
    if (!block) continue;
    const defaults = {};
    for (const match of block[1].matchAll(/^\s*([A-Za-z]+):\s*(true|false)\b/gm)) defaults[match[1]] = match[2] === 'true';
    return { source: file, defaults };
  }
  return null;
}

function backendEmailDefaults() {
  const candidates = [process.env.VYBE_BACKEND_DIR, path.join(root, '..', 'vybe-backend')].filter(Boolean);
  for (const dir of candidates) {
    const file = path.join(dir, 'models', 'EmailUnsubscribeToken.js');
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const block = source.match(/const EMAIL_UNSUBSCRIBE_KINDS = Object\.freeze\(\[([\s\S]*?)\]\);/);
    if (!block) continue;
    return { source: file, kinds: [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]) };
  }
  return null;
}

const LEGACY_TITLES = {
  pauseAll: 'Pause all notifications',
  messagesFromFollowing: 'Messages from people you follow',
  messagesFromOthers: 'Messages from everyone else',
  newFollowers: 'New followers',
  workoutPosts: 'Workout posts',
  likes: 'Likes',
  comments: 'Comments',
  friendRequests: 'Friend requests',
};

test('the 18 push switches match the API in order and in default', () => {
  const live = backendDefaults();
  const expected = live ? live.defaults : STATIC_BACKEND_DEFAULTS;
  assert.deepEqual([...lib.NOTIFICATION_SETTING_KEYS], Object.keys(expected), live ? `keys drifted from ${live.source}` : 'keys drifted from the static list');
  assert.deepEqual(lib.DEFAULT_NOTIFICATION_SETTINGS, expected, 'defaults must mirror the backend');
  assert.equal(lib.NOTIFICATION_SETTING_KEYS.length, 18);
  // Only these three start off.
  assert.deepEqual(
    Object.entries(lib.DEFAULT_NOTIFICATION_SETTINGS).filter(([, v]) => v === false).map(([k]) => k),
    ['pauseAll', 'messagesFromOthers', 'hydration'],
  );
  // hooks.ts keeps every historical export name pointing at the same values.
  assert.equal(hooks.NOTIFICATION_SETTING_KEYS, lib.NOTIFICATION_SETTING_KEYS);
  assert.equal(hooks.DEFAULT_NOTIFICATION_SETTINGS, lib.DEFAULT_NOTIFICATION_SETTINGS);
  assert.equal(hooks.pickNotificationSettings, lib.pickNotificationSettings);
  assert.equal(hooks.EMAIL_SETTING_KEYS, lib.EMAIL_SETTING_KEYS);
  assert.equal(hooks.pickEmailSettings, lib.pickEmailSettings);
});

test('every switch except pauseAll sits in exactly one group, in the agreed order', () => {
  assert.deepEqual(
    lib.NOTIFICATION_SETTING_GROUPS.map((g) => g.title),
    ['Activity', 'Messages', 'Community and gyms', 'Training rhythm and recaps', 'Reminders'],
  );
  const seen = new Map();
  for (const group of lib.NOTIFICATION_SETTING_GROUPS) {
    assert.ok(group.id && group.title, 'every group has an id and a title');
    for (const key of group.keys) {
      assert.ok(lib.NOTIFICATION_SETTING_KEYS.includes(key), `${key} is not an API key`);
      assert.ok(!seen.has(key), `${key} appears in ${seen.get(key)} and ${group.id}`);
      seen.set(key, group.id);
    }
  }
  assert.ok(!seen.has('pauseAll'), 'pauseAll renders on its own, first');
  const grouped = [...seen.keys()].sort();
  const expected = lib.NOTIFICATION_SETTING_KEYS.filter((k) => k !== 'pauseAll').sort();
  assert.deepEqual(grouped, expected, 'every non-pauseAll key is grouped');
  // Water check-ins is the last row of the last group: the times editor renders under it.
  assert.equal(lib.NOTIFICATION_SETTING_GROUPS.at(-1).keys.at(-1), 'hydration');
});

test('every switch has a title and a one-sentence hint, the legacy titles are verbatim, and nothing shouts', () => {
  const banned = /!|\bstreak\b|\bmissed\b|\blost\b|\bbroke\b|\bexpire|\bhurry\b|last chance|we miss you|\bcalories\b|\bcrushed\b|\bbeast\b/i;
  for (const key of lib.NOTIFICATION_SETTING_KEYS) {
    const label = lib.NOTIFICATION_LABELS[key];
    assert.ok(label && label.title.length > 0 && label.hint.length > 0, `${key} needs a title and a hint`);
    assert.doesNotMatch(label.title, banned, `${key} title`);
    assert.doesNotMatch(label.hint, banned, `${key} hint`);
    assert.match(label.title, /^[A-Z]/, `${key} title is sentence case`);
    assert.match(label.hint, /\.$/, `${key} hint is a sentence`);
  }
  for (const [key, title] of Object.entries(LEGACY_TITLES)) {
    assert.equal(lib.NOTIFICATION_LABELS[key].title, title, `${key} is an existing accessible name`);
  }
  for (const key of lib.EMAIL_SETTING_KEYS) {
    const label = lib.EMAIL_LABELS[key];
    assert.ok(label && label.title && label.hint, `${key} email row needs copy`);
    assert.doesNotMatch(`${label.title} ${label.hint}`, banned);
  }
  assert.equal(lib.EMAIL_LABELS.productUpdates.title, 'Marketing and product updates');
  assert.equal(lib.EMAIL_PAUSE_LABEL.title, 'Pause all email');
  assert.doesNotMatch(`${lib.EMAIL_PAUSE_LABEL.title} ${lib.EMAIL_PAUSE_LABEL.hint}`, banned);
  // The product vocabulary is "email" (claude-main and the mobile app); the API's "e-mail" is never shown.
  for (const key of lib.EMAIL_SETTING_KEYS) assert.doesNotMatch(`${lib.EMAIL_LABELS[key].title} ${lib.EMAIL_LABELS[key].hint}`, /e-mail/i);
  assert.doesNotMatch(`${lib.EMAIL_PAUSE_LABEL.title} ${lib.EMAIL_PAUSE_LABEL.hint}`, /e-mail/i);
  for (const key of lib.NOTIFICATION_SETTING_KEYS) assert.doesNotMatch(`${lib.NOTIFICATION_LABELS[key].title} ${lib.NOTIFICATION_LABELS[key].hint}`, /e-mail/i);
  for (const sentence of Object.values(lib.HYDRATION_TIMES_ERRORS)) assert.doesNotMatch(sentence, /e-mail/i);
  // The old inline table is gone from the page; the page reads the shared one.
  const settings = read('src/pages/Settings.tsx');
  assert.doesNotMatch(settings, /const NOTIFICATION_LABELS/);
  assert.match(settings, /NOTIFICATION_SETTING_GROUPS\.map\(/);
  assert.match(settings, /<SettingsCard id="notifications"/);
  assert.match(settings, /save\.mutate\(\{ pauseAll: checked \}\)/);
  assert.match(settings, /<HydrationTimesEditor\b/);
});

test('hydration times: sorted, one to three, HH:MM, distinct; seconds from a time input are dropped', () => {
  assert.deepEqual(lib.validateHydrationTimes(['13:00', '09:00']), { value: ['09:00', '13:00'] });
  assert.deepEqual(lib.validateHydrationTimes(['08:00:00']), { value: ['08:00'] }, 'HH:MM:SS is normalised');
  assert.equal(lib.normalizeClock('08:00:00'), '08:00');
  assert.equal(lib.normalizeClock('8:05'), '08:05');
  assert.equal(lib.normalizeClock(' 21:30 '), '21:30');
  assert.equal(lib.normalizeClock(''), '');
  assert.equal(lib.HYDRATION_TIMES_MAX, 3);
  assert.equal(String(lib.CLOCK_RE), String(/^([01]\d|2[0-3]):[0-5]\d$/), 'same pattern as services/returnLoop.js CLOCK_PATTERN');

  const empty = lib.validateHydrationTimes([]);
  const many = lib.validateHydrationTimes(['06:00', '09:00', '12:00', '15:00']);
  const shape = lib.validateHydrationTimes(['8:0']);
  const blank = lib.validateHydrationTimes(['09:00', '']);
  const dupes = lib.validateHydrationTimes(['08:00', '08:00']);
  const late = lib.validateHydrationTimes(['24:00']);
  for (const result of [empty, many, shape, blank, dupes, late]) {
    assert.equal(result.value, undefined);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
    assert.doesNotMatch(result.error, /!/);
  }
  assert.equal(empty.error, lib.HYDRATION_TIMES_ERRORS.empty);
  assert.equal(many.error, lib.HYDRATION_TIMES_ERRORS.tooMany);
  assert.equal(shape.error, lib.HYDRATION_TIMES_ERRORS.format);
  assert.equal(shape.index, 0, 'a malformed row is named');
  // A row that was added and never filled is its own sentence, anchored to that row; a time input
  // can only emit '' or a valid HH:MM, so on the web this is the shape error a member can reach.
  assert.equal(blank.error, lib.HYDRATION_TIMES_ERRORS.blank);
  assert.equal(blank.index, 1);
  assert.equal(lib.HYDRATION_TIMES_ERRORS.blank, 'Pick a time for each reminder, or remove the empty row.');
  assert.doesNotMatch(lib.HYDRATION_TIMES_ERRORS.blank, /24-hour/, 'a 12-hour locale sees 9:00 AM in the picker');
  assert.deepEqual(lib.validateHydrationTimes(['', '09:00']), { error: lib.HYDRATION_TIMES_ERRORS.blank, index: 0 });
  assert.deepEqual(lib.validateHydrationTimes(['']), { error: lib.HYDRATION_TIMES_ERRORS.blank, index: 0 });
  assert.equal(lib.validateHydrationTimes(['09:00', '', '8:0']).index, 1, 'blank is reported before format');
  assert.equal(dupes.error, lib.HYDRATION_TIMES_ERRORS.duplicate);
  assert.equal(dupes.index, undefined, 'duplicates belong to the set, not one row');
  assert.equal(many.index, undefined);
  assert.equal(late.error, lib.HYDRATION_TIMES_ERRORS.format);

  assert.deepEqual(lib.pickHydrationReminders({ times: ['17:00', '09:00', '09:00'] }), { times: ['09:00', '17:00'] });
  assert.equal(lib.pickHydrationReminders(null), null);
  assert.equal(lib.pickHydrationReminders({ times: [] }), null);
  assert.equal(lib.pickHydrationReminders({ times: ['nope'] }), null);
});

test('the save toast names the times when the save also turned the switch on', () => {
  assert.equal(lib.listClockTimes(['09:00']), '09:00');
  assert.equal(lib.listClockTimes(['09:00', '13:00']), '09:00 and 13:00');
  assert.equal(lib.listClockTimes(['06:00', '12:00', '18:00']), '06:00, 12:00 and 18:00');
  assert.equal(lib.listClockTimes([]), '');
  assert.equal(lib.hydrationSavedToast(['09:00', '13:00'], true), 'Water check-ins on at 09:00 and 13:00');
  assert.equal(lib.hydrationSavedToast(['09:00'], true), 'Water check-ins on at 09:00');
  assert.equal(lib.hydrationSavedToast(['09:00', '13:00'], false), 'Water check-in times saved');
  assert.equal(lib.hydrationSavedToast([], true), 'Water check-in times saved');
  for (const sentence of [lib.hydrationSavedToast(['09:00'], true), lib.hydrationSavedToast(['09:00'], false)]) assert.doesNotMatch(sentence, /!/);
  // The editor says what Save does while the switch is off, and sends the switch in the same request.
  const editor = read('src/pages/settings/HydrationTimesEditor.tsx');
  assert.match(editor, /Saving times turns Water check-ins on\./);
  assert.doesNotMatch(editor, /Turn on Water check-ins to receive these/);
  assert.match(editor, /if \(!hydrationOn\) body\.hydration = true;/);
  assert.match(editor, /hydrationSavedToast\(patch\.hydrationReminders\.times, patch\.hydration === true\)/);
});

test('the two hydration 400s the API can still send are worded for the web, with the quiet-hours window named', () => {
  const quietHours = { start: '22:00', end: '07:00' };
  const conflict = {
    code: 'HYDRATION_TIME_IN_QUIET_HOURS',
    message: '23:00 is inside your quiet hours. Pick a time outside them',
    body: { message: '23:00 is inside your quiet hours. Pick a time outside them', field: 'hydrationReminders', code: 'HYDRATION_TIME_IN_QUIET_HOURS', time: '23:00' },
  };
  assert.equal(lib.hydrationSaveErrorMessage(conflict, quietHours), '23:00 is inside your quiet hours (22:00 to 07:00). Pick a time outside them.');
  assert.equal(lib.hydrationSaveErrorMessage(conflict, null), '23:00 is inside your quiet hours. Pick a time outside them.', 'no window known: still a sentence');
  assert.equal(
    lib.hydrationSaveErrorMessage({ ...conflict, body: { code: conflict.code } }, quietHours),
    'One of these times is inside your quiet hours (22:00 to 07:00). Pick a time outside them.',
    'a body without `time` still reads',
  );
  assert.equal(lib.hydrationSaveErrorMessage({ ...conflict, body: { time: '<b>x</b>' } }, quietHours).startsWith('One of these times'), true, 'only a clock time is echoed');
  const timezone = {
    code: 'TIMEZONE_REQUIRED',
    message: 'Water check-ins need your timezone. Update the app, then try again.',
    body: { code: 'TIMEZONE_REQUIRED', field: 'hydrationReminders' },
  };
  assert.equal(lib.hydrationSaveErrorMessage(timezone, null), lib.HYDRATION_TIMEZONE_MESSAGE);
  assert.equal(lib.HYDRATION_TIMEZONE_MESSAGE, 'Water check-ins need your timezone. Reload this page so Vybe can save it, then try again.');
  assert.doesNotMatch(lib.HYDRATION_TIMEZONE_MESSAGE, /Update the app/, 'the API sentence is written for the phone');
  // Anything else keeps the API's sentence.
  assert.equal(lib.hydrationSaveErrorMessage({ code: null, message: 'hydrationReminders.times must be distinct' }, quietHours), 'hydrationReminders.times must be distinct');
  assert.equal(lib.hydrationSaveErrorMessage({ message: 'x' }, null), 'x');
  // The window is shown on the page, so the member can read what to avoid.
  assert.equal(lib.quietHoursHint(quietHours), 'Quiet hours are 22:00 to 07:00. Pick times outside them.');
  assert.equal(lib.quietHoursHint(null), null);
  const editor = read('src/pages/settings/HydrationTimesEditor.tsx');
  assert.match(editor, /hydrationSaveErrorMessage\(parsed, quietHours\)/);
  assert.match(editor, /quietHoursHint\(quietHours\)/);
  assert.match(read('src/pages/Settings.tsx'), /quietHours=\{response\.quietHours\}/);
});

test('the settings body is read whole: defaults filled, quiet hours and times beside the switches', () => {
  const body = {
    settings: { pauseAll: true, comments: false, hydration: true, nope: true },
    quietHours: { start: '22:00', end: '07:00' },
    quietHoursTimezone: 'America/New_York',
    hydrationReminders: { times: ['13:00', '09:00'] },
  };
  const picked = lib.pickNotificationSettingsResponse(body);
  assert.equal(picked.settings.pauseAll, true);
  assert.equal(picked.settings.comments, false);
  assert.equal(picked.settings.hydration, true);
  assert.equal(picked.settings.likes, true, 'a missing key takes the default');
  assert.equal('nope' in picked.settings, false, 'unknown keys are dropped');
  assert.deepEqual(Object.keys(picked.settings), [...lib.NOTIFICATION_SETTING_KEYS]);
  assert.deepEqual(picked.quietHours, { start: '22:00', end: '07:00' });
  assert.equal(picked.quietHoursTimezone, 'America/New_York');
  assert.deepEqual(picked.hydrationReminders, { times: ['09:00', '13:00'] });

  const bare = lib.pickNotificationSettingsResponse({ settings: { likes: false } });
  assert.equal(bare.hydrationReminders, null);
  assert.equal(bare.quietHours, null);
  assert.equal(bare.quietHoursTimezone, null);
  // A legacy body that is only the switches still reads.
  assert.equal(lib.pickNotificationSettingsResponse({ likes: false }).settings.likes, false);
  assert.deepEqual(lib.pickNotificationSettingsResponse(undefined), lib.EMPTY_NOTIFICATION_SETTINGS_RESPONSE);
  assert.equal(lib.pickNotificationSettingsResponse({ hydrationReminders: 'soon' }).hydrationReminders, null);
});

test('email preferences: nine kinds in the API order, marketing off by default', () => {
  const live = backendEmailDefaults();
  const kinds = live ? live.kinds.filter((k) => k !== 'all') : ['newFollowers', 'workoutPosts', 'likes', 'comments', 'friendRequests', 'weeklyRecap', 'checkins', 'achievements', 'productUpdates'];
  assert.deepEqual([...lib.EMAIL_SETTING_KEYS], kinds, live ? `email kinds drifted from ${live.source}` : 'email kinds drifted');
  assert.equal(lib.DEFAULT_EMAIL_SETTINGS.productUpdates, false, 'marketing is never pre-checked');
  for (const key of lib.EMAIL_SETTING_KEYS) if (key !== 'productUpdates') assert.equal(lib.DEFAULT_EMAIL_SETTINGS[key], true);
  assert.deepEqual(lib.pickEmailSettings({ likes: false, pauseAll: true }), { ...lib.DEFAULT_EMAIL_SETTINGS, likes: false });
  assert.equal(lib.pickEmailSettings(undefined).productUpdates, false);
});
