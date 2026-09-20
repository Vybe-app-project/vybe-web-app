/**
 * The /join/<code> invite landing (PRE-F-4): the code rule, the preview words,
 * the failure sentences, the public route, the share type and the two bodies
 * under react-dom/server. The API route (GET /api/public/invites/:code) lands
 * with the v2-be-invites-people package; everything here is coded to its
 * contract, so the tests use the contract's shapes rather than a live API.
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

const lib = await import('../src/lib/invites.ts');
const share = await import('../src/lib/shareLinks.ts');
const { isInlineErrorSurface } = await import('../src/lib/clientPolicy.ts');

const CODE = '7K2MQ9RX';
const SHOWN = 'VYBE-7K2M-Q9RX';
const BANNED = /\b(streak|missed|expire|expiring|hurry|last chance|reward|earn|unlock|bonus|points|free month)\b/i;

/* ------------------------------------------------------------------ code rule */

test('the code rule: 8 symbols from the alphabet without 0/O/1/I; case, the VYBE- prefix, dashes and spaces are normalised away', () => {
  assert.equal(lib.INVITE_CODE_ALPHABET, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  assert.equal(lib.INVITE_CODE_ALPHABET.length, 32);
  for (const banned of ['0', 'O', '1', 'I']) assert.ok(!lib.INVITE_CODE_ALPHABET.includes(banned), `${banned} is not in the alphabet`);
  assert.equal(lib.INVITE_CODE_LENGTH, 8);
  assert.equal(String(lib.INVITE_CODE_RE), String(/^[A-HJ-NP-Z2-9]{8}$/));
  for (const symbol of lib.INVITE_CODE_ALPHABET) assert.match(symbol.repeat(8), lib.INVITE_CODE_RE);

  assert.equal(lib.normaliseInviteCode(CODE), CODE);
  assert.equal(lib.normaliseInviteCode('7k2mq9rx'), CODE, 'lower case');
  assert.equal(lib.normaliseInviteCode(SHOWN), CODE, 'the displayed form');
  assert.equal(lib.normaliseInviteCode('vybe-7k2m-q9rx'), CODE, 'the displayed form in lower case');
  assert.equal(lib.normaliseInviteCode(' vybe 7k2m q9rx '), CODE, 'spaces');
  assert.equal(lib.normaliseInviteCode('7K2M-Q9RX'), CODE, 'dashes without the prefix');
  assert.equal(lib.normaliseInviteCode('VYBE7K2MQ9RX'), CODE, 'the prefix without dashes');
  assert.equal(lib.normaliseInviteCode('VYBEABCD'), 'VYBEABCD', 'eight symbols that happen to start with VYBE are a code');
  assert.equal(lib.normaliseInviteCode('7K2MQ9R0'), null, 'zero is not in the alphabet');
  assert.equal(lib.normaliseInviteCode('7K2MQ9RO'), null);
  assert.equal(lib.normaliseInviteCode('7K2MQ9R1'), null);
  assert.equal(lib.normaliseInviteCode('7K2MQ9RI'), null);
  assert.equal(lib.normaliseInviteCode('7K2MQ9R'), null, 'too short');
  assert.equal(lib.normaliseInviteCode('7K2MQ9RXA'), null, 'too long');
  assert.equal(lib.normaliseInviteCode('../admin'), null);
  assert.equal(lib.normaliseInviteCode(''), null);
  assert.equal(lib.normaliseInviteCode(null), null);
  assert.equal(lib.normaliseInviteCode(undefined), null);
  assert.equal(lib.normaliseInviteCode(12345678), null);

  assert.equal(lib.formatInviteCode(CODE), SHOWN);
  assert.equal(lib.formatInviteCode('vybe-7k2m-q9rx'), SHOWN);
  assert.equal(lib.formatInviteCode('nope'), null);
  assert.equal(lib.formatInviteCode(null), null);

  assert.equal(lib.readInviteCode({ param: CODE, search: '' }), CODE);
  assert.equal(lib.readInviteCode({ param: null, search: `?code=${SHOWN}` }), SHOWN, 'read as written; the caller normalises');
  assert.equal(lib.readInviteCode({ param: undefined, search: `code=${CODE}&x=1` }), CODE);
  assert.equal(lib.readInviteCode({ param: CODE, search: '?code=OTHER' }), CODE, 'the path wins');
  assert.equal(lib.readInviteCode({ param: '  ', search: `?code= ${CODE} ` }), CODE, 'trimmed');
  assert.equal(lib.readInviteCode({ param: null, search: '' }), '');
  assert.equal(lib.readInviteCode({}), '');
});

/* ------------------------------------------------------------------ preview */

const body = (over = {}) => ({ kind: 'general', inviter: { firstName: 'Sam' }, storeUrls: { ios: null, android: null }, ...over });

test('the preview reader keeps the contract and nothing else: kind, first name, an opted-in avatar, the target, https store URLs', () => {
  assert.deepEqual(lib.parseInvitePreview(body()), { kind: 'general', inviter: { firstName: 'Sam', avatar: null }, target: null, storeUrls: { ios: null, android: null } });
  const gym = lib.parseInvitePreview(body({
    kind: 'gym',
    inviter: { firstName: 'Sam', avatar: 'https://cdn.example/a.jpg' },
    target: { kind: 'gym', name: 'Iron Works', memberCount: 12 },
    storeUrls: { ios: 'https://apps.apple.com/app/id1', android: 'http://play.google.com/x' },
  }));
  assert.deepEqual(gym, {
    kind: 'gym',
    inviter: { firstName: 'Sam', avatar: 'https://cdn.example/a.jpg' },
    target: { kind: 'gym', name: 'Iron Works', memberCount: 12 },
    storeUrls: { ios: 'https://apps.apple.com/app/id1', android: null },
  });
  const odd = lib.parseInvitePreview(body({ storeUrls: { ios: 'javascript:alert(1)', android: 'market://details?id=x' } }));
  assert.equal(odd.storeUrls.ios, null, 'only an https store URL is shown');
  assert.equal(odd.storeUrls.android, null);
  assert.equal(lib.parseInvitePreview(body({ storeUrls: null })).storeUrls.ios, null);
  assert.equal(lib.parseInvitePreview(body({ kind: 'buddy' })), null, 'a kind this build does not know is not previewed');
  assert.equal(lib.parseInvitePreview(body({ inviter: { firstName: '' } })), null);
  assert.equal(lib.parseInvitePreview(body({ inviter: {} })), null);
  assert.equal(lib.parseInvitePreview(body({ inviter: { firstName: 'Sam', avatar: 42 } })).inviter.avatar, null);
  assert.equal(lib.parseInvitePreview(null), null);
  assert.equal(lib.parseInvitePreview('<html>'), null);
  assert.equal(lib.parseInvitePreview([]), null);
  assert.equal(lib.parseInvitePreview(body({ target: { kind: 'gym', name: '', memberCount: 3 } })).target, null, 'a target without a name is no target');
  assert.equal(lib.parseInvitePreview(body({ kind: 'challenge', target: { kind: 'challenge', name: 'Push-up month', memberCount: -1 } })).target.memberCount, null);
  assert.equal(lib.parseInvitePreview(body({ kind: 'challenge', target: { kind: 'challenge', name: 'Push-up month' } })).target.memberCount, null);
  // Nothing else from the body survives: an address, a handle or a follower count cannot leak through.
  const leaky = lib.parseInvitePreview(body({ inviter: { firstName: 'Sam', email: 'sam@example.com', username: 'sam', followersCount: 9 } }));
  assert.deepEqual(Object.keys(leaky.inviter), ['firstName', 'avatar']);
  assert.deepEqual(Object.keys(leaky), ['kind', 'inviter', 'target', 'storeUrls']);
});

const preview = (over = {}) => ({ kind: 'general', inviter: { firstName: 'Sam', avatar: null }, target: null, storeUrls: { ios: null, android: null }, ...over });

test('the preview words per kind: general "<First name> invited you to Vybe", gym and challenge name the target and count members when present', () => {
  const general = lib.invitePreviewView(preview());
  assert.equal(general.title, 'Sam invited you to Vybe');
  assert.deepEqual(general.lines, [lib.GENERAL_LINE]);
  assert.equal(general.kindLabel, 'Invite');
  assert.equal(general.inviterName, 'Sam');
  assert.equal(general.avatar, null);
  assert.equal(general.targetName, null);
  assert.equal(general.memberCount, null);

  const gym = lib.invitePreviewView(preview({ kind: 'gym', inviter: { firstName: 'Sam', avatar: 'https://cdn.example/a.jpg' }, target: { kind: 'gym', name: 'Iron Works', memberCount: 12 } }));
  assert.equal(gym.title, 'Sam invited you to Iron Works');
  assert.deepEqual(gym.lines, ['A gym community on Vybe.', '12 members']);
  assert.equal(gym.kindLabel, 'Gym invite');
  assert.equal(gym.avatar, 'https://cdn.example/a.jpg');
  assert.equal(gym.targetName, 'Iron Works');
  assert.equal(gym.memberCount, '12 members');
  assert.deepEqual(lib.invitePreviewView(preview({ kind: 'gym', target: { kind: 'gym', name: 'Iron Works', memberCount: 1 } })).lines, ['A gym community on Vybe.', '1 member']);
  assert.deepEqual(lib.invitePreviewView(preview({ kind: 'gym', target: { kind: 'gym', name: 'Iron Works', memberCount: null } })).lines, ['A gym community on Vybe.'], 'no count, no count line');

  const challenge = lib.invitePreviewView(preview({ kind: 'challenge', target: { kind: 'challenge', name: 'Push-up month', memberCount: 1200 } }));
  assert.equal(challenge.title, 'Sam invited you to Push-up month');
  assert.deepEqual(challenge.lines, ['A challenge on Vybe.', '1,200 members']);
  assert.equal(challenge.kindLabel, 'Challenge invite');

  // A contextual invite whose target the API left out reads as a general one: the person still lands on the inviter.
  const orphan = lib.invitePreviewView(preview({ kind: 'gym', target: null }));
  assert.equal(orphan.title, 'Sam invited you to Vybe');
  assert.equal(orphan.kindLabel, 'Invite');

  assert.equal(lib.memberCountLine(0), '0 members');
  assert.equal(lib.memberCountLine(2.7), '2 members');
  assert.equal(lib.memberCountLine(null), null);
  assert.equal(lib.memberCountLine(undefined), null);
  assert.equal(lib.memberCountLine(-3), null);

  for (const view of [general, gym, challenge, orphan]) {
    for (const text of [view.title, view.kindLabel, ...view.lines]) {
      assert.doesNotMatch(text, /!/);
      assert.doesNotMatch(text, BANNED);
    }
  }
});

/* ------------------------------------------------------------------ failures */

test('failures map to words: 404 unknown code, 410 turned off, 429 the wait, offline could not reach, anything else generic; a malformed code shares the 404 sentence', () => {
  const http = (status, data, headers) => ({ isAxiosError: true, response: { status, data, headers } });
  assert.deepEqual(lib.classifyInviteFailure(http(404, { error: { code: 'NOT_FOUND', message: 'Not found' } })), { kind: 'unknown-code' });
  assert.deepEqual(lib.classifyInviteFailure(http(410, { code: 'INVITE_REVOKED', message: 'This invite was revoked' })), { kind: 'revoked' });
  assert.deepEqual(lib.classifyInviteFailure(http(429, { code: 'RATE_LIMITED', retryAfterSec: 540 })), { kind: 'rate-limited', retryAfterSec: 540 });
  assert.deepEqual(lib.classifyInviteFailure(http(429, '<html>', { 'retry-after': '120' })), { kind: 'rate-limited', retryAfterSec: 120 }, 'the header when the body is HTML');
  assert.deepEqual(lib.classifyInviteFailure(http(429, {}, { get: (name) => (name === 'retry-after' ? '60' : null) })), { kind: 'rate-limited', retryAfterSec: 60 }, 'AxiosHeaders#get');
  assert.deepEqual(lib.classifyInviteFailure(http(429, {})), { kind: 'rate-limited', retryAfterSec: null });
  assert.deepEqual(lib.classifyInviteFailure({ isAxiosError: true, code: 'ERR_NETWORK' }), { kind: 'network' });
  assert.deepEqual(lib.classifyInviteFailure({ isAxiosError: true, code: 'ECONNABORTED' }), { kind: 'network' });
  assert.deepEqual(lib.classifyInviteFailure(http(500, { message: 'x' }), { online: false }), { kind: 'network' }, 'offline wins');
  assert.deepEqual(lib.classifyInviteFailure(http(500, { message: 'boom' })), { kind: 'failed' });
  assert.deepEqual(lib.classifyInviteFailure(http(400, { message: 'bad' })), { kind: 'failed' });
  assert.deepEqual(lib.classifyInviteFailure(new Error('The invite preview was not readable.')), { kind: 'failed' });
  assert.deepEqual(lib.classifyInviteFailure(undefined), { kind: 'failed' });

  assert.equal(lib.inviteFailureMessage({ kind: 'unknown-code' }), 'That code isn’t one we know. Check the letters and try again.');
  assert.equal(lib.inviteFailureMessage({ kind: 'malformed' }), 'That code isn’t one we know. Check the letters and try again.');
  assert.equal(lib.inviteFailureMessage({ kind: 'revoked' }), 'This link was turned off by the person who made it.');
  assert.equal(lib.inviteFailureMessage({ kind: 'rate-limited', retryAfterSec: 540 }), 'Too many invite links were opened from this connection. Try again in about 9 minutes.');
  assert.equal(lib.inviteFailureMessage({ kind: 'rate-limited', retryAfterSec: 45 }), 'Too many invite links were opened from this connection. Try again in 45 seconds.');
  assert.equal(lib.inviteFailureMessage({ kind: 'rate-limited', retryAfterSec: null }), 'Too many invite links were opened from this connection. Try again in a moment.');
  assert.equal(lib.inviteFailureMessage({ kind: 'network' }), 'Could not reach Vybe. Check your connection and try again.');
  assert.equal(lib.inviteFailureMessage({ kind: 'failed' }), 'Could not load this invite. Try again in a moment.');

  const kinds = ['malformed', 'unknown-code', 'revoked', 'rate-limited', 'network', 'failed'];
  for (const kind of kinds) {
    const failure = kind === 'rate-limited' ? { kind, retryAfterSec: 30 } : { kind };
    const sentence = lib.inviteFailureMessage(failure);
    assert.ok(sentence.length > 0);
    assert.doesNotMatch(sentence, /!/);
    assert.doesNotMatch(sentence, /e-mail/i);
    assert.doesNotMatch(sentence, BANNED);
    assert.ok(lib.INVITE_FAILURE_TITLE[kind].length > 0, `title for ${kind}`);
    assert.doesNotMatch(lib.INVITE_FAILURE_TITLE[kind], /[!.]$/, 'titles carry no end punctuation');
  }
  assert.equal(lib.INVITE_FAILURE_TITLE.revoked, 'This link was turned off');
  assert.equal(lib.INVITE_FAILURE_TITLE['rate-limited'], 'Too many requests');

  assert.equal(lib.canRetryInvite({ kind: 'network' }), true);
  assert.equal(lib.canRetryInvite({ kind: 'failed' }), true);
  for (const kind of ['malformed', 'unknown-code', 'revoked']) assert.equal(lib.canRetryInvite({ kind }), false);
  assert.equal(lib.canRetryInvite({ kind: 'rate-limited', retryAfterSec: 1 }), false);
  assert.equal(lib.showsCodeOnFailure({ kind: 'rate-limited', retryAfterSec: 1 }), true);
  assert.equal(lib.showsCodeOnFailure({ kind: 'network' }), true);
  assert.equal(lib.showsCodeOnFailure({ kind: 'failed' }), true);
  for (const kind of ['malformed', 'unknown-code', 'revoked']) assert.equal(lib.showsCodeOnFailure({ kind }), false);

  // A rate-limited preview is told once: the page renders the 429 inline, so the app-wide toast stands down.
  assert.equal(isInlineErrorSurface('/public/invites/7K2MQ9RX'), true);
  assert.equal(isInlineErrorSurface('/api/public/invites/7K2MQ9RX'), true);
  assert.equal(isInlineErrorSurface('https://api.vybeapp.fit/api/public/invites/7K2MQ9RX'), true);
  assert.equal(isInlineErrorSurface('/public/posts/6aad635402be1805f4b9ef72'), false, 'the public post preview keeps the shared toast');
});

test('the page copy: the sentences the spec names, sentence case, no exclamation marks, "email" never hyphenated', () => {
  assert.equal(lib.INVITE_PAGE_TITLE, 'Your invite');
  assert.equal(lib.OPEN_IN_APP, 'Open in the Vybe app');
  assert.equal(lib.CODE_LABEL, 'Your invite code');
  assert.equal(lib.CODE_HINT, 'Enter this code after you sign up.');
  assert.equal(lib.COPY_CODE, 'Copy code');
  assert.equal(lib.CODE_COPIED, 'Code copied');
  assert.equal(lib.CREATE_ACCOUNT_WEB, 'Create your account on the web');
  assert.equal(lib.SIGN_IN, 'Sign in');
  assert.equal(lib.SIGNED_IN_NOTE, 'You are signed in; open the app to use this code');
  assert.equal(lib.STORE_IOS, 'Download on the App Store');
  assert.equal(lib.STORE_ANDROID, 'Get it on Google Play');
  assert.match(lib.APP_IN_TESTING, /^The Vybe app is in testing\./);
  assert.equal(lib.registerWithInvitePath(CODE), `/register?invite=${CODE}`);
  assert.equal(lib.registerInviteLine('vybe-7k2m-q9rx'), 'Invite code: VYBE-7K2M-Q9RX (use it in the app after sign-up)');
  assert.equal(lib.registerInviteLine('nope'), null);
  assert.equal(lib.registerInviteLine(null), null);
  for (const copy of [
    lib.INVITE_PAGE_TITLE, lib.OPEN_IN_APP, lib.CODE_LABEL, lib.CODE_HINT, lib.COPY_CODE, lib.CODE_COPIED, lib.CODE_SELECTED, lib.CREATE_ACCOUNT_WEB,
    lib.SIGN_IN, lib.SIGNED_IN_NOTE, lib.STORE_IOS, lib.STORE_ANDROID, lib.APP_IN_TESTING, lib.LOADING_INVITE, lib.GENERAL_LINE, lib.registerInviteLine(CODE),
  ]) {
    assert.doesNotMatch(copy, /!/);
    assert.doesNotMatch(copy, /e-mail/i);
    assert.doesNotMatch(copy, BANNED);
  }
});

/* ------------------------------------------------------------------ share links */

test('shareLinks knows the invite type: /open.html?type=invite lands on /join/<CODE> and the deep link carries the normalised code', () => {
  assert.ok(share.SHARE_TYPES.includes('invite'));
  assert.equal(share.SHARE_LABEL.invite, 'invite');
  assert.equal(share.isShareType('invite'), true);
  assert.equal(share.shareDestination('invite', CODE), `/join/${CODE}`);
  assert.equal(share.shareDestination('invite', 'vybe-7k2m-q9rx'), `/join/${CODE}`);
  assert.equal(share.shareDestination('invite', 'VYBE 7K2M Q9RX'), `/join/${CODE}`);
  assert.equal(share.shareDestination('invite', '7K2MQ9R0'), null, 'outside the alphabet');
  assert.equal(share.shareDestination('invite', '7K2MQ9RXA'), null);
  assert.equal(share.shareDestination('invite', '../admin'), null);
  assert.equal(share.shareDestination('invite', ''), null);
  assert.equal(share.shareDestination('invite', null), null);
  assert.equal(share.appDeepLink('invite', CODE), `vybe://open?type=invite&id=${CODE}`);
  assert.equal(share.appDeepLink('invite', 'vybe-7k2m-q9rx'), `vybe://open?type=invite&id=${CODE}`);
  assert.equal(share.appDeepLink('session', 'abc'), 'vybe://open?type=session&id=abc', 'other types are untouched');
  for (const type of share.SHARE_TYPES) assert.ok(share.SHARE_LABEL[type], `label for ${type}`);
  // The existing destinations still resolve.
  assert.equal(share.shareDestination('post', '6aad635402be1805f4b9ef72'), '/p/6aad635402be1805f4b9ef72');
  assert.equal(share.shareDestination('hashtag', '#legday'), '/search?q=%23legday');
});

/* ------------------------------------------------------------------ source pins */

test('the landing is a public route before the guards, calls the one preview endpoint only for a well-formed code, and never redeems', () => {
  const app = read('src/App.tsx');
  const guardedAdmin = app.indexOf('element={<RequireAdmin>');
  const guardedAuth = app.indexOf('<RequireAuth>');
  assert.ok(guardedAdmin > 0 && guardedAuth > 0);
  for (const route of ['/join/:code', '/join']) {
    const match = app.match(new RegExp(`path="${route.replace(/[/:]/g, '\\$&')}" element=\\{<JoinInvite />\\}`));
    assert.ok(match, `${route} must be routed to JoinInvite`);
    assert.ok(match.index < guardedAdmin && match.index < guardedAuth, `${route} must be public (declared before RequireAdmin and RequireAuth)`);
  }
  assert.match(app, /const JoinInvite = lazyPage\(null, \(\) => import\('\.\/pages\/JoinInvite'\)\);/);
  assert.ok(fs.existsSync(path.join(root, 'src/pages/JoinInvite.tsx')));
  assert.doesNotMatch(read('src/components/Layout.tsx'), /'\/join/, 'the landing is reached by link, not from the nav');

  const page = read('src/pages/JoinInvite.tsx');
  assert.ok(page.includes('api.get(`/public/invites/${code}`)'), 'the one public preview call (GET /api/public/invites/:code, no bearer needed)');
  assert.equal((page.match(/\bapi\.(get|post|put|patch|delete)\(/g) || []).length, 1, 'no other API call from the landing');
  assert.doesNotMatch(page, /api\.post\(/, 'nothing is redeemed on the web; POST /invites/:code/redeem is the app’s');
  assert.match(page, /const code = normaliseInviteCode\(readInviteCode\(/, 'a malformed code never reaches the API');
  assert.match(page, /enabled: !!code,/);
  assert.match(page, /retry: false,/);
  assert.match(page, /parseInvitePreview\(data\)/);
  assert.match(page, /classifyInviteFailure\(q\.error, \{ online: navigator\.onLine \}\)/);
  assert.match(page, /<PublicShell title=\{INVITE_PAGE_TITLE\}>/);
  assert.match(page, /appDeepLink\('invite', code\)/);
  assert.match(page, /import \{[^}]*\bisHandheld\b[^}]*\} from '\.\.\/lib\/shareLinks'/);
  assert.doesNotMatch(page, /navigator\.userAgent/, 'one detector, in shareLinks');
  assert.match(page, /navigator\.clipboard\.writeText\(shown\)/);
  assert.match(page, /document\.execCommand\('copy'\)/, 'a fallback when the clipboard is refused');
  assert.match(page, /registerWithInvitePath\(code\)/);
  assert.match(page, /to="\/login" state=\{from\}/, 'sign-in bounces back to the landing');
  assert.match(page, /export function InvitePreviewBody/);
  assert.match(page, /export function InviteFailureBody/);
  assert.doesNotMatch(page, /style=\{\{|dangerouslySetInnerHTML|https?:\/\//, 'CSP-safe: no inline styles, no injected HTML, no third-party origins');
  assert.doesNotMatch(page, /e-mail/i);
  for (const source of [page, read('src/lib/invites.ts')]) {
    assert.doesNotMatch(source, /apps\.apple\.com|play\.google\.com|itunes\.apple\.com/, 'store URLs come from the API only');
  }

  // Register keeps the code in view and sends the same request as before: no invented field.
  const reg = read('src/pages/Register.tsx');
  assert.match(reg, /registerInviteLine\(new URLSearchParams\(location\.search\)\.get\('invite'\)\)/);
  assert.match(reg, /data-testid="register-invite-code"/);
  assert.match(reg, /email: trimmedEmail,\s*username: trimmedUsername,\s*fullName: fullName\.trim\(\),\s*password,\s*fcmTokens: \[\],\s*\}/, 'the register body is unchanged');

  // The route snapshot is re-pinned when the API lands; until then the contract audit lists the preview call as unmatched.
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  if (!pinned.has('GET /api/public/invites/:code')) {
    console.log('note: contracts/backend-routes.json does not pin GET /api/public/invites/:code yet (lands with v2-be-invites-people)');
  }
});

/* ------------------------------------------------------------------ render */

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { InviteCodeBlock, InviteFailureBody, InvitePreviewBody, JoinInviteOutcome } = await import('../src/pages/JoinInvite.tsx');

const mount = (ui) => renderToString(h(MemoryRouter, { initialEntries: [`/join/${CODE}`] }, ui));
const tagWith = (html, testid) => {
  const match = html.match(new RegExp(`<a [^>]*data-testid="${testid}"[^>]*>`));
  assert.ok(match, `${testid} rendered as a link`);
  return match[0];
};

test('the preview body: first name, kind, lines, the app link on a phone, store buttons only for URLs the API sent, the code block, the account links', () => {
  const gym = preview({
    kind: 'gym',
    inviter: { firstName: 'Sam', avatar: 'https://cdn.example/a.jpg' },
    target: { kind: 'gym', name: 'Iron Works', memberCount: 12 },
    storeUrls: { ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=fit.vybeapp' },
  });
  const html = mount(h(InvitePreviewBody, { preview: gym, code: CODE, signedIn: false, handheld: true, copyState: null }));
  for (const text of [
    'data-testid="invite-preview"', 'Sam invited you to Iron Works', 'Gym invite', 'A gym community on Vybe.', '12 members',
    `href="vybe://open?type=invite&amp;id=${CODE}"`, 'data-testid="invite-open-app"', 'Open in the Vybe app',
    'data-testid="invite-store-ios"', 'data-testid="invite-store-android"', 'Download on the App Store', 'Get it on Google Play',
    'href="https://apps.apple.com/app/id1"', 'rel="noopener noreferrer"', 'target="_blank"', '(opens in a new tab)',
    'role="group" aria-labelledby="invite-code-label"', 'Your invite code', 'data-testid="invite-code"', SHOWN, 'select-all',
    'data-testid="invite-copy"', 'Copy code', 'role="status" aria-live="polite"', 'Enter this code after you sign up.',
    `href="/register?invite=${CODE}"`, 'Create your account on the web', 'href="/login"', 'Sign in', 'src="https://cdn.example/a.jpg"',
  ]) {
    assert.ok(html.includes(text), `preview shows ${text}`);
  }
  assert.ok(!html.includes('You are signed in'));
  assert.ok(!html.includes('in testing'));
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  assert.ok(tagWith(html, 'invite-open-app').includes('btn-primary'), 'on a phone the app link is the primary action');
  assert.ok(!tagWith(html, 'invite-register').includes('btn-primary'));

  // No avatar without the inviter's opt-in; on a desktop the app link is hidden and the web sign-up leads.
  const general = mount(h(InvitePreviewBody, { preview: preview(), code: CODE, signedIn: false, handheld: false, copyState: null }));
  assert.ok(general.includes('Sam invited you to Vybe'));
  assert.ok(general.includes('>Invite<'));
  assert.ok(general.includes(lib.GENERAL_LINE));
  assert.ok(!general.includes('<img'), 'no avatar without opt-in');
  assert.ok(!general.includes('vybe://open'), 'the app link is hidden on a desktop, where it does nothing');
  assert.ok(general.includes('data-testid="invite-app-testing"') && general.includes('The Vybe app is in testing.'), 'no store URLs: the honest line');
  assert.ok(!general.includes('invite-store-'), 'never an invented store link');
  assert.ok(tagWith(general, 'invite-register').includes('btn-primary'), 'without the app link, the web sign-up is primary');

  const iosOnly = mount(h(InvitePreviewBody, { preview: preview({ storeUrls: { ios: 'https://apps.apple.com/app/id1', android: null } }), code: CODE, signedIn: false, handheld: true, copyState: null }));
  assert.ok(iosOnly.includes('invite-store-ios'));
  assert.ok(!iosOnly.includes('invite-store-android'));
  assert.ok(!iosOnly.includes('in testing'));

  // A signed-in member: the same preview, the note, no account links, nothing redeemed.
  const signedIn = mount(h(InvitePreviewBody, { preview: preview(), code: CODE, signedIn: true, handheld: true, copyState: 'copied' }));
  assert.ok(signedIn.includes('You are signed in; open the app to use this code'));
  assert.ok(!signedIn.includes('invite-register') && !signedIn.includes('href="/login"'));
  assert.ok(signedIn.includes('Code copied'));
  assert.ok(signedIn.includes('vybe://open?type=invite'));
  assert.ok(signedIn.includes(SHOWN));

  // While the session is still being restored neither the note nor the links flip in; the code shows at once.
  const pending = mount(h(InvitePreviewBody, { preview: preview(), code: CODE, signedIn: null, handheld: false, copyState: null }));
  assert.ok(!pending.includes('invite-register') && !pending.includes('You are signed in'));
  assert.ok(pending.includes('data-testid="invite-code"'));

  const challenge = mount(h(InvitePreviewBody, { preview: preview({ kind: 'challenge', target: { kind: 'challenge', name: 'Push-up month', memberCount: 3 } }), code: CODE, signedIn: false, handheld: false, copyState: null }));
  assert.ok(challenge.includes('Sam invited you to Push-up month') && challenge.includes('Challenge invite') && challenge.includes('3 members'));
});

test('the failure body: the title, the sentence as an alert, Try again only where it helps, the code kept when the failure says nothing about it', () => {
  const failure = (f, code = CODE) => mount(h(InviteFailureBody, { failure: f, code, copyState: null, onRetry: () => {} }));
  const unknown = failure({ kind: 'unknown-code' });
  assert.ok(unknown.includes('data-testid="invite-failure"'));
  assert.ok(unknown.includes('That code is not one we know'));
  assert.match(unknown, /<p role="alert"[^>]*>That code isn’t one we know\. Check the letters and try again\.<\/p>/);
  assert.ok(!unknown.includes('invite-retry'));
  assert.ok(!unknown.includes('data-testid="invite-code"'), 'an unknown code is not offered for typing');
  assert.ok(unknown.includes('Go to Vybe'));

  const revoked = failure({ kind: 'revoked' });
  assert.ok(revoked.includes('This link was turned off') && revoked.includes('This link was turned off by the person who made it.'));
  assert.ok(!revoked.includes('invite-retry') && !revoked.includes('data-testid="invite-code"'));

  const limited = failure({ kind: 'rate-limited', retryAfterSec: 900 });
  assert.ok(limited.includes('Too many requests'));
  assert.ok(limited.includes('Try again in about 15 minutes.'));
  assert.ok(!limited.includes('invite-retry'), 'a retry inside the window would only repeat the 429');
  assert.ok(limited.includes(SHOWN) && limited.includes('Enter this code after you sign up.'), 'the code may still be good, so it stays');

  const offline = failure({ kind: 'network' });
  assert.ok(offline.includes('Could not reach Vybe'));
  assert.ok(offline.includes('data-testid="invite-retry"') && offline.includes('Try again'));
  assert.ok(offline.includes('data-testid="invite-code"'));

  const generic = failure({ kind: 'failed' });
  assert.ok(generic.includes('Something went wrong') && generic.includes('Could not load this invite.') && generic.includes('invite-retry'));

  const malformed = failure({ kind: 'malformed' }, null);
  assert.ok(malformed.includes('Check the letters and try again.'));
  assert.ok(!malformed.includes('data-testid="invite-code"') && !malformed.includes('invite-retry'));

  for (const html of [unknown, revoked, limited, offline, generic, malformed]) {
    assert.ok(!html.includes('NaN') && !html.includes('undefined'));
    assert.ok(!html.includes('vybe://open'), 'no app link without a preview');
  }

  // The outcome dispatch: loading is a live status; the two states render their bodies; the copy fallback has its line.
  const loading = mount(h(JoinInviteOutcome, { state: { status: 'loading', code: CODE }, signedIn: null, handheld: false, copyState: null }));
  assert.match(loading, /role="status" aria-live="polite" aria-busy="true"/);
  assert.ok(loading.includes('Loading your invite…'));
  const ready = mount(h(JoinInviteOutcome, { state: { status: 'ready', code: CODE, preview: preview() }, signedIn: false, handheld: false, copyState: null }));
  assert.ok(ready.includes('data-testid="invite-preview"'));
  const failed = mount(h(JoinInviteOutcome, { state: { status: 'failed', code: null, failure: { kind: 'malformed' } }, signedIn: false, handheld: false, copyState: null }));
  assert.ok(failed.includes('data-testid="invite-failure"'));
  const selected = mount(h(InviteCodeBlock, { code: CODE, copyState: 'selected' }));
  assert.ok(selected.includes(lib.CODE_SELECTED));
  assert.ok(selected.includes('id="invite-code"'));
});
