/**
 * Wave C1 legal consent: the sign-up agreement box, the signed-in
 * "Agree and continue" gate and Settings > Terms and privacy policy.
 *
 * Pure logic imports the real src/lib/legalConsent.ts (the live GET
 * /legal/current body of 2026-09-19 is the fixture); render tests go through
 * react-dom/server against the real providers (pattern of
 * tests/update-required.render.test.mjs); source pins hold the mount points,
 * the API paths and the copy both clients share.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const legal = await import('../src/lib/legalConsent.ts');
const { parseApiError } = await import('../src/lib/apiError.ts');
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { Checkbox, ToastProvider } = await import('../src/components/ui.tsx');
const { LegalConsentDialog, LegalConsentGate, LegalConsentNotice } = await import('../src/components/LegalConsentGate.tsx');
const { LegalCard } = await import('../src/pages/settings/LegalSection.tsx');
const { useAuth } = await import('../src/lib/auth.ts');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

const EMPTY_SHELL = mount(null);
const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');
const count = (html, needle) => html.split(needle).length - 1;

/* ------------------------------------------------------------------ fixture: the live API body */

// GET https://api.vybeapp.fit/api/legal/current on 2026-09-19 (sha 96153ae), verbatim.
const CURRENT = {
  terms: {
    document: 'terms',
    title: 'Terms and Conditions',
    version: '2026-07-28',
    effectiveAt: '2026-07-28T00:00:00.000Z',
    material: true,
    url: 'https://vybeapp.fit/terms-and-conditions.html',
    summary: [
      'Vybe is a place to log training, share it and meet people who train.',
      'You keep the rights to what you post; we need a licence to show it to the people you choose.',
      'You can download your data or delete your account from Settings at any time.',
    ],
  },
  privacy: {
    document: 'privacy',
    title: 'Privacy Policy',
    version: '2026-07-28',
    effectiveAt: '2026-07-28T00:00:00.000Z',
    material: true,
    url: 'https://vybeapp.fit/privacy-policy.html',
    summary: [
      'Workouts, meals, water, weight and progress photos are health data; they are never sold or used for ads.',
      'Your profile and posts are visible to the audience you pick for them.',
      'Delete your account and everything is removed; backups follow within the retention window.',
    ],
  },
  consents: {
    analytics: { document: 'analytics', version: '1', required: false },
    healthData: { document: 'health-data', version: '1', required: false },
    marketingPush: { document: 'marketing-push', version: '1', required: false },
  },
  noticeDays: 90,
};

const NO_CONSENTS = {
  'health-data': { granted: false, version: null, acceptedAt: null, revokedAt: null },
  analytics: { granted: false, version: null, acceptedAt: null, revokedAt: null },
  'marketing-push': { granted: false, version: null, acceptedAt: null, revokedAt: null },
};

/** The GET /legal/acceptances shape around the live `current`. */
const acceptancesBody = (pending, accepted = { terms: null, privacy: null }) => ({ accepted, pending, consents: NO_CONSENTS, current: CURRENT });

const BOTH = legal.pendingDocuments(legal.normalizeLegalState(acceptancesBody(['terms', 'privacy'])));
const PRIVACY_ONLY = legal.pendingDocuments(legal.normalizeLegalState(acceptancesBody(['privacy'])));

const http = (status, data) => ({ isAxiosError: true, response: { status, data, headers: {} } });

/* ------------------------------------------------------------------ pure: the pending decision */

test('a fresh account (no rows) has both documents pending, terms first, with the live versions', () => {
  const state = legal.normalizeLegalState(acceptancesBody(['terms', 'privacy']));
  assert.ok(state);
  assert.deepEqual(state.pending, ['terms', 'privacy']);
  assert.deepEqual(state.accepted, { terms: null, privacy: null });
  assert.equal(state.current.noticeDays, 90, 'kept in the type; never shown');
  const docs = legal.pendingDocuments(state);
  assert.deepEqual(docs.map((d) => d.document), ['terms', 'privacy']);
  assert.deepEqual(docs.map((d) => d.version), ['2026-07-28', '2026-07-28']);
  assert.equal(docs[0].title, 'Terms and Conditions');
  assert.equal(docs[1].title, 'Privacy Policy');
  assert.equal(docs[0].summary.length, 3);
  assert.equal(legal.isMaterial(docs), true, 'both live documents are material: the blocking dialog');
});

test('the server order is the one shown, terms first even when it arrives reversed, and only known kinds count', () => {
  const reversed = legal.normalizeLegalState(acceptancesBody(['privacy', 'terms', 'analytics', 'terms']));
  assert.deepEqual(reversed.pending, ['terms', 'privacy'], 'sorted and de-duplicated; a consent never appears in pending');
  assert.equal(legal.pendingDocuments(legal.normalizeLegalState(acceptancesBody(['privacy']))).length, 1);
  assert.equal(legal.pendingDocuments(legal.normalizeLegalState(acceptancesBody(['privacy'])))[0].document, 'privacy');
  assert.deepEqual(legal.pendingDocuments(legal.normalizeLegalState(acceptancesBody([]))), [], 'nothing pending: nothing to show');
  assert.deepEqual(legal.pendingDocuments(null), []);
});

test('an accepted row is read back with its version, date and surface; a row without a version counts as absent', () => {
  const state = legal.normalizeLegalState(
    acceptancesBody([], {
      terms: { version: '2026-07-28', acceptedAt: '2026-09-19T16:00:00.000Z', surface: 'signup' },
      privacy: { acceptedAt: '2026-09-19T16:00:00.000Z' },
    }),
  );
  assert.deepEqual(state.accepted.terms, { version: '2026-07-28', acceptedAt: '2026-09-19T16:00:00.000Z', surface: 'signup' });
  assert.equal(state.accepted.privacy, null);
});

test('a body without a usable `current` normalises to null so the gate fails open', () => {
  assert.equal(legal.normalizeLegalState({ accepted: {}, pending: ['terms', 'privacy'] }), null);
  assert.equal(legal.normalizeLegalState({ ...acceptancesBody(['terms']), current: { terms: CURRENT.terms } }), null, 'privacy missing');
  assert.equal(legal.normalizeLegalState({ ...acceptancesBody(['terms']), current: { ...CURRENT, terms: { title: 'Terms' } } }), null, 'no version');
  for (const junk of [null, undefined, 'x', 42, [], {}]) assert.equal(legal.normalizeLegalState(junk), null);
  assert.equal(legal.normalizeLegalCurrent(CURRENT).terms.material, true);
  assert.equal(legal.normalizeLegalCurrent({ ...CURRENT, terms: { ...CURRENT.terms, material: false } }).terms.material, false);
  assert.equal(legal.normalizeLegalCurrent({ ...CURRENT, terms: { ...CURRENT.terms, material: undefined } }).terms.material, true, 'a missing flag never turns the gate into a notice');
});

test('a non-material change is the dismissible notice, a mixed set is still the dialog', () => {
  const soft = { ...CURRENT, terms: { ...CURRENT.terms, material: false }, privacy: { ...CURRENT.privacy, material: false } };
  const notice = legal.pendingDocuments(legal.normalizeLegalState({ ...acceptancesBody(['terms', 'privacy']), current: soft }));
  assert.equal(legal.isMaterial(notice), false);
  const mixed = { ...CURRENT, terms: { ...CURRENT.terms, material: false } };
  assert.equal(legal.isMaterial(legal.pendingDocuments(legal.normalizeLegalState({ ...acceptancesBody(['terms', 'privacy']), current: mixed }))), true);
});

test('the title follows which documents changed, word for word with the mobile app', () => {
  assert.equal(legal.legalTitle(BOTH), 'Our terms and privacy policy have changed');
  assert.equal(legal.legalTitle(PRIVACY_ONLY), 'Our privacy policy has changed');
  assert.equal(legal.legalTitle([{ document: 'terms' }]), 'Our terms have changed');
  assert.equal(legal.legalTitle(BOTH, false), 'Our terms and privacy policy have changed');
  assert.equal(legal.readLabel({ document: 'terms' }), 'Read the full terms');
  assert.equal(legal.readLabel({ document: 'privacy' }), 'Read the full privacy policy');
  assert.equal(legal.LEGAL_COPY.agree, 'Agree and continue');
  assert.equal(legal.LEGAL_COPY.gotIt, 'Got it');
  assert.equal(legal.LEGAL_COPY.noticeTitle, 'A small update to our terms');
  assert.equal(legal.LEGAL_COPY.noticeBody, 'Nothing you need to do. Read the changes when you like.');
  assert.equal(legal.LEGAL_COPY.accepted, 'Thanks. You’re all set.');
  assert.equal(legal.LEGAL_COPY.stale, 'These documents changed again just now. Here is the latest.');
  assert.ok(Object.isFrozen(legal.LEGAL_COPY));
});

test('an account with no acceptance row of any version is asked to review, not told the documents changed', () => {
  const none = { terms: null, privacy: null };
  assert.equal(legal.isFirstAgreement(BOTH, none), true);
  assert.equal(legal.isFirstAgreement(PRIVACY_ONLY, none), true);
  assert.equal(legal.legalTitle(BOTH, legal.isFirstAgreement(BOTH, none)), 'Please review our terms and privacy policy');
  assert.equal(legal.legalTitle(PRIVACY_ONLY, true), 'Please review our privacy policy');
  assert.equal(legal.legalTitle([{ document: 'terms' }], true), 'Please review our terms');
  // An older row on any pending document is a genuine version bump: the mobile wording.
  const older = { version: '2026-01-01', acceptedAt: '2026-02-01T00:00:00.000Z', surface: 'signup' };
  assert.equal(legal.isFirstAgreement(BOTH, { terms: older, privacy: older }), false);
  assert.equal(legal.isFirstAgreement(BOTH, { terms: older, privacy: null }), false, 'one document changed for this account');
  assert.equal(legal.legalTitle(BOTH, legal.isFirstAgreement(BOTH, { terms: older, privacy: older })), 'Our terms and privacy policy have changed');
  // Only the pending documents count: a current terms row with no privacy row is a first agreement for the privacy policy.
  const current = { version: '2026-07-28', acceptedAt: '2026-09-19T16:00:00.000Z', surface: 'signup' };
  assert.equal(legal.isFirstAgreement(PRIVACY_ONLY, { terms: current, privacy: null }), true);
  // No state to read, or nothing pending: never claims a first agreement.
  assert.equal(legal.isFirstAgreement(BOTH, null), false);
  assert.equal(legal.isFirstAgreement(BOTH, undefined), false);
  assert.equal(legal.isFirstAgreement([], none), false);
  // Straight from the live body: every pre-existing web account arrives like this.
  const fresh = legal.normalizeLegalState(acceptancesBody(['terms', 'privacy']));
  assert.equal(legal.isFirstAgreement(legal.pendingDocuments(fresh), fresh.accepted), true);
});

/* ------------------------------------------------------------------ pure: the acceptance payload */

test('the accept body is one acceptance per pending document at the version shown, surface interstitial, client web', () => {
  assert.deepEqual(legal.acceptBody(BOTH, 'interstitial', '1.0.0+5228f21c0ffe'), {
    acceptances: [
      { document: 'terms', version: '2026-07-28' },
      { document: 'privacy', version: '2026-07-28' },
    ],
    surface: 'interstitial',
    client: { platform: 'web', appVersion: '1.0.0+5228f21c0ffe' },
  });
  assert.deepEqual(legal.acceptBody(PRIVACY_ONLY, 'interstitial', 'dev').acceptances, [{ document: 'privacy', version: '2026-07-28' }]);
  assert.equal(legal.GATE_SURFACE, 'interstitial');
});

test('client.appVersion always satisfies the server pattern or is left out, and the raw web/ header is never sent', () => {
  const pattern = /^[A-Za-z0-9.+-]{1,40}$/;
  for (const version of ['1.0.0', '1.0.0+5228f21c0ffe', 'dev']) {
    const sent = legal.acceptBody(BOTH, 'interstitial', version).client.appVersion;
    assert.equal(sent, version);
    assert.match(sent, pattern);
  }
  // The X-Vybe-Client value carries the platform: the prefix is stripped, the slash never reaches the API.
  assert.equal(legal.clientAppVersion('web/1.0.0+5228f21c0ffe'), '1.0.0+5228f21c0ffe');
  assert.equal(legal.clientAppVersion('web/dev'), 'dev');
  assert.deepEqual(legal.acceptBody(BOTH, 'interstitial', 'web/1.0.0+5228f21c0ffe').client, { platform: 'web', appVersion: '1.0.0+5228f21c0ffe' });
  // Anything that would make the server drop the whole client object is dropped here instead.
  for (const bad of ['1.0.0/odd', 'a'.repeat(41), '', null, undefined, 'has space']) {
    assert.deepEqual(legal.acceptBody(BOTH, 'interstitial', bad).client, { platform: 'web' }, `appVersion ${JSON.stringify(bad)}`);
  }
  assert.equal(legal.APP_VERSION_PATTERN.source, pattern.source);
});

test('never more than five acceptances and never the same document twice', () => {
  const many = ['terms', 'privacy', 'health-data', 'analytics', 'marketing-push', 'extra-1', 'extra-2'].map((document) => ({ document, version: '1' }));
  assert.equal(legal.acceptBody(many, 'interstitial', 'dev').acceptances.length, 5);
  assert.equal(legal.MAX_ACCEPTANCES, 5);
  const twice = legal.acceptBody([...BOTH, ...BOTH], 'interstitial', 'dev').acceptances;
  assert.deepEqual(twice.map((a) => a.document), ['terms', 'privacy']);
});

test('409 LEGAL_VERSION_STALE is recognised from the parsed error; a 400 and a network failure are not', () => {
  const stale = parseApiError(http(409, { code: 'LEGAL_VERSION_STALE', message: 'The terms version has changed', document: 'terms', current: '2026-07-28' }));
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'LEGAL_VERSION_STALE');
  assert.equal(legal.isLegalVersionStale(stale), true);
  assert.equal(legal.isLegalVersionStale(parseApiError(http(400, { code: 'VALIDATION', message: 'Send one acceptance per document' }))), false);
  const offline = parseApiError({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
  assert.equal(offline.kind, 'network');
  assert.equal(legal.isLegalVersionStale(offline), false);
  assert.equal(legal.isLegalVersionStale(parseApiError(http(409, { code: 'DELETION_ALREADY_SCHEDULED' }))), false, 'another 409 is not stale');
  assert.equal(legal.isLegalVersionStale(parseApiError(new Error('boom'))), false);
});

test('the POST answer pending list is cleaned the same way as the GET one', () => {
  assert.deepEqual(legal.pendingKinds(['privacy', 'terms', 'analytics']), ['terms', 'privacy']);
  assert.deepEqual(legal.pendingKinds([]), []);
  assert.deepEqual(legal.pendingKinds(undefined), []);
});

/* ------------------------------------------------------------------ pure: pages and dates */

test('read links go to the web copy of each page, never the API url', () => {
  assert.equal(legal.legalPagePath({ document: 'privacy' }), '/privacy-policy.html');
  assert.equal(legal.legalPagePath({ document: 'terms' }), '/terms-and-conditions.html');
  assert.equal(legal.legalPagePath(BOTH[0]), '/terms-and-conditions.html');
  assert.equal(legal.legalPagePath(BOTH[1]), '/privacy-policy.html');
});

test('the effective date is the calendar day of the version in every zone; garbage is passed through', () => {
  const effective = legal.formatEffectiveDate('2026-07-28T00:00:00.000Z');
  assert.match(effective, /2026/);
  assert.match(effective, /28/, 'midnight UTC stays the 28th (a local rendering reads the 27th in the Americas)');
  assert.doesNotMatch(effective, /27/);
  assert.equal(legal.formatEffectiveDate('not a date'), 'not a date');
  assert.equal(legal.formatEffectiveDate(null), '');
  assert.equal(legal.formatEffectiveDate(''), '');
  assert.match(legal.formatAcceptedDate('2026-09-19T16:21:27.000Z'), /2026/);
  assert.equal(legal.formatAcceptedDate('garbage'), 'garbage');
  assert.equal(legal.LEGAL_COPY.effective('July 28, 2026'), 'Effective July 28, 2026.');
});

test('the Settings status line says what the API knows and nothing more', () => {
  const current = { version: '2026-07-28' };
  assert.equal(legal.acceptanceLine(null, current), 'No agreement on record for this account yet.');
  const agreed = legal.acceptanceLine({ version: '2026-07-28', acceptedAt: '2026-09-19T16:00:00.000Z', surface: 'signup' }, current);
  assert.match(agreed, /^You agreed to this version on .*2026\.$/);
  const older = legal.acceptanceLine({ version: '2026-01-01', acceptedAt: '2026-02-01T00:00:00.000Z', surface: 'signup' }, current);
  assert.match(older, /^You agreed to version 2026-01-01 on .*2026\. The current version is waiting for your agreement\.$/);
  assert.equal(legal.acceptanceLine({ version: '2026-07-28', acceptedAt: null, surface: null }, current), 'You agreed to this version.');
});

/* ------------------------------------------------------------------ render: the dialog */

test('the dialog for both documents is a labelled modal with every summary line, two read links, one Agree and a Sign out', () => {
  const html = decode(mount(h(LegalConsentDialog, { documents: BOTH, onAgree() {}, onSignOut() {} })));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="legal-consent-title"/);
  assert.match(html, /aria-describedby="legal-consent-body"/);
  assert.match(html, /id="legal-consent-title"[^>]*>Our terms and privacy policy have changed</);
  assert.match(html, /<h2[^>]*>Terms and Conditions<\/h2>/);
  assert.match(html, /<h2[^>]*>Privacy Policy<\/h2>/);
  assert.equal(count(html, 'Effective July 28, 2026.'), 2, 'each document names its effective day');
  assert.equal(count(html, '>In short<'), 2);
  for (const line of [...CURRENT.terms.summary, ...CURRENT.privacy.summary]) assert.ok(html.includes(line), line);

  const anchors = [...html.matchAll(/<a\s([^>]*)>/g)].map((m) => m[1]);
  assert.equal(anchors.length, 2);
  assert.ok(anchors.some((a) => a.includes('href="/terms-and-conditions.html"')));
  assert.ok(anchors.some((a) => a.includes('href="/privacy-policy.html"')));
  for (const attributes of anchors) {
    assert.match(attributes, /target="_blank"/);
    assert.match(attributes, /rel="noopener noreferrer"/);
  }
  assert.match(html, /Read the full terms<span class="sr-only"> \(opens in a new tab\)<\/span>/);
  assert.match(html, /Read the full privacy policy<span class="sr-only"> \(opens in a new tab\)<\/span>/);
  assert.doesNotMatch(html, /vybeapp\.fit/, 'links are relative, never the API url');

  const buttons = [...html.matchAll(/<button\s([^>]*)>/g)].map((m) => m[1]);
  assert.equal(buttons.length, 2, 'Agree and continue, then Sign out; no close');
  for (const attributes of buttons) assert.doesNotMatch(attributes, /aria-label/, 'the visible text is the accessible name (WCAG 2.5.3)');
  assert.match(buttons[0], /type="button"/);
  assert.match(buttons[0], /data-testid="legal-consent-agree"/);
  assert.equal(count(html, '>Agree and continue<'), 1);
  assert.ok(html.indexOf('>Agree and continue<') < html.indexOf('>Sign out<'), 'the exit sits under the agreement');
  assert.doesNotMatch(html, /aria-label="Close"/);
  assert.doesNotMatch(html, /type="checkbox"/, 'one button is the agreement; nothing to tick');
  assert.doesNotMatch(html, /90|noticeDays|days/, 'no notice-period claim the documents do not make');
  assert.match(html, /z-\[200\]/);
  assert.doesNotMatch(html, /role="alert"/, 'no error line until an accept fails');

  // The documents scroll inside the panel and the buttons are a pinned footer, so Agree is never below the fold.
  const panel = html.match(/<div class="([^"]*max-h-\[calc\(100dvh-2rem\)\][^"]*)"/);
  assert.ok(panel, 'the panel caps its height to the viewport');
  assert.match(panel[1], /\bflex\b/);
  assert.match(panel[1], /\bflex-col\b/);
  assert.doesNotMatch(panel[1], /overflow-y-auto/, 'the panel itself does not scroll');
  const body = html.match(/<div [^>]*id="legal-consent-body"[^>]*class="([^"]*)"/) ?? html.match(/<div [^>]*class="([^"]*)"[^>]*id="legal-consent-body"/);
  assert.ok(body, 'the described body is the scroll region');
  for (const utility of ['min-h-0', 'flex-1', 'overflow-y-auto', 'overscroll-contain']) assert.ok(body[1].split(' ').includes(utility), `body has ${utility}`);
  const footer = html.indexOf('data-testid="legal-consent-footer"');
  assert.ok(footer > html.indexOf('id="legal-consent-body"'), 'the footer follows the body');
  assert.ok(footer < html.indexOf('data-testid="legal-consent-agree"'), 'Agree lives in the footer');
  assert.ok(footer < html.indexOf('data-testid="legal-consent-sign-out"'), 'so does Sign out');
  assert.match(html.slice(footer - 200, footer), /shrink-0/);
});

test('a first agreement is titled as a review, a version bump as a change; the summaries and buttons are the same', () => {
  const first = decode(mount(h(LegalConsentDialog, { documents: BOTH, firstAgreement: true, onAgree() {}, onSignOut() {} })));
  assert.match(first, /id="legal-consent-title"[^>]*>Please review our terms and privacy policy</);
  assert.doesNotMatch(first, /have changed|has changed/);
  assert.equal(count(first, '>Agree and continue<'), 1);
  assert.equal(count(first, 'Read the full'), 2);
  const privacy = decode(mount(h(LegalConsentDialog, { documents: PRIVACY_ONLY, firstAgreement: true, onAgree() {}, onSignOut() {} })));
  assert.match(privacy, /id="legal-consent-title"[^>]*>Please review our privacy policy</);
  const bump = decode(mount(h(LegalConsentDialog, { documents: BOTH, firstAgreement: false, onAgree() {}, onSignOut() {} })));
  assert.match(bump, /id="legal-consent-title"[^>]*>Our terms and privacy policy have changed</);
  assert.doesNotMatch(bump, /Please review/);
});

test('an accept failure is announced inline and the dialog stays; a busy dialog shows Saving', () => {
  const failed = decode(mount(h(LegalConsentDialog, { documents: BOTH, error: 'These documents changed again just now. Here is the latest.', onAgree() {}, onSignOut() {} })));
  assert.match(failed, /role="alert"[^>]*>These documents changed again just now\. Here is the latest\.</);
  assert.match(failed, /role="dialog"/);
  assert.ok(failed.indexOf('data-testid="legal-consent-footer"') < failed.indexOf('role="alert"'), 'the error sits in the pinned footer, above the buttons');
  assert.ok(failed.indexOf('role="alert"') < failed.indexOf('data-testid="legal-consent-agree"'));
  const busy = decode(mount(h(LegalConsentDialog, { documents: BOTH, busy: true, onAgree() {}, onSignOut() {} })));
  assert.match(busy, /<button[^>]*aria-busy="true"[^>]*data-testid="legal-consent-agree"|<button[^>]*data-testid="legal-consent-agree"[^>]*aria-busy="true"/);
  for (const attributes of [...busy.matchAll(/<button\s([^>]*)>/g)].map((m) => m[1])) assert.doesNotMatch(attributes, /aria-label/, 'no aria-label on the buttons: the visible text is the name');
  assert.match(busy, /Saving…/);
  assert.ok(busy.indexOf('data-testid="legal-consent-footer"') < busy.indexOf('role="alert"') || !busy.includes('role="alert"'), 'the error line, when present, sits in the footer');
  assert.match(busy, /role="status"[^>]*>Saving…</, 'assistive tech hears the saving state');
  assert.doesNotMatch(busy, />Agree and continue</);
  assert.match(busy, /<button[^>]*disabled/);
});

test('with only the privacy policy pending the title names it and there is one read link', () => {
  const html = decode(mount(h(LegalConsentDialog, { documents: PRIVACY_ONLY, onAgree() {}, onSignOut() {} })));
  assert.match(html, /id="legal-consent-title"[^>]*>Our privacy policy has changed</);
  assert.equal(count(html, 'Read the full'), 1);
  assert.match(html, /href="\/privacy-policy\.html"/);
  assert.doesNotMatch(html, /terms-and-conditions\.html/);
  assert.doesNotMatch(html, /Terms and Conditions/);
});

/* ------------------------------------------------------------------ render: the notice and the gate */

test('the non-material notice is a note, not a dialog, with the shared copy and one Got it', () => {
  const html = decode(mount(h(LegalConsentNotice, { documents: BOTH, onDismiss() {} })));
  assert.doesNotMatch(html, /role="dialog"/);
  assert.doesNotMatch(html, /aria-modal/);
  assert.match(html, /role="note"/);
  assert.match(html, /A small update to our terms/);
  assert.match(html, /Nothing you need to do\. Read the changes when you like\./);
  const buttons = [...html.matchAll(/<button\s([^>]*)>/g)].map((m) => m[1]);
  assert.equal(buttons.length, 1);
  assert.doesNotMatch(buttons[0], /aria-label/, '"Got it" is the accessible name, so "click Got it" works (WCAG 2.5.3)');
  assert.match(buttons[0], /data-testid="legal-consent-dismiss"/);
  assert.equal(count(html, '>Got it<'), 1);
  assert.equal(count(html, 'Read the full'), 2);
  assert.match(html, /pointer-events-none/);
  assert.match(html, /pointer-events-auto/);
});

test('signed out (the store in its initial state) the gate renders nothing at all', () => {
  assert.equal(useAuth.getState().user, null);
  assert.equal(mount(h(LegalConsentGate)), EMPTY_SHELL);
});

/* ------------------------------------------------------------------ render: Settings > Terms and privacy policy */

const AGREED_STATE = legal.normalizeLegalState(
  acceptancesBody([], {
    terms: { version: '2026-07-28', acceptedAt: '2026-09-19T16:21:27.000Z', surface: 'interstitial' },
    privacy: { version: '2026-07-28', acceptedAt: '2026-09-19T16:21:27.000Z', surface: 'interstitial' },
  }),
);

test('the Settings card lists both documents with version, effective date, the agreement date and a read link, read-only', () => {
  const html = decode(mount(h(LegalCard, { state: AGREED_STATE })));
  assert.match(html, /id="legal"[^>]*role="region"[^>]*aria-labelledby="legal-title"/);
  assert.match(html, /id="legal-title"[^>]*>Terms and privacy policy</);
  assert.match(html, /The versions in force now and when you agreed to them\./);
  assert.match(html, /data-testid="legal-terms"/);
  assert.match(html, /data-testid="legal-privacy"/);
  assert.equal(count(html, 'Version 2026-07-28, effective July 28, 2026.'), 2);
  assert.equal(count(html, 'You agreed to this version on '), 2);
  const anchors = [...html.matchAll(/<a\s([^>]*)>/g)].map((m) => m[1]);
  assert.equal(anchors.length, 2);
  assert.ok(anchors.some((a) => a.includes('href="/terms-and-conditions.html"')));
  assert.ok(anchors.some((a) => a.includes('href="/privacy-policy.html"')));
  for (const attributes of anchors) {
    assert.match(attributes, /target="_blank"/);
    assert.match(attributes, /rel="noopener noreferrer"/);
  }
  assert.match(html, /Read<span class="sr-only"> the Terms and Conditions \(opens in a new tab\)<\/span>/);
  assert.match(html, /Read<span class="sr-only"> the Privacy Policy \(opens in a new tab\)<\/span>/);
  assert.doesNotMatch(html, /<button/, 'nothing to toggle or withdraw: the API refuses to withdraw the terms or the privacy policy');
  assert.doesNotMatch(html, /Withdraw|analytics|marketing/i);
});

test('the Settings card says when nothing is on record, while loading, on an error and offline', () => {
  const fresh = decode(mount(h(LegalCard, { state: legal.normalizeLegalState(acceptancesBody(['terms', 'privacy'])) })));
  assert.equal(count(fresh, 'No agreement on record for this account yet.'), 2);
  const loading = decode(mount(h(LegalCard, { state: undefined, loading: true })));
  assert.match(loading, /aria-busy="true"[^>]*aria-label="Loading your agreements"/);
  const failed = decode(mount(h(LegalCard, { state: undefined, error: http(500, { code: 'SERVER_ERROR', message: 'Could not load acceptances' }), onRetry() {} })));
  assert.match(failed, /Could not load your agreements/);
  const offline = decode(mount(h(LegalCard, { state: undefined, offline: true })));
  assert.match(offline, /Your agreements cannot be checked while Vybe is offline\./);
  assert.doesNotMatch(offline, /Loading your agreements|Could not load/);
});

/* ------------------------------------------------------------------ render: the sign-up agreement box */

test('the design-system Checkbox can be required and carry an announced error without changing its plain form', () => {
  const plain = decode(mount(h(Checkbox, { id: 'box', checked: false, onChange() {}, label: 'Keep me signed in' })));
  assert.match(plain, /^<label for="box"/, 'unchanged root for every existing use');
  assert.doesNotMatch(plain, /aria-invalid|aria-describedby|role="alert"|required/);
  const strict = decode(mount(h(Checkbox, { id: 'reg-agree', checked: false, required: true, error: 'Tick the box to continue.', onChange() {}, label: 'I agree' })));
  assert.match(strict, /<input[^>]*id="reg-agree"[^>]*type="checkbox"[^>]*required=""[^>]*aria-invalid="true"[^>]*aria-describedby="reg-agree-error"/);
  assert.match(strict, /<p id="reg-agree-error" role="alert"[^>]*>[\s\S]*?Tick the box to continue\./);
  assert.ok(strict.indexOf('</label>') < strict.indexOf('id="reg-agree-error"'), 'the error is a sibling, not part of the label text');
});

/* ------------------------------------------------------------------ source pins */

test('the gate is mounted once at the root, between the 426 screen and the routes', () => {
  const app = read('src/App.tsx');
  assert.match(app, /import \{ LegalConsentGate \} from '\.\/components\/LegalConsentGate';/);
  assert.equal(count(app, '<LegalConsentGate />'), 1);
  const gate = app.indexOf('<LegalConsentGate />');
  assert.ok(gate > app.indexOf('<UpdateRequiredScreen />'), 'after the 426 screen');
  assert.ok(gate < app.indexOf('<ApiNotices />'), 'before the notices');
  assert.ok(gate < app.indexOf('<Routes>'), 'outside the routes, so SupportGate and PostGate are covered');
  assert.ok(gate > app.indexOf('<ToastProvider>') && gate < app.indexOf('<Suspense'), 'inside the toast provider');
  assert.doesNotMatch(read('src/components/Layout.tsx'), /LegalConsentGate/, 'not a second mount in the shell');
});

test('the gate calls the two legal routes on the shared axios instance with surface interstitial, and the snapshot pins all four', () => {
  const apiFile = read('src/lib/legalConsentApi.ts');
  assert.match(apiFile, /api\.get\('\/legal\/acceptances'\)/);
  assert.match(apiFile, /api\.get\('\/legal\/current'\)/, 'the mobile fallback when an answer lacks `current`');
  assert.match(apiFile, /api\.post\('\/legal\/accept', acceptBody\(documents, surface, CLIENT_HEADER_VALUE\)\)/);
  assert.match(apiFile, /surface: AcceptanceSurface = GATE_SURFACE/);
  assert.doesNotMatch(apiFile, /'settings'/, 'the gate never records under the API default surface');
  assert.doesNotMatch(apiFile, /from '\.\/lifecycleApi'|\bfetch\(/, 'not the lifecycle fetch path');
  assert.match(apiFile, /staleTime: Infinity/);
  assert.match(apiFile, /enabled = !!userId && !sessionStale/);
  const lib = read('src/lib/legalConsent.ts');
  assert.match(lib, /export const GATE_SURFACE: AcceptanceSurface = 'interstitial';/);
  assert.doesNotMatch(lib, /= 'settings'|\?\? 'settings'/, 'no default surface of settings anywhere');
  assert.doesNotMatch(lib, /^import (?!type )/m, 'import-free apart from types, so node --test can load it');
  const gate = read('src/components/LegalConsentGate.tsx');
  assert.doesNotMatch(gate, /'settings'/);
  assert.doesNotMatch(gate, /\/legal\/consents|DELETE/, 'no consent withdrawal in this package');

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of ['GET /api/legal/current', 'GET /api/legal/acceptances', 'POST /api/legal/accept', 'DELETE /api/legal/consents/:document']) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('the dialog is an overlay with the shared lock and trap, not a Modal, and never a tick box or a read-first gate', () => {
  const gate = read('src/components/LegalConsentGate.tsx');
  assert.match(gate, /z-\[200\]/, 'above the welcome sheet (z-[100]), below the 426 screen (z-[300])');
  assert.match(gate, /useLockBody\(true\)/);
  assert.match(gate, /useFocusTrap\(true,/);
  const uiImport = gate.match(/import \{([^}]*)\} from '\.\/ui';/);
  assert.ok(uiImport, 'imports from ./ui');
  assert.doesNotMatch(uiImport[1], /\bModal\b|\bDialog\b|\bSheet\b/);
  assert.doesNotMatch(gate, /onKeyDown|\.key\b|['"]Escape['"]|onClose/, 'no Escape handler: there is no close');
  assert.match(gate, /role="dialog"/);
  assert.match(gate, /aria-modal="true"/);
  for (const forbidden of ['I have read', 'I agree to the', 'checkbox', 'Checkbox']) assert.ok(!gate.includes(forbidden), `gate must not contain "${forbidden}"`);
  assert.doesNotMatch(gate, /noticeDays/, 'the notice-period number is not quoted in the UI');
  // WCAG 2.5.3 Label in Name: the buttons' visible text is their accessible name. Mobile's
  // accessibilityLabel strings stay in LEGAL_COPY so the block mirrors mobile, but never reach the DOM.
  assert.doesNotMatch(gate, /aria-label=/, 'no aria-label anywhere in the gate');
  assert.doesNotMatch(gate, /agreeLabel|gotItLabel/);
  assert.match(gate, /logout\(\)/, 'the web-only exit');
  // The pinned footer: the documents scroll, the buttons do not, and an edge with more content fades.
  assert.match(gate, /useScrollEdges\(bodyRef, 'y'\)/);
  assert.match(gate, /fadeClass\(edges, 'y'\)/);
  assert.match(gate, /max-h-\[calc\(100dvh-2rem\)\]/);
  const lib = read('src/lib/legalConsent.ts');
  for (const copy of ['Our terms and privacy policy have changed', 'Our privacy policy has changed', 'Our terms have changed', 'Please review our terms and privacy policy', 'Please review our privacy policy', 'Please review our terms', 'Agree and continue', 'Agree to the updated documents and continue', 'A small update to our terms', 'Got it', 'Dismiss this notice']) {
    assert.ok(lib.includes(`'${copy}'`), `copy "${copy}" pinned`);
  }
});

test('the gate re-checks on the sign-in edge without a second request on a page load, and the hook comment no longer promises re-login', () => {
  const gate = read('src/components/LegalConsentGate.tsx');
  const effect = gate.slice(gate.indexOf('useEffect(() => {'), gate.indexOf('}, [enabled, userId, qc]);'));
  assert.match(effect, /if \(!enabled\) return;/);
  assert.match(effect, /getQueryState\(entry\)\?\.dataUpdatedAt/, 'only an entry that already holds data is invalidated');
  assert.match(effect, /invalidateQueries\(\{ queryKey: entry \}\)/);
  const apiFile = read('src/lib/legalConsentApi.ts');
  assert.doesNotMatch(apiFile, /noticed on reload or re-login/);
  assert.match(apiFile, /sign-in edge/);
  assert.match(apiFile, /full navigation/);
});

test('sign-up needs an explicit, unticked agreement on the one account-creation form and sends nothing extra', () => {
  const register = read('src/pages/Register.tsx');
  assert.match(register, /import \{ Button, Callout, Checkbox, Input, Spinner, cx, useToast \} from '\.\/ui';/);
  assert.match(register, /agree: 'reg-agree',/);
  assert.match(register, /const \[agreed, setAgreed\] = useState\(false\);/, 'never pre-ticked');
  assert.match(register, /if \(!agreed\) next\.agree = AGREE_REQUIRED;/);
  assert.match(register, /if \(next\.agree\) \{\s*focusField\(FIELD_IDS\.agree\);\s*return;\s*\}/);
  assert.match(register, /Tick the box to agree to the Terms and Conditions and the Privacy Policy\./);
  // The box: required, both documents linked in new tabs, placed before Create account inside the step-3 form.
  const box = register.slice(register.indexOf('<Checkbox'), register.indexOf('Create account'));
  assert.match(box, /id=\{FIELD_IDS\.agree\}/);
  assert.match(box, /\brequired\b/);
  assert.match(box, /error=\{fieldError\.agree\}/);
  assert.match(box, /I agree to the\{' '\}/);
  assert.match(box, /<a href="\/terms-and-conditions\.html" target="_blank" rel="noopener noreferrer"[^>]*>\s*Terms and Conditions<span className="sr-only"> \(opens in a new tab\)<\/span>/);
  assert.match(box, /<a href="\/privacy-policy\.html" target="_blank" rel="noopener noreferrer"[^>]*>\s*Privacy Policy<span className="sr-only"> \(opens in a new tab\)<\/span>/);
  assert.match(box, /description=\{AGREE_HINT\}/);
  assert.match(register, /const AGREE_HINT = 'We record your agreement when your account is created\.';/);
  assert.ok(register.indexOf('<Checkbox') > register.indexOf('{step === 3 && ('), 'inside the account form');
  assert.ok(register.indexOf('<Checkbox') < register.indexOf('Create account'), 'before the submit');
  // The agreement is not restored from the sign-up draft.
  const draft = register.slice(register.indexOf('writeRegisterDraft(sessionStorage, {'), register.indexOf('});', register.indexOf('writeRegisterDraft(sessionStorage, {')));
  assert.doesNotMatch(draft, /agree/);
  // The API writes the sign-up rows itself (recordSignupAcceptance, surface 'signup'); a second post would only duplicate them.
  assert.doesNotMatch(register, /\/legal\//);
  assert.equal(count(register, "'/auth/register-password'"), 1, 'the one account-creation call, which the box gates');
  assert.doesNotMatch(register, /'\/auth\/register'/, 'the web has no separate email-code registration call');
  // The email-code step signs an existing account in, which the signed-in gate covers; it creates nothing.
  assert.match(register, /You already had an account, so we signed you in as/);
  // The shared footer line stays as pinned elsewhere.
  assert.match(register, /footer=\{<LegalLine \/>\}/);
  assert.match(read('src/pages/Login.tsx'), /export function LegalLine/);
});

test('Settings mounts the legal card once between Help and legal and the data lifecycle, from SettingsPieces, and leaves Help and legal alone', () => {
  const settings = read('src/pages/Settings.tsx');
  assert.match(settings, /import \{ LegalSection \} from '\.\/settings\/LegalSection';/);
  assert.equal(count(settings, '<LegalSection />'), 1);
  assert.match(settings, /<AboutSection \/>\s*<LegalSection \/>\s*<DataLifecycleSection \/>/, 'the document links, then the agreements, then Download your data and Delete account');
  const section = read('src/pages/settings/LegalSection.tsx');
  assert.match(section, /import \{ SettingsCard \} from '\.\.\/SettingsPieces';/);
  assert.match(section, /<SettingsCard id="legal" title=\{LEGAL_CARD_TITLE\}/);
  assert.doesNotMatch(section, /function (SettingsCard|ToggleRow)\(/);
  assert.doesNotMatch(section, /\/legal\/consents|api\.(delete|post)/, 'read-only: nothing to withdraw honestly');
  // The existing rows keep their id and labels.
  assert.match(settings, /<SettingsCard id="about" title="Help and legal" padded=\{false\}>/);
  assert.match(settings, /label: 'Privacy policy'/);
  assert.match(settings, /label: 'Terms and conditions'/);
  // The three optional consents stay out of the web until a Privacy and Safety package reads them.
  assert.doesNotMatch(section + read('src/components/LegalConsentGate.tsx'), /['"`](health-data|marketing-push|analytics)['"`]/);
});
