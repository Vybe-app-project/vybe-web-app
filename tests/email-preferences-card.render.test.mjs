import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Render-level checks for the e-mail preferences card, the water check-in
 * times editor and the unsubscribe outcome block. All three are presentational
 * (every value arrives as a prop), so they render the same under
 * react-dom/server as in the browser. The query-bound sections around them
 * render TanStack's pending state here and are covered by the live browser run.
 */
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { DEFAULT_EMAIL_SETTINGS, EMAIL_SETTING_KEYS } = await import('../src/lib/notificationSettings.ts');
const { EmailPreferencesCard, pickEmailPreferences } = await import('../src/pages/settings/EmailPreferencesSection.tsx');
const { HydrationTimesEditor } = await import('../src/pages/settings/HydrationTimesEditor.tsx');
const { UnsubscribeOutcome } = await import('../src/pages/EmailUnsubscribe.tsx');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');
const switches = (html) => [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((m) => m[0]);
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

const noop = () => {};
const card = (props = {}) =>
  decode(
    mount(
      h(EmailPreferencesCard, {
        value: DEFAULT_EMAIL_SETTINGS,
        emailPaused: false,
        emailDelivery: true,
        dirty: false,
        onToggle: noop,
        onTogglePause: noop,
        onSave: noop,
        ...props,
      }),
    ),
  );

test('the card is the #email region with ten switches: pause first, then the nine kinds, marketing off', () => {
  const html = card();
  assert.match(html, /<[a-z]+[^>]*id="email"[^>]*role="region"[^>]*aria-labelledby="email-title"/);
  assert.match(html, /<h2[^>]*id="email-title"[^>]*>Email preferences<\/h2>/);
  const rows = switches(html);
  assert.equal(rows.length, 10, 'pause + nine kinds');
  assert.equal(attr(rows[0], 'aria-label'), 'Pause all e-mail');
  assert.equal(attr(rows[0], 'aria-checked'), 'false');
  assert.deepEqual(
    rows.slice(1).map((r) => attr(r, 'aria-label')),
    ['New followers', 'Workout posts', 'Likes', 'Comments', 'Friend requests', 'Recaps', 'Check-ins from Vybe', 'Achievements', 'Marketing and product updates'],
  );
  assert.equal(EMAIL_SETTING_KEYS.length, 9);
  const marketing = rows.at(-1);
  assert.equal(attr(marketing, 'aria-checked'), 'false', 'marketing is never pre-checked');
  assert.match(html, /Occasional news about Vybe\. Off unless you turn it on\./);
  assert.match(html, /Sign-in codes, password resets and account notices still arrive\./);
  // Delivery is on, so no "not sending yet" callout.
  assert.doesNotMatch(html, /isn’t sending activity e-mail yet/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.match(html, /aria-live="polite">Up to date\.</);
  assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]*?Save email preferences/);
  for (const row of rows) assert.doesNotMatch(row, /disabled/, 'every row is enabled when nothing is paused or saving');
});

test('Save enables with a dirty draft; a 400 sentence sits under the rows', () => {
  const dirty = card({ dirty: true, value: { ...DEFAULT_EMAIL_SETTINGS, likes: false } });
  assert.doesNotMatch(dirty, /<button[^>]*disabled[^>]*>[\s\S]*?Save email preferences/);
  assert.match(dirty, /aria-live="polite">You have unsaved changes\.</);
  assert.equal(attr(switches(dirty)[3], 'aria-checked'), 'false', 'Likes reads the draft value');
  const failed = card({ dirty: true, error: 'Unknown email preference: pauseAll' });
  assert.match(failed, /<p[^>]*id="email-preferences-error"[^>]*role="alert"[^>]*>Unknown email preference: pauseAll<\/p>/);
  const saving = card({ dirty: true, saving: true });
  assert.match(saving, /aria-busy="true"/);
  for (const row of switches(saving)) assert.match(row, /disabled/);
});

test('a host without SMTP says so honestly, and pausing all e-mail disables the nine kinds', () => {
  const quiet = card({ emailDelivery: false });
  assert.match(quiet, /Vybe isn’t sending activity e-mail yet\. Your choices are kept for when it does\./);
  const paused = card({ emailPaused: true });
  const rows = switches(paused);
  assert.equal(attr(rows[0], 'aria-checked'), 'true');
  assert.doesNotMatch(rows[0], /disabled/, 'the pause switch itself stays usable');
  for (const row of rows.slice(1)) assert.match(row, /disabled/);
  assert.match(paused, /All e-mail is paused\. Turn “Pause all e-mail” off to adjust the individual kinds\./);
  assert.match(paused, /role="alert"/, 'the warning callout is announced');
});

test('the API body reads into the card shape: capabilities, pause and the nine kinds', () => {
  const picked = pickEmailPreferences({
    settings: { newFollowers: false, productUpdates: true, pauseAll: true },
    emailPaused: true,
    capabilities: { emailDelivery: false },
    user: { _id: 'u1' },
  });
  assert.deepEqual(picked, {
    settings: { ...DEFAULT_EMAIL_SETTINGS, newFollowers: false, productUpdates: true },
    emailPaused: true,
    emailDelivery: false,
  });
  assert.deepEqual(pickEmailPreferences(undefined), { settings: DEFAULT_EMAIL_SETTINGS, emailPaused: false, emailDelivery: true });
  assert.equal(pickEmailPreferences({ settings: {}, emailPaused: 'yes' }).emailPaused, false);
});

test('the times editor renders one labelled time input per saved time, Add a time up to three, and the honest hint', () => {
  const two = decode(mount(h(HydrationTimesEditor, { times: ['09:00', '13:00'], hydrationOn: true, onSaved: noop })));
  assert.match(two, /<legend[^>]*>Reminder times<\/legend>/);
  assert.match(two, /<label[^>]*for="hydration-time-0"[^>]*>Reminder time 1<\/label>/);
  assert.match(two, /<label[^>]*for="hydration-time-1"[^>]*>Reminder time 2<\/label>/);
  assert.match(two, /<input[^>]*id="hydration-time-0"[^>]*type="time"[^>]*step="60"[^>]*value="09:00"/);
  assert.match(two, /aria-label="Remove reminder time 1"/);
  assert.match(two, /aria-label="Remove reminder time 2"/);
  assert.doesNotMatch(two, /Remove reminder time 3/);
  assert.match(two, /<button[^>]*>[\s\S]*?Add a time/);
  assert.match(two, /<button[^>]*disabled[^>]*>[\s\S]*?Save times/, 'nothing changed yet');
  assert.match(two, /Up to three times a day, on your clock\./);
  assert.doesNotMatch(two, /Turn on Water check-ins/);
  assert.doesNotMatch(two, /role="alert"/);

  const three = decode(mount(h(HydrationTimesEditor, { times: ['06:00', '12:00', '18:00'], hydrationOn: true, onSaved: noop })));
  assert.match(three, /<button[^>]*disabled[^>]*>[\s\S]*?Add a time/, 'three is the API maximum');

  const off = decode(mount(h(HydrationTimesEditor, { times: [], hydrationOn: false, onSaved: noop })));
  assert.match(off, /Turn on Water check-ins to receive these\./);
  assert.doesNotMatch(off, /hydration-time-0/, 'no rows until one is added');
  const onNoTimes = decode(mount(h(HydrationTimesEditor, { times: [], hydrationOn: true, onSaved: noop })));
  assert.match(onNoTimes, /Add at least one time to receive check-ins\./);

  const paused = decode(mount(h(HydrationTimesEditor, { times: ['09:00'], hydrationOn: true, disabled: true, onSaved: noop })));
  assert.match(paused, /<input[^>]*id="hydration-time-0"[^>]*disabled/);
  assert.match(paused, /<button[^>]*aria-label="Remove reminder time 1"[^>]*disabled/);
  for (const html of [two, three, off, onNoTimes, paused]) assert.doesNotMatch(html, /!/);
});

test('the unsubscribe outcome: done links to the e-mail card (via sign-in when signed out); failures are announced', () => {
  const done = { status: 'done', kind: 'likes', message: 'You are unsubscribed from likes e-mail. Your other choices are unchanged.' };
  const signedIn = decode(mount(h(UnsubscribeOutcome, { state: done, signedIn: true })));
  assert.match(signedIn, /<h2[^>]*>You are unsubscribed<\/h2>/);
  assert.match(signedIn, /You are unsubscribed from likes e-mail\. Your other choices are unchanged\./);
  assert.match(signedIn, /<a[^>]*href="\/settings#email"[^>]*>[\s\S]*?Manage e-mail preferences/);
  assert.match(signedIn, /<a[^>]*href="\/"[^>]*>[\s\S]*?Back to home/);
  assert.doesNotMatch(signedIn, /role="alert"/);

  const signedOut = decode(mount(h(UnsubscribeOutcome, { state: done, signedIn: false })));
  assert.match(signedOut, /<a[^>]*href="\/login\?next=%2Fsettings%23email"[^>]*>[\s\S]*?Sign in to manage e-mail preferences/);
  const unknown = decode(mount(h(UnsubscribeOutcome, { state: done, signedIn: null })));
  assert.doesNotMatch(unknown, /manage e-mail preferences/i, 'the manage link waits for the session to settle');
  assert.match(unknown, /Back to home/);

  const working = decode(mount(h(UnsubscribeOutcome, { state: { status: 'working' }, signedIn: false })));
  assert.match(working, /role="status"[^>]*aria-live="polite"[^>]*>[\s\S]*?Updating your e-mail preferences…/);

  const used = decode(mount(h(UnsubscribeOutcome, { state: { status: 'failed', failure: { kind: 'used-or-expired' } }, signedIn: true, onRetry: noop })));
  assert.match(used, /<h2[^>]*>This link has already been used<\/h2>/);
  assert.match(used, /role="alert"[^>]*>[\s\S]*?This link has already been used or has expired\./);
  assert.doesNotMatch(used, /Try again/, 'a spent token is not retried');
  assert.match(used, /href="\/settings#email"/);

  const network = decode(mount(h(UnsubscribeOutcome, { state: { status: 'failed', failure: { kind: 'network' } }, signedIn: false, onRetry: noop })));
  assert.match(network, /<button[^>]*>[\s\S]*?Try again/);
  assert.match(network, /Could not reach Vybe\. Check your connection and try again\./);

  const invalid = decode(mount(h(UnsubscribeOutcome, { state: { status: 'invalid' }, signedIn: false })));
  assert.match(invalid, /<h2[^>]*>This link is not valid<\/h2>/);
  assert.match(invalid, /role="alert"/);
  assert.doesNotMatch(invalid, /Try again/);
  for (const html of [signedIn, signedOut, working, used, network, invalid]) assert.doesNotMatch(html, /!/);
});
