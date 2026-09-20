/**
 * People and invites on the web (Wave F, design-first-week-and-people.md §3.2,
 * §3.3, §3.4, §4): the reason-chip model, the redeem outcome and refusal
 * sentences, the pending-code carry-over through sign-up, the reader for
 * GET /invites/me, the banned-word rule, and the source pins that keep the
 * hot-spot edits honest. Everything is coded to the API contract
 * (int-vybe-backend/docs/api-contract.md "Invites and people signals"), so the
 * tests use the contract's shapes rather than a live API.
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

const people = await import('../src/lib/peopleSuggestions.ts');
const friends = await import('../src/lib/inviteFriends.ts');
const redeem = await import('../src/lib/inviteRedeem.ts');
const pending = await import('../src/lib/pendingInvite.ts');

const CODE = '7K2MQ9RX';
const BANNED = /\b(streak|missed|expire|expiring|hurry|last chance|reward|earn|unlock|bonus|points|free month|refer and earn)\b/i;

/* ------------------------------------------------------------------ reason chips */

test('reasonChips: the server sentence verbatim, "Invited you" first and accented, the check-in chip only when the text lacks it, never an invented reason', () => {
  const texts = (row) => people.reasonChips(row).map((c) => c.text);

  const mutual = people.reasonChips({ reason: 'mutual', reasons: ['mutual'], reasonText: 'Followed by Alex and 2 others' });
  assert.deepEqual(mutual, [{ key: 'reason', text: 'Followed by Alex and 2 others', accent: false }], 'one neutral chip with the exact text');

  // The live API appends " · there this week" itself: one chip, never twice.
  assert.deepEqual(texts({ reason: 'same-gym', reasons: ['same-gym'], reasonText: 'Also at Iron Works · there this week', activeThisWeek: true }), ['Also at Iron Works · there this week']);
  assert.deepEqual(texts({ reason: 'same-gym', reasonText: 'Also trains at Iron Works · there this week', homeGym: true, activeThisWeek: true }), ['Also trains at Iron Works · there this week']);
  // An older API without the suffix still says it.
  assert.deepEqual(texts({ reason: 'same-gym', reasons: ['same-gym'], reasonText: 'Also at Iron Works', activeThisWeek: true }), ['Also at Iron Works', 'Trains at your gym · there this week']);
  assert.deepEqual(texts({ reason: 'same-gym', reasonText: 'Also at Iron Works' }), ['Also at Iron Works'], 'no activeThisWeek, no second chip');
  assert.deepEqual(texts({ reason: 'same-gym', reasonText: 'Also at Iron Works', activeThisWeek: false }), ['Also at Iron Works'], 'false is not true');

  const invited = people.reasonChips({ reason: 'invited-by', reasons: ['invited-by'], reasonText: 'Invited you' });
  assert.deepEqual(invited, [{ key: 'invited-by', text: 'Invited you', accent: true }], 'exactly one accent chip, not "Invited you" twice');
  assert.deepEqual(texts({ reason: 'invited-by', reasonText: 'Invited you' }), ['Invited you'], 'the primary reason alone carries it');

  const both = people.reasonChips({ reason: 'mutual', reasons: ['mutual', 'invited-by'], reasonText: 'Followed by Sam' });
  assert.deepEqual(both.map((c) => [c.text, c.accent]), [['Invited you', true], ['Followed by Sam', false]], '"Invited you" first, then the mutual text');

  assert.deepEqual(people.reasonChips({}), []);
  assert.deepEqual(people.reasonChips({ reason: 'mutual' }), [], 'a reason code without its sentence shows nothing');
  assert.deepEqual(people.reasonChips({ reasonText: '   ' }), []);
  assert.deepEqual(people.reasonChips(null), []);
  assert.deepEqual(people.reasonChips(undefined), []);
  assert.deepEqual(texts({ reasonText: 'Follows you' }), ['Follows you']);
  assert.deepEqual(texts({ reasonText: 'Recently active on Vybe' }), ['Recently active on Vybe']);
  for (const chip of [...mutual, ...invited, ...both]) assert.ok(['invited-by', 'reason', 'active-this-week'].includes(chip.key));

  assert.equal(people.INVITED_YOU, 'Invited you');
  assert.equal(people.THERE_THIS_WEEK, 'Trains at your gym · there this week');
  assert.equal(people.THERE_THIS_WEEK_SUFFIX, ' · there this week');
  assert.equal(people.UNDO_WINDOW_MS, 6000);
  assert.equal(people.dismissLabel('Sam Lee'), 'Not interested in Sam Lee; hide this suggestion');
  assert.equal(people.hiddenCopy('Sam Lee'), 'Sam Lee hidden');
});

test('parseSuggestions keeps the rows of a suggest body and nothing else', () => {
  const rows = [{ _id: 'a', username: 'a', reason: 'mutual', reasonText: 'Followed by Sam' }, { _id: 'b', username: 'b' }];
  assert.deepEqual(people.parseSuggestions({ success: true, count: 2, users: rows, sources: { mutual: 1 } }), rows);
  assert.deepEqual(people.parseSuggestions({ users: [...rows, null, 'x', { username: 'no id' }] }), rows, 'rows without an id are dropped');
  assert.deepEqual(people.parseSuggestions({ users: 'nope' }), []);
  assert.deepEqual(people.parseSuggestions({}), []);
  assert.deepEqual(people.parseSuggestions(null), []);
  assert.deepEqual(people.parseSuggestions(undefined), []);
  assert.deepEqual(people.parseSuggestions('<html>'), []);
});

/* ------------------------------------------------------------------ redeem outcome */

const outcome = (follow, gym = 'none', challenge = 'none') => ({ follow, gym, challenge });

test('redeemOutcomeCopy: the follow line, then the gym or challenge line with the preview name or the honest fallback; blocked says one neutral sentence', () => {
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('followed'), { inviterName: 'Sam', kind: 'general' }), ['You now follow Sam']);
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('requested'), { inviterName: 'Sam' }), ['Follow request sent to Sam']);
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('already'), { inviterName: 'Sam' }), ['You already follow Sam']);
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('blocked', 'joined'), { inviterName: 'Sam', kind: 'gym', targetName: 'Iron Works' }), ['Couldn’t use this invite.'], 'blocked stops: no gym line');
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('followed', 'joined'), { inviterName: 'Sam', kind: 'gym', targetName: 'Iron Works' }), ['You now follow Sam', 'You joined Iron Works']);
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('requested', 'requested'), { inviterName: 'Sam', kind: 'gym' }), ['Follow request sent to Sam', 'Asked to join the gym']);
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('followed', 'none', 'joined'), { inviterName: 'Sam', kind: 'challenge', targetName: 'Push-up month' }), ['You now follow Sam', 'You joined Push-up month']);
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('followed', 'none', 'joined'), { inviterName: 'Sam', kind: 'challenge' }), ['You now follow Sam', 'You joined the challenge']);
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('already', 'none'), { inviterName: 'Sam', kind: 'gym' }), ['You already follow Sam'], 'gym none on a gym invite adds nothing');
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('followed'), { inviterName: null }), ['You now follow the person who invited you'], 'a replay with a gone inviter');
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('followed'), {}), ['You now follow the person who invited you']);
  assert.deepEqual(redeem.redeemOutcomeCopy(outcome('followed'), { inviterName: '  ' }), ['You now follow the person who invited you']);
  assert.equal(redeem.actorName({ fullName: 'Sam Lee', username: 'sam' }), 'Sam Lee');
  assert.equal(redeem.actorName({ fullName: '  ', username: 'sam' }), 'sam');
  assert.equal(redeem.actorName(null), null);
});

test('parseRedeemBody reads the contract and refuses a body outside it', () => {
  const body = { inviter: { _id: 'u1', username: 'sam', fullName: 'Sam Lee', avatar: 'https://cdn.example/a.jpg', isVerified: true, isIdentityVerified: false }, outcome: outcome('followed', 'joined'), kind: 'gym', targetId: 'g1', at: '2026-09-20T00:00:00Z' };
  assert.deepEqual(redeem.parseRedeemBody(body), {
    inviter: { _id: 'u1', username: 'sam', fullName: 'Sam Lee', avatar: 'https://cdn.example/a.jpg' },
    outcome: outcome('followed', 'joined'),
    kind: 'gym',
    targetId: 'g1',
    replayed: false,
  });
  assert.equal(redeem.parseRedeemBody({ ...body, replayedRedemption: true }).replayed, true);
  const blocked = redeem.parseRedeemBody({ inviter: null, outcome: outcome('blocked'), kind: 'general', targetId: null, at: null });
  assert.equal(blocked.inviter, null);
  assert.equal(blocked.outcome.follow, 'blocked');
  assert.equal(redeem.parseRedeemBody({ ...body, outcome: { follow: 'maybe', gym: 'none', challenge: 'none' } }), null);
  assert.equal(redeem.parseRedeemBody({ ...body, outcome: { follow: 'followed', gym: 'yes', challenge: 'none' } }), null);
  assert.equal(redeem.parseRedeemBody({ ...body, outcome: null }), null);
  assert.equal(redeem.parseRedeemBody({}), null);
  assert.equal(redeem.parseRedeemBody(null), null);
  assert.equal(redeem.parseRedeemBody('<html>'), null);
  // Nothing else from the inviter survives.
  assert.deepEqual(Object.keys(redeem.parseRedeemBody({ ...body, inviter: { _id: 'u1', email: 'sam@example.com', username: 'sam' } }).inviter), ['_id', 'username']);
});

/* ------------------------------------------------------------------ refusals */

test('redeemErrorCopy: the API code first, the status second; a 429 or 5xx is left to the parsed message; the pending code is dropped only for final refusals', () => {
  const INVALID = 'That code isn’t one we know. Check the letters and try again.';
  assert.equal(redeem.redeemErrorCopy('INVITE_NOT_FOUND', 404), INVALID);
  assert.equal(redeem.redeemErrorCopy(null, 404), INVALID, 'an older API without codes');
  assert.equal(redeem.redeemErrorCopy('INVITE_REVOKED', 410), 'This link was turned off by the person who made it.');
  assert.equal(redeem.redeemErrorCopy(null, 410), 'This link was turned off by the person who made it.');
  assert.equal(redeem.redeemErrorCopy('INVITE_OWN', 400), 'That’s your own code.');
  assert.equal(redeem.redeemErrorCopy('INVITE_ALREADY_USED', 409), 'You already used an invite.');
  assert.equal(redeem.redeemErrorCopy(null, 409), 'You already used an invite.');
  assert.equal(redeem.redeemErrorCopy('FEATURE_DISABLED', 404), 'Invites arrive with a later update.', 'the flag off is not "unknown code"');
  assert.equal(redeem.redeemErrorCopy(redeem.MALFORMED_CODE, null), INVALID);
  assert.equal(redeem.redeemErrorCopy('RATE_LIMITED', 429), null);
  assert.equal(redeem.redeemErrorCopy('INVITE_ERROR', 500), null);
  assert.equal(redeem.redeemErrorCopy('CLIENT_REQUEST_ID_INVALID', 400), null);
  assert.equal(redeem.redeemErrorCopy(null, null), null);
  assert.equal(redeem.CODE_INVALID, INVALID);
  assert.equal(redeem.CODE_OWN, 'That’s your own code.');
  assert.equal(redeem.CODE_USED, 'You already used an invite.');
  assert.equal(redeem.CODE_EXPIRED, 'This link was turned off by the person who made it.');
  assert.equal(redeem.INVITES_UNAVAILABLE, 'Invites arrive with a later update.');

  // The one reader the components use: our own refusal, an API answer, no answer.
  const http = (status, data) => ({ isAxiosError: true, response: { status, data } });
  assert.deepEqual(redeem.describeRedeemError(new redeem.InviteRefusal('INVITE_OWN', redeem.CODE_OWN)), { message: 'That’s your own code.', code: 'INVITE_OWN', status: null });
  assert.deepEqual(redeem.describeRedeemError(http(404, { message: 'x', code: 'INVITE_NOT_FOUND' })), { message: INVALID, code: 'INVITE_NOT_FOUND', status: 404 });
  assert.deepEqual(redeem.describeRedeemError(http(409, { message: 'You already used an invite.', code: 'INVITE_ALREADY_USED' })), { message: 'You already used an invite.', code: 'INVITE_ALREADY_USED', status: 409 });
  assert.equal(redeem.describeRedeemError(http(404, { message: 'Invites arrive with a later update.', code: 'FEATURE_DISABLED' })).code, 'FEATURE_DISABLED');
  const limited = redeem.describeRedeemError(http(429, { code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSec: 30 }));
  assert.equal(limited.status, 429);
  assert.doesNotMatch(limited.message, /status code/, 'never axios text');
  const server = redeem.describeRedeemError(http(500, { message: 'Unable to complete the invite request', code: 'INVITE_ERROR' }));
  assert.equal(server.code, 'INVITE_ERROR');
  assert.ok(server.message.length > 0 && !/status code/.test(server.message));
  assert.equal(redeem.describeRedeemError({ isAxiosError: true, code: 'ERR_NETWORK' }).status, null);
  assert.equal(redeem.describeRedeemError(undefined).message.length > 0, true);

  for (const code of ['INVITE_NOT_FOUND', 'INVITE_REVOKED', 'INVITE_OWN', 'INVITE_ALREADY_USED', redeem.MALFORMED_CODE]) {
    assert.equal(redeem.clearsPendingInvite(code), true, `${code} makes the kept code worthless`);
  }
  for (const code of ['FEATURE_DISABLED', 'RATE_LIMITED', 'INVITE_ERROR', 'CLIENT_REQUEST_ID_INVALID', 'CLIENT_REQUEST_CONFLICT', null, undefined]) {
    assert.equal(redeem.clearsPendingInvite(code), false, `${code} keeps the code for later`);
  }
});

test('redeemRequestId fits the API pattern and differs per call; the web settings path keeps the code', () => {
  assert.equal(String(redeem.REDEEM_REQUEST_ID_RE), String(/^[A-Za-z0-9_-]{16,100}$/));
  const a = redeem.redeemRequestId(CODE);
  const b = redeem.redeemRequestId(CODE);
  assert.match(a, redeem.REDEEM_REQUEST_ID_RE);
  assert.match(b, redeem.REDEEM_REQUEST_ID_RE);
  assert.ok(a.startsWith(`web-redeem-${CODE}-`));
  assert.notEqual(a, b);
  assert.ok(a.length <= 100 && a.length >= 16);
  assert.equal(redeem.settingsInvitePath(CODE), `/settings?invite=${CODE}#invite-code`);
  assert.equal(redeem.invitedByTitle('Sam'), 'Sam invited you');
});

/* ------------------------------------------------------------------ pending invite */

const fakeStorage = ({ throwOnSet = false } = {}) => {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      if (throwOnSet) throw new Error('QuotaExceededError');
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

test('the pending invite survives in the tab as { code, at }, expires after 30 days, and never stores anything that is not a code', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-09-20T12:00:00Z');
  const storage = fakeStorage();
  assert.equal(pending.PENDING_INVITE_KEY, 'vybe.pendingInvite');
  assert.equal(pending.PENDING_INVITE_TTL_MS, 30 * DAY);

  assert.equal(pending.rememberPendingInvite(storage, 'vybe-7k2m-q9rx', now), CODE);
  assert.deepEqual(JSON.parse(storage.map.get(pending.PENDING_INVITE_KEY)), { code: CODE, at: now });
  assert.equal(pending.readPendingInvite(storage, now), CODE);
  assert.equal(pending.readPendingInvite(storage, now + 29 * DAY), CODE, 'still good the day before');
  assert.equal(pending.readPendingInvite(storage, now + 31 * DAY), null, 'gone after the rule');
  assert.equal(storage.map.has(pending.PENDING_INVITE_KEY), false, 'the stale entry is removed as it is read');

  storage.map.set(pending.PENDING_INVITE_KEY, 'garbage');
  assert.equal(pending.readPendingInvite(storage, now), null);
  assert.equal(storage.map.has(pending.PENDING_INVITE_KEY), false);
  storage.map.set(pending.PENDING_INVITE_KEY, JSON.stringify({ code: '7K2MQ9R0', at: now }));
  assert.equal(pending.readPendingInvite(storage, now), null, 'a stored value outside the alphabet is not a code');
  storage.map.set(pending.PENDING_INVITE_KEY, JSON.stringify({ code: CODE }));
  assert.equal(pending.readPendingInvite(storage, now), null, 'no timestamp, no trust');
  storage.map.set(pending.PENDING_INVITE_KEY, JSON.stringify({ code: CODE, at: now + DAY }));
  assert.equal(pending.readPendingInvite(storage, now), null, 'a clock from the future is dropped');

  assert.equal(pending.rememberPendingInvite(storage, 'nope', now), null);
  assert.equal(storage.map.size, 0, 'nothing stored for a non-code');
  assert.equal(pending.rememberPendingInvite(storage, null, now), null);
  assert.equal(pending.rememberPendingInvite(storage, undefined, now), null);
  assert.equal(pending.rememberPendingInvite(null, CODE, now), CODE, 'no storage still answers the code');

  pending.rememberPendingInvite(storage, CODE, now);
  pending.clearPendingInvite(storage);
  assert.equal(storage.map.size, 0);
  assert.equal(pending.readPendingInvite(storage, now), null);

  const full = fakeStorage({ throwOnSet: true });
  assert.doesNotThrow(() => pending.rememberPendingInvite(full, CODE, now));
  assert.equal(pending.rememberPendingInvite(full, CODE, now), CODE);
  assert.doesNotThrow(() => pending.clearPendingInvite(null));
  assert.equal(pending.readPendingInvite(null), null);
  assert.equal(pending.readPendingInvite({ getItem: () => { throw new Error('blocked'); }, setItem() {}, removeItem() {} }), null);
});

test('Have a code? starts from ?invite= first, then the kept code, then empty; a code is shown formatted and anything else as written', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const storage = fakeStorage();
  pending.rememberPendingInvite(storage, 'AAAABBBB', now);
  assert.equal(pending.initialInviteValue('?invite=7K2MQ9RX', storage, now), 'VYBE-7K2M-Q9RX', 'the landing’s explicit code wins over the one kept since sign-up');
  assert.equal(pending.initialInviteValue('?invite=vybe-7k2m-q9rx', storage, now), 'VYBE-7K2M-Q9RX');
  assert.equal(pending.initialInviteValue('', storage, now), 'VYBE-AAAA-BBBB', 'no URL code: the kept one');
  assert.equal(pending.initialInviteValue('?invite=', storage, now), 'VYBE-AAAA-BBBB', 'an empty parameter is no code');
  assert.equal(pending.initialInviteValue('?invite=%20%20', storage, now), 'VYBE-AAAA-BBBB');
  assert.equal(pending.initialInviteValue('?invite=nope', storage, now), 'nope', 'a mistyped URL value is shown as written, so it can be seen before Use code');
  assert.equal(pending.initialInviteValue('', storage, now + 31 * 24 * 60 * 60 * 1000), '', 'an expired kept code is nothing');
  assert.equal(pending.initialInviteValue('', null, now), '');
  assert.equal(pending.initialInviteValue('?invite=7K2MQ9RX', null, now), 'VYBE-7K2M-Q9RX', 'no storage still reads the URL');
});

/* ------------------------------------------------------------------ focus after "Not interested" */

test('focusAfterDismiss: the row that takes the place, the heading after the last row, the main region when the list empties', () => {
  assert.deepEqual(people.focusAfterDismiss(0, 3), { kind: 'row', index: 1 });
  assert.deepEqual(people.focusAfterDismiss(1, 3), { kind: 'row', index: 2 });
  assert.deepEqual(people.focusAfterDismiss(2, 3), { kind: 'heading' }, 'the last row: nothing takes its place, the heading stays');
  assert.deepEqual(people.focusAfterDismiss(0, 1), { kind: 'main' }, 'the only row: the section unmounts into its empty state, heading included');
  assert.deepEqual(people.focusAfterDismiss(-1, 3), { kind: 'heading' }, 'a row not in the list moves nothing away');
  assert.deepEqual(people.focusAfterDismiss(5, 3), { kind: 'heading' });
  assert.deepEqual(people.focusAfterDismiss(0, 0), { kind: 'heading' });
});

test('the landing’s signed-in note while invites are on names both ways and reads as plain sentences', () => {
  assert.equal(redeem.SIGNED_IN_WEB_NOTE, 'You are signed in. Use this code here or in the app.');
  assert.doesNotMatch(redeem.SIGNED_IN_WEB_NOTE, /!|e-mail/);
  assert.doesNotMatch(redeem.SIGNED_IN_WEB_NOTE, BANNED);
  assert.notEqual(redeem.SIGNED_IN_WEB_NOTE, 'You are signed in; open the app to use this code', 'the flag-off note (lib/invites SIGNED_IN_NOTE) is a different sentence');
});

/* ------------------------------------------------------------------ my invites */

const contractBody = (over = {}) => ({
  code: CODE,
  url: `https://vybeapp.fit/join/${CODE}`,
  kind: 'general',
  targetId: null,
  targetName: null,
  createdAt: '2026-09-19T10:00:00Z',
  revokedAt: null,
  redemptionCount: 2,
  joined: [
    { user: { _id: 'u1', username: 'sam', fullName: 'Sam Lee', avatar: 'https://cdn.example/sam.jpg', isVerified: true, isIdentityVerified: false }, at: '2026-09-19T11:00:00Z', kind: 'general' },
    { user: { _id: 'u2', username: 'alex', fullName: 'Alex Rivera', avatar: null, isVerified: true, isIdentityVerified: true }, at: '2026-09-19T12:00:00Z', kind: 'general' },
  ],
  joinedCount: 2,
  contextual: [{ code: 'ABCDEFGH', url: 'https://vybeapp.fit/join/ABCDEFGH', kind: 'gym', targetId: 'g1', targetName: 'Iron Works', createdAt: '2026-09-19T10:00:00Z', revokedAt: null, redemptionCount: 0 }],
  settings: { showAvatar: false },
  ...over,
});

test('parseMyInvites reads GET /invites/me: the code, an https link, first names only, the count, the contextual codes, the opt-in', () => {
  const mine = friends.parseMyInvites(contractBody());
  assert.equal(mine.code, CODE);
  assert.equal(mine.url, `https://vybeapp.fit/join/${CODE}`);
  assert.equal(mine.joinedCount, 2);
  assert.deepEqual(mine.joined.map((j) => friends.firstNameOf(j.user)), ['Sam', 'Alex']);
  assert.deepEqual(Object.keys(mine.joined[0].user), ['_id', 'username', 'fullName', 'avatar']);
  assert.equal(mine.joined[1].user.avatar, undefined, 'a null avatar is not kept');
  assert.equal(mine.joined[1].user.isIdentityVerified, true);
  assert.deepEqual(mine.contextual, [{ code: 'ABCDEFGH', url: 'https://vybeapp.fit/join/ABCDEFGH', kind: 'gym', targetId: 'g1', targetName: 'Iron Works', redemptionCount: 0, created: false }]);
  assert.equal(mine.showAvatar, false);
  assert.equal(friends.parseMyInvites(contractBody({ settings: { showAvatar: true } })).showAvatar, true);

  // A test host's http link is replaced by the canonical one, so a share never carries localhost.
  assert.equal(friends.parseMyInvites(contractBody({ url: `http://localhost:3000/join/${CODE}` })).url, friends.inviteLink(CODE));
  assert.equal(friends.parseMyInvites(contractBody({ url: null })).url, `https://vybeapp.fit/join/${CODE}`);
  assert.equal(friends.inviteLink(CODE), `https://vybeapp.fit/join/${CODE}`);

  assert.equal(friends.parseMyInvites(contractBody({ code: 'nope' })), null);
  assert.equal(friends.parseMyInvites(contractBody({ code: '7K2MQ9R0' })), null, 'outside the alphabet');
  assert.equal(friends.parseMyInvites({}), null);
  assert.equal(friends.parseMyInvites(null), null);
  assert.equal(friends.parseMyInvites('<html>'), null);
  const sparse = friends.parseMyInvites({ code: CODE });
  assert.deepEqual(sparse.joined, []);
  assert.equal(sparse.joinedCount, 0);
  assert.deepEqual(sparse.contextual, []);
  assert.equal(friends.parseMyInvites(contractBody({ joinedCount: 5 })).joinedCount, 5, 'joinedCount can exceed the visible list');
  assert.equal(friends.parseMyInvites(contractBody({ joinedCount: 'many' })).joinedCount, 2, 'falls back to the list length');
  assert.equal(friends.parseMyInvites(contractBody({ joined: [{ user: { username: 'no-id' } }, { user: null }, 'x'] })).joined.length, 0, 'entries without an id are dropped');
  assert.equal(friends.parseMyInvites(contractBody({ contextual: [{ code: 'ABCDEFGH', kind: 'buddy' }] })).contextual.length, 0, 'a kind this build does not know is dropped');
  // Never an email, whatever the body carries.
  const leaky = friends.parseMyInvites(contractBody({ joined: [{ user: { _id: 'u9', username: 'z', fullName: 'Zed', email: 'z@example.com' }, at: 'x', kind: 'general' }] }));
  assert.equal('email' in leaky.joined[0].user, false);

  // POST /invites answers the same shape plus created.
  assert.deepEqual(friends.parseContextualInvite({ code: 'abcdefgh', url: 'http://localhost:3000/join/ABCDEFGH', kind: 'challenge', targetId: 'c1', targetName: 'Push-up month', createdAt: 'x', revokedAt: null, redemptionCount: 0, created: true }), {
    code: 'ABCDEFGH',
    url: 'https://vybeapp.fit/join/ABCDEFGH',
    kind: 'challenge',
    targetId: 'c1',
    targetName: 'Push-up month',
    redemptionCount: 0,
    created: true,
  });
  assert.equal(friends.parseContextualInvite({ code: 'ABCDEFGH', kind: 'general' }), null);
  assert.equal(friends.parseContextualInvite(null), null);

  assert.equal(friends.joinedLine(1), '1 person joined from your invite');
  assert.equal(friends.joinedLine(3), '3 people joined from your invite');
  assert.equal(friends.joinedLine(0), '0 people joined from your invite');
  assert.equal(friends.moreJoinedLine(2), 'and 2 more');
  assert.equal(friends.firstNameOf({ fullName: 'Sam Lee' }), 'Sam');
  assert.equal(friends.firstNameOf({ fullName: '  ', username: 'sam' }), 'sam');
  assert.equal(friends.firstNameOf({}), 'Someone');
  assert.equal(friends.firstNameOf(null), 'Someone');
  assert.equal(friends.inviteTitleFor('Iron Works'), 'Invite to Iron Works');
  assert.equal(friends.shareText(`https://vybeapp.fit/join/${CODE}`), `Join me on Vybe. https://vybeapp.fit/join/${CODE}`);
  assert.equal(friends.contextualFallbackName('gym'), 'this community');
  assert.equal(friends.contextualFallbackName('challenge'), 'this challenge');
});

test('contextualInviteError says the API refusal in its own words, by code, and leaves the rest to the parsed message', () => {
  assert.equal(friends.contextualInviteError('INVITES_NOT_ALLOWED', 'gym'), 'This community is not taking invites right now.');
  assert.equal(friends.contextualInviteError('INVITES_NOT_ALLOWED', 'challenge'), 'This challenge is not taking invites right now.');
  assert.equal(friends.contextualInviteError('INVITE_MEMBERSHIP_REQUIRED', 'gym'), 'Join the community before inviting people to it.');
  assert.equal(friends.contextualInviteError('INVITE_PARTICIPATION_REQUIRED', 'challenge'), 'Join the challenge before inviting people to it.');
  assert.equal(friends.contextualInviteError('INVITE_LIMIT_REACHED', 'gym'), 'You made a lot of invite links today. Try again tomorrow.');
  assert.equal(friends.contextualInviteError('INVITE_TARGET_NOT_FOUND', 'gym'), 'We could not find that community or challenge.');
  assert.equal(friends.contextualInviteError('FEATURE_DISABLED', 'gym'), null);
  assert.equal(friends.contextualInviteError(null, 'gym'), null);
  const http = (status, data) => ({ isAxiosError: true, response: { status, data } });
  assert.equal(friends.contextualInviteMessage(http(400, { message: 'server words', code: 'INVITES_NOT_ALLOWED', field: 'targetId' }), 'gym'), 'This community is not taking invites right now.');
  assert.equal(friends.contextualInviteMessage(http(403, { message: 'Join the community before inviting people to it.', code: 'INVITE_MEMBERSHIP_REQUIRED' }), 'gym'), 'Join the community before inviting people to it.');
  const generic = friends.contextualInviteMessage(http(500, { message: 'Unable to complete the invite request', code: 'INVITE_ERROR' }), 'gym');
  assert.ok(generic.length > 0 && !/status code/.test(generic));
  assert.equal(friends.contextualInviteMessage(undefined, 'gym'), friends.MINT_FAILED);
  assert.equal(friends.isFeatureDisabledError(http(404, { message: 'Invites arrive with a later update.', code: 'FEATURE_DISABLED' })), true);
  assert.equal(friends.isFeatureDisabledError(http(404, { message: 'x', code: 'INVITE_NOT_FOUND' })), false);
  assert.equal(friends.isFeatureDisabledError(undefined), false);
});

/* ------------------------------------------------------------------ strings */

test('every exported string in the three new libs avoids the banned words and the exclamation mark; "email" is never hyphenated', () => {
  const generated = [
    people.dismissLabel('Sam'), people.hiddenCopy('Sam'),
    friends.joinedLine(1), friends.joinedLine(3), friends.moreJoinedLine(2), friends.inviteTitleFor('Iron Works'), friends.shareText('https://vybeapp.fit/join/X'),
    friends.contextualFallbackName('gym'), friends.contextualFallbackName('challenge'),
    ...['INVITES_NOT_ALLOWED', 'INVITE_MEMBERSHIP_REQUIRED', 'INVITE_PARTICIPATION_REQUIRED', 'INVITE_LIMIT_REACHED', 'INVITE_TARGET_NOT_FOUND'].flatMap((code) => [friends.contextualInviteError(code, 'gym'), friends.contextualInviteError(code, 'challenge')]),
    ...redeem.redeemOutcomeCopy(outcome('followed', 'joined', 'joined'), { inviterName: 'Sam', targetName: 'Iron Works' }),
    ...redeem.redeemOutcomeCopy(outcome('requested', 'requested'), {}),
    ...redeem.redeemOutcomeCopy(outcome('already'), {}),
    ...redeem.redeemOutcomeCopy(outcome('blocked'), {}),
    ...['INVITE_NOT_FOUND', 'INVITE_REVOKED', 'INVITE_OWN', 'INVITE_ALREADY_USED', 'FEATURE_DISABLED'].map((code) => redeem.redeemErrorCopy(code, null)),
    redeem.invitedByTitle('Sam'),
  ];
  let checked = 0;
  for (const [name, mod] of [['peopleSuggestions', people], ['inviteFriends', friends], ['inviteRedeem', redeem]]) {
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value !== 'string') continue;
      if (/_RE$|_KEY$|_ORIGIN$|_CODE$/.test(key) && /^[A-Z_]+$/.test(value)) continue; // identifiers, not copy
      checked += 1;
      assert.doesNotMatch(value, BANNED, `${name}.${key} = ${JSON.stringify(value)}`);
      assert.doesNotMatch(value, /!/, `${name}.${key} carries an exclamation mark`);
      assert.doesNotMatch(value, /e-mail/i, `${name}.${key} hyphenates email`);
    }
  }
  assert.ok(checked >= 40, `expected the copy constants to be exported (checked ${checked})`);
  for (const text of generated) {
    assert.equal(typeof text, 'string');
    assert.doesNotMatch(text, BANNED, text);
    assert.doesNotMatch(text, /!/, text);
  }
  // The spec's own sentences, verbatim.
  assert.equal(friends.HONEST, 'Anyone with this link can follow you. You can make a new one.');
  assert.equal(friends.ABOUT, 'Vybe gives nothing for an invite. The only thing you get is the person.');
  assert.equal(friends.NEW_LINK_TITLE, 'Make a new link?');
  assert.equal(friends.NEW_LINK_BODY, 'The old link stops working. People who already joined stay.');
  assert.equal(friends.NEW_LINK_CONFIRM, 'Make new');
  assert.equal(friends.KEEP_LINK, 'Keep');
  assert.equal(friends.JOINED_EMPTY, 'When someone joins from your link, their name shows here');
  assert.equal(redeem.HAVE_CODE, 'Have a code?');
  assert.equal(redeem.CODE_FIELD, 'Invite code');
  assert.equal(redeem.CODE_REDEEM, 'Use code');
  assert.equal(redeem.INVITED_BY_BODY, 'Follow back and you’ll see each other’s sessions.');
  assert.equal(redeem.USE_INVITE, 'Use invite');
  assert.equal(redeem.NOT_NOW, 'Not now');
  assert.equal(people.NOT_INTERESTED, 'Not interested');
  assert.equal(people.OPEN_PROFILE, 'Open profile');
  assert.equal(people.UNDO, 'Undo');
  assert.equal(people.FOR_YOU, 'For you');
});

/* ------------------------------------------------------------------ source pins */

test('the suggestion rows: Discover and Friends render the list, the row posts the exclusion after the undo window, UserRow keeps its pinned lines', () => {
  const discover = read('src/pages/Discover.tsx');
  assert.match(discover, /import \{ SuggestionList \} from '\.\/SuggestionRow';/);
  assert.match(discover, /\{peopleSearch \? \(\s*<PeopleList\s+queryKey="discover-people"/, 'a typed query keeps the directory search');
  assert.match(discover, /<SuggestionList\s+limit=\{10\}\s+heading="For you"/, 'an empty query shows suggestions');
  assert.match(discover, /to="\/settings#coaching"/, 'pinned by tests/workouts-catalog-contract.test.mjs');

  const friendsPage = read('src/pages/Friends.tsx');
  assert.match(friendsPage, /import \{ SuggestionList \} from '\.\/SuggestionRow';/);
  assert.match(friendsPage, /<SuggestionList\s+limit=\{5\}\s+heading="For you"/);
  assert.match(friendsPage, /title="Follow people from your gym or contacts"/);
  assert.ok(friendsPage.indexOf('<SuggestionList') < friendsPage.indexOf('aria-label="Friends and requests"'), 'the list sits above the tabs');
  assert.ok(friendsPage.indexOf('<SuggestionList') > friendsPage.indexOf('<PeopleSearch'), 'and below Add a friend');
  assert.match(friendsPage, /<PeopleSearch\s+query=\{peopleQuery\}/, 'pinned by tests/messaging.test.mjs');
  assert.match(friendsPage, /trailingInteractive/);
  assert.match(friendsPage, /to=\{`\/messages\/new\?to=\$\{u\._id\}`\} state=\{\{ peer: u \}\}/);

  const row = read('src/pages/SuggestionRow.tsx');
  assert.match(row, /import UserRow, \{ FollowButton, UserRowSkeleton \} from '\.\/UserRow';/);
  assert.match(row, /api\.get\('\/searching\/suggest', \{ params: \{ limit \} \}\)/);
  assert.doesNotMatch(row, /searchKey/, 'never a searchKey from the lists: it disables the cold-start fill');
  assert.match(row, /const id = String\(row\._id\);/);
  assert.match(row, /api\.post\(`\/searching\/exclude\/\$\{id\}`\)/);
  assert.match(
    row,
    /setTimeout\(\(\) => \{\s*const entry = pending\.current\.get\(id\);\s*pending\.current\.delete\(id\);\s*if \(entry\) toast\.dismiss\(entry\.toastId\);\s*exclude\(id\);\s*\}, UNDO_WINDOW_MS\)/,
    'the write waits for the undo window, and Undo leaves the screen the moment it stops working',
  );
  // Focus is moved on purpose when the row (and the menu trigger that had focus) unmounts.
  assert.match(row, /focusAfterDismiss\(rows\.findIndex\(\(u\) => String\(u\._id\) === String\(row\._id\)\), rows\.length\)/);
  assert.match(row, /querySelector<HTMLElement>\('\[aria-haspopup="menu"\]'\)/, 'the next row\u2019s overflow trigger');
  assert.match(row, /document\.getElementById\('main'\) : headingRef\.current/, 'else the heading, or the main region when the list empties');
  assert.match(row, /<h2 id=\{headingId\} ref=\{headingRef\} tabIndex=\{-1\}/, 'the heading can take focus');
  assert.match(row, /<ul ref=\{listRef\} className="space-y-2">/);
  assert.match(row, /dismiss\(row\);\s*target\?\.focus\(\{ preventScroll: true \}\);/, 'the cache update first, then focus, in the same tick');
  assert.match(row, /<SuggestionRow row=\{row\} onDismiss=\{onDismiss\} \/>/);
  assert.match(row, /clearTimeout\(entry\.timer\);\s*pending\.current\.delete\(id\);\s*entry\.restore\(\);/, 'Undo cancels the write and puts the row back');
  assert.match(row, /for \(const \[id, entry\] of pending\.current\) \{\s*clearTimeout\(entry\.timer\);\s*toast\.dismiss\(entry\.toastId\);\s*exclude\(id\);/, 'unmount flushes the pending writes');
  assert.match(row, /aria-label=\{WHY_THIS_SUGGESTION\}/);
  assert.match(row, /data-testid="reason-chip"/);
  assert.match(row, /label=\{`More options for \$\{name\}`\}/);
  assert.match(row, /\{ label: NOT_INTERESTED, icon: <X size=\{18\} \/>, onSelect: \(\) => onDismiss\?\.\(row\) \}/);
  assert.match(row, /\{ label: OPEN_PROFILE, icon: <User size=\{18\} \/>, to: `\/u\/\$\{row\._id\}` \}/);

  const userRow = read('src/pages/UserRow.tsx');
  assert.match(userRow, /const verified = user\.isIdentityVerified === true;/);
  assert.match(userRow, /aria-label=\{`Open \$\{displayName\(user\)\}’s profile`\}/);
  assert.match(userRow, /aria-label="Verified" title="Verified"/);
  assert.match(userRow, /Coaching specialties/);
  assert.match(userRow, /below\?: React\.ReactNode/);
  assert.match(userRow, /\{below\}\s*\{\(user\.isCoach \|\| user\.isTrainer\) && user\.fields\?\.length \? \(/, 'the slot sits under the handle line, above the specialties');
  assert.match(userRow, /api\.post\(`\/users\/follow\/\$\{user\._id\}`\)/, 'FollowButton still owns the follow route');
});

test('the invite surfaces hide behind features.invites, treat 404 FEATURE_DISABLED as absent, and call the pinned routes', () => {
  const settings = read('src/pages/Settings.tsx');
  assert.match(settings, /import InviteCodeSection from '\.\/settings\/InviteCodeSection';/);
  assert.match(settings, /import InviteFriendsSection from '\.\/settings\/InviteFriendsSection';/);
  assert.match(settings, /<AccountSection \/>\s*<HomeGymSection \/>\s*<InviteCodeSection \/>/, 'Have a code? sits under Account and the Home gym card');
  assert.equal((settings.match(/<InviteFriendsSection \/>/g) || []).length, 1);
  assert.equal((settings.match(/<InviteCodeSection \/>/g) || []).length, 1);
  assert.match(settings, /<InviteCodeSection \/>\s*<InviteFriendsSection \/>\s*<CoachingSection \/>/, 'Invite friends follows Have a code? in the Account group');
  assert.match(settings, /subtitle="Account, appearance, units, notifications and privacy\."/, 'the subtitle is unchanged');

  const friendsSection = read('src/pages/settings/InviteFriendsSection.tsx');
  assert.match(friendsSection, /const enabled = useFeature\('invites'\);\s*if \(!enabled\) return null;/);
  assert.match(friendsSection, /api\.get\('\/invites\/me'\)/);
  assert.match(friendsSection, /api\.delete\(`\/invites\/\$\{code\}`\)/);
  assert.match(friendsSection, /api\.patch\('\/invites\/me', \{ showAvatar: next \}\)/);
  assert.match(friendsSection, /retry: false,/);
  assert.match(friendsSection, /const disabled = invites\.isError && isFeatureDisabledError\(invites\.error\);/);
  assert.match(friendsSection, /if \(disabled\) return null;/);
  assert.match(friendsSection, /queryKey: \['capabilities'\]/, 'a mid-session flip refreshes the flags');
  assert.match(friendsSection, /<SettingsCard id="invites" title=\{INVITE_TITLE\} description=\{HONEST\}>/);
  assert.match(friendsSection, /copyInviteCode\(shown, document\.getElementById\(codeElementId\)\)/, 'Copy code through the landing’s helper');
  assert.match(friendsSection, /aria-label=\{`Copy link for \$\{name\}`\}/, 'the visible "Copy link" opens the accessible name (label in name)');
  assert.doesNotMatch(friendsSection, /Copy the invite link/);
  assert.match(friendsSection, /navigator\.share\(\{ title: SHARE_TITLE, text: shareText\(url\), url \}\)/);
  assert.match(friendsSection, /confirmLabel=\{NEW_LINK_CONFIRM\}\s*cancelLabel=\{KEEP_LINK\}/);
  assert.match(read('src/lib/inviteFriends.ts'), /parseApiError\(e\)\.code === 'FEATURE_DISABLED'/);

  const codeSection = read('src/pages/settings/InviteCodeSection.tsx');
  assert.match(codeSection, /const enabled = useFeature\('invites'\);\s*if \(!enabled\) return null;/);
  assert.match(codeSection, /api\.post\(`\/invites\/\$\{code\}\/redeem`, \{ clientRequestId: requestId \}\)/);
  assert.match(codeSection, /api\.get\(`\/public\/invites\/\$\{code\}`\)/, 'the names come from the public preview');
  assert.match(codeSection, /const requestId = requestIds\.current\.get\(code\) \?\? redeemRequestId\(code\);/, 'one id per code, reused on a retry');
  assert.match(codeSection, /if \(!code\) throw new InviteRefusal\(MALFORMED_CODE, CODE_INVALID\);/, 'a malformed value never reaches the API');
  assert.match(codeSection, /if \(mine && mine\.code === code\) throw new InviteRefusal\('INVITE_OWN', CODE_OWN\);/);
  assert.match(codeSection, /if \(\(status === 404 && errorCode !== 'FEATURE_DISABLED'\) \|\| status === 410\) throw e;/, 'a dead code is final before the write');
  assert.match(codeSection, /clearPendingInvite\(sessionStorage\)/);
  assert.match(codeSection, /if \(clearsPendingInvite\(code\)\) clearPendingInvite\(sessionStorage\);/);
  assert.match(codeSection, /useState\(\(\) => initialInviteValue\(location\.search, sessionStorage\)\)/, 'the URL code wins over the kept one (the pure rule is tested above)');
  assert.doesNotMatch(codeSection, /readPendingInvite/, 'no second read that could put the kept code first');
  // The #invite-code deep link: the card takes its own scroll and focus once the flag has let it mount.
  assert.match(codeSection, /if \(location\.hash !== '#invite-code'\) return;/);
  assert.match(codeSection, /const card = document\.getElementById\('invite-code'\);\s*if \(!card \|\| card\.contains\(document\.activeElement\)\) return;/, 'a field already in use is left alone');
  assert.match(codeSection, /card\.scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\);\s*card\.setAttribute\('tabindex', '-1'\);\s*card\.focus\(\{ preventScroll: true \}\);/, 'the same move the page handler makes');
  assert.match(read('src/pages/Settings.tsx'), /card\.scrollIntoView\(/, 'the page handler stays for every other card (pinned by tests/source-contract.test.mjs)');
  assert.match(codeSection, /<SettingsCard id="invite-code" title=\{HAVE_CODE\}/);
  assert.match(codeSection, /export function useRedeemInvite\(\)/);

  // Contextual invites: one button owns the flag, POST /invites, the refusal words and the sheet; the pages mount one element.
  const sheet = read('src/pages/InviteLinkSheet.tsx');
  assert.match(sheet, /title=\{inviteTitleFor\(targetName\)\}/);
  assert.match(sheet, /api\.post\('\/invites', \{ kind, targetId \}\)/);
  assert.match(sheet, /const enabled = useFeature\('invites'\);\s*if \(!enabled \|\| !targetId\) return null;/);
  assert.match(sheet, /if \(isFeatureDisabledError\(e\)\) \{\s*void qc\.invalidateQueries\(\{ queryKey: \['capabilities'\] \}\);\s*return;/);
  assert.match(sheet, /toast\.error\(contextualInviteMessage\(e, kind\)\)/);
  assert.match(sheet, /export function ContextualInviteButton\(/);
  const gym = read('src/pages/GymCommunity.tsx');
  assert.match(gym, /import \{ ContextualInviteButton \} from '\.\/InviteLinkSheet';/);
  assert.match(gym, /<ContextualInviteButton kind="gym" targetId=\{communityId\} targetName=\{community\.name \|\| 'this community'\} size="sm" \/>\s*<Button variant="secondary" size="sm" onClick=\{\(\) => setConfirmLeave\(true\)\}>\s*Leave/, 'Invite sits beside Leave, for members only');
  assert.doesNotMatch(gym, /from '\.\.\/lib\/capabilities'|\/invites'/, 'the page itself reads no flag and calls no invite route');
  const challenges = read('src/pages/Challenges.tsx');
  assert.match(challenges, /import \{ ContextualInviteButton \} from '\.\/InviteLinkSheet';/);
  assert.match(challenges, /\{\(joined \|\| isOwner\) && !legacy && !archived && challenge\.isPublic !== false \? \(\s*<ContextualInviteButton kind="challenge" targetId=\{challenge\._id\} targetName=\{challenge\.title\} \/>/);
  assert.doesNotMatch(challenges, /from '\.\.\/lib\/capabilities'|\/invites'/, 'pinned: Challenges.tsx reads no capabilities and calls no invite route itself');
  assert.doesNotMatch(challenges, /errMsg\(/, 'pinned by tests/health-challenges-contract.test.mjs');
  assert.equal((challenges.match(/onChallengeError\(e, '/g) ?? []).length, 4, 'the invite error path does not reuse the challenge mapper');

  // Nothing here reaches into the pinned modules.
  const capabilities = read('src/lib/capabilities.ts');
  assert.doesNotMatch(capabilities, /invites/, 'FEATURE_DEFAULTS is pinned by tests/client-policy.test.mjs');
  assert.doesNotMatch(read('src/App.tsx'), /Invite(Code|Friends)Section|SuggestionRow|WelcomeInvite/, 'no new route or sibling; App.tsx is pinned');
  assert.match(read('src/App.tsx'), /<RequireAuth><Layout \/><WelcomeSheet \/><\/RequireAuth>/);
  assert.doesNotMatch(read('src/components/Layout.tsx'), /invite/i, 'no nav entry: the surfaces live in Settings and on the people lists');

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'GET /api/invites/me', 'PATCH /api/invites/me', 'POST /api/invites', 'POST /api/invites/:code/redeem', 'DELETE /api/invites/:code',
    'GET /api/public/invites/:code', 'GET /api/searching/suggest', 'POST /api/searching/exclude/:targetId',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('the code travels through sign-up in the tab and is offered once on the welcome sheet; the landing points a signed-in member at the web field', () => {
  const reg = read('src/pages/Register.tsx');
  assert.match(reg, /import \{ rememberPendingInvite \} from '\.\.\/lib\/pendingInvite';/);
  assert.match(reg, /rememberPendingInvite\(sessionStorage, new URLSearchParams\(location\.search\)\.get\('invite'\)\)/);
  assert.match(reg, /registerInviteLine\(new URLSearchParams\(location\.search\)\.get\('invite'\)\)/, 'pinned by tests/invite-landing.test.mjs');
  assert.match(reg, /data-testid="register-invite-code"/);
  assert.match(reg, /email: trimmedEmail,\s*username: trimmedUsername,\s*fullName: fullName\.trim\(\),\s*password,\s*fcmTokens: \[\],\s*\}/, 'the register body is unchanged: the API redeems, never the sign-up');
  assert.doesNotMatch(reg, /inviteCode|invitedBy/, 'no invented register field');

  const sheet = read('src/pages/WelcomeSheet.tsx');
  assert.match(sheet, /import \{ readPendingInvite \} from '\.\.\/lib\/pendingInvite';/);
  assert.match(sheet, /import WelcomeInviteSection from '\.\/WelcomeInvite';/);
  assert.match(sheet, /if \(open\) setPendingInvite\(readPendingInvite\(sessionStorage\)\);/);
  assert.match(sheet, /\{pendingInvite \? <WelcomeInviteSection code=\{pendingInvite\} onDone=\{\(\) => setPendingInvite\(null\)\} \/> : null\}\s*<section aria-labelledby="welcome-people-heading">/, 'Invited by sits above People to follow');
  assert.ok(sheet.indexOf('welcome-photo-heading') < sheet.indexOf('<WelcomeInviteSection'), 'the photo section stays first (the browser suite drives it)');
  // The pinned strings.
  assert.match(sheet, /title=\{`Welcome to Vybe, \$\{firstName\}`\}/);
  assert.match(sheet, /api\.get\('\/searching\/suggest'\)/);
  assert.match(sheet, /<UserRow key=\{user\._id\} user=\{user\} \/>/);
  assert.match(sheet, /Skip for now/);
  assert.match(sheet, /takeWelcomePending\(sessionStorage\)/);

  const invite = read('src/pages/WelcomeInvite.tsx');
  assert.match(invite, /const enabled = useFeature\('invites'\);/);
  assert.match(invite, /if \(!enabled \|\| dismissed \|\| dead\) return null;/);
  assert.match(invite, /api\.get\(`\/public\/invites\/\$\{code\}`\)/);
  assert.match(invite, /queryKey: PUBLIC_INVITE_KEY\(code\)/, 'the same key the redeem flow reads, so the preview is fetched once');
  assert.match(invite, /onClick=\{\(\) => redeem\.mutate\(code\)\}/);
  assert.match(invite, /\{USE_INVITE\}/);
  assert.match(invite, /\{NOT_NOW\}/);
  assert.doesNotMatch(invite.slice(invite.indexOf('{NOT_NOW}') - 400, invite.indexOf('{NOT_NOW}')), /clearPendingInvite/, 'Not now leaves the code kept for Settings');
  assert.match(invite, /clearPendingInvite\(sessionStorage\);\s*onDone\?\.\(\);/, 'a dead code is dropped quietly');

  const landing = read('src/pages/JoinInvite.tsx');
  assert.match(landing, /import \{ SIGNED_IN_WEB_NOTE, USE_ON_WEB, settingsInvitePath \} from '\.\.\/lib\/inviteRedeem';/);
  assert.match(landing, /\{invitesEnabled \? \(\s*<ButtonLink to=\{settingsInvitePath\(code\)\} variant="secondary" data-testid="invite-use-web">/);
  assert.match(landing, /<Callout tone="info">\{invitesEnabled \? SIGNED_IN_WEB_NOTE : SIGNED_IN_NOTE\}<\/Callout>/, 'the note agrees with the button beneath it; the flag-off note is unchanged');
  assert.equal((landing.match(/\bapi\.(get|post|put|patch|delete)\(/g) || []).length, 1, 'the landing still makes one API call');
  assert.doesNotMatch(landing, /api\.post\(/, 'nothing is redeemed on the landing');
});

test('a 409 "already used" refusal keeps this code\'s inviter reachable (API a08b42e)', async () => {
  const redeem = await import('../src/lib/inviteRedeem.ts');
  const inviter = { _id: '6aad635402be1805f4b9ef72', username: 'sam', fullName: 'Sam Rivera', avatar: 'https://cdn.example/s.png', isIdentityVerified: true, email: 'never@shown' };
  const e = { response: { status: 409, data: { message: 'You already used an invite.', code: 'INVITE_ALREADY_USED', inviter } } };
  assert.deepEqual(redeem.redeemRefusalInviter(e), { _id: inviter._id, username: 'sam', fullName: 'Sam Rivera', avatar: inviter.avatar, isIdentityVerified: true });
  assert.equal(redeem.redeemRefusalInviter({ response: { status: 409, data: { code: 'INVITE_ALREADY_USED', inviter: null } } }), null, 'a blocked pair names nobody');
  assert.equal(redeem.redeemRefusalInviter({ response: { status: 404, data: { code: 'INVITE_NOT_FOUND', inviter } } }), null);
  assert.equal(redeem.redeemRefusalInviter(new Error('x')), null);
  const source = fs.readFileSync(new URL('../src/pages/settings/InviteCodeSection.tsx', import.meta.url), 'utf8');
  assert.match(source, /usedBy=\{failure\?\.code === 'INVITE_ALREADY_USED' \? redeemRefusalInviter\(redeem\.error\) : null\}/);
  assert.match(source, /data-testid="invite-used-by"/);
});
