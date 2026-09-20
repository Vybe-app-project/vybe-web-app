import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Render-level checks for the people-and-invites surfaces (Wave F). The card,
 * the form and the suggestion row are presentational (every value arrives as
 * a prop, or from the shared FollowButton whose store serves its initial
 * snapshot here), so they render the same under react-dom/server as in the
 * browser. The query-bound containers around them render TanStack's pending
 * state here and are covered by the manual walk against a local API.
 */
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { InviteFriendsCard, InviteLinkBlock } = await import('../src/pages/settings/InviteFriendsSection.tsx');
const { InviteCodeForm } = await import('../src/pages/settings/InviteCodeSection.tsx');
const { default: SuggestionRow, ReasonChips } = await import('../src/pages/SuggestionRow.tsx');
const { parseMyInvites } = await import('../src/lib/inviteFriends.ts');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');
const noop = () => {};
const CODE = '7K2MQ9RX';
const SHOWN = 'VYBE-7K2M-Q9RX';
const URL = `https://vybeapp.fit/join/${CODE}`;
const BANNED = /\b(streak|missed|expire|expiring|hurry|last chance|reward|earn|unlock|bonus|points|free month|refer and earn)\b/i;

const body = (over = {}) => ({
  code: CODE,
  url: URL,
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
  contextual: [],
  settings: { showAvatar: false },
  ...over,
});

const card = (over = {}, props = {}) =>
  decode(mount(h(InviteFriendsCard, { invites: parseMyInvites(body(over)), canShare: false, copied: null, onCopyCode: noop, onCopyLink: noop, onShare: noop, onNewLink: noop, ...props })));

/* ------------------------------------------------------------------ invite friends */

test('the Invite friends card: the #invites region, the code as VYBE-XXXX-XXXX, the link, Copy code / Copy link / New link, Share only when the browser can, who joined by first name', () => {
  const html = card();
  assert.match(html, /<[a-z]+[^>]*id="invites"[^>]*role="region"[^>]*aria-labelledby="invites-title"/);
  assert.match(html, /<h2[^>]*id="invites-title"[^>]*>Invite friends<\/h2>/);
  assert.match(html, /Anyone with this link can follow you\. You can make a new one\./);
  assert.match(html, /<code[^>]*id="my-invite-code"[^>]*data-testid="my-invite-code"[^>]*>VYBE-7K2M-Q9RX<\/code>/);
  assert.ok(html.includes('select-all'), 'the code can be selected by hand');
  assert.ok(html.includes(URL));
  assert.match(html, /<button[^>]*data-testid="invite-copy-code"[^>]*>[\s\S]*?Copy code<\/span><\/button>/);
  assert.match(html, /<button[^>]*data-testid="invite-copy-link"[^>]*>[\s\S]*?Copy link<\/span><\/button>/);
  assert.match(html, /<button[^>]*data-testid="invite-new-link"[^>]*>[\s\S]*?New link<\/span><\/button>/);
  assert.doesNotMatch(html, /data-testid="invite-share"/, 'no Share button without navigator.share');
  assert.doesNotMatch(html, />Share</);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<h3[^>]*id="invites-joined-title"[^>]*>2 people joined from your invite<\/h3>/);
  assert.match(html, /<ul[^>]*aria-label="People who joined from your invite"/);
  assert.match(html, /<a[^>]*href="\/u\/u1"[^>]*>Sam<\/a>/, 'first names only');
  assert.match(html, /<a[^>]*href="\/u\/u2"[^>]*>Alex<\/a>/);
  assert.doesNotMatch(html, /Sam Lee|Alex Rivera|@sam|@alex/, 'never the full name or the handle');
  assert.ok(html.includes('src="https://cdn.example/sam.jpg"'), 'the avatar when there is one');
  assert.doesNotMatch(html, /and \d+ more/);
  assert.match(html, /Vybe gives nothing for an invite\. The only thing you get is the person\./);
  assert.doesNotMatch(html, /Your gym and challenge links/, 'no contextual block without contextual codes');
  assert.doesNotMatch(html, /role="switch"/, 'the photo switch renders only when the container wires it');
  assert.doesNotMatch(html, /!/);
  assert.doesNotMatch(html, BANNED);
  assert.doesNotMatch(html, /e-mail/i);
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));

  const shareable = card({}, { canShare: true });
  assert.match(shareable, /<button[^>]*data-testid="invite-share"[^>]*>[\s\S]*?Share<\/span><\/button>/);

  const empty = card({ joined: [], joinedCount: 0, redemptionCount: 0 });
  assert.match(empty, /<h3[^>]*id="invites-joined-title"[^>]*>Who joined<\/h3>/);
  assert.match(empty, /When someone joins from your link, their name shows here/);
  assert.doesNotMatch(empty, /People who joined from your invite/);

  // joinedCount counts every redemption; accounts no longer visible are one honest line.
  const more = card({ joinedCount: 5 });
  assert.match(more, /5 people joined from your invite/);
  assert.match(more, /and 3 more/);

  const one = card({ joined: [body().joined[0]], joinedCount: 1 });
  assert.match(one, /1 person joined from your invite/);

  const copied = card({}, { copied: 'code' });
  assert.match(copied, /aria-live="polite"[^>]*>Code copied</);
  const linkCopied = card({}, { copied: 'link' });
  assert.match(linkCopied, /aria-live="polite"[^>]*>Link copied</);

  const contextual = card({ contextual: [{ code: 'ABCDEFGH', url: 'https://vybeapp.fit/join/ABCDEFGH', kind: 'gym', targetId: 'g1', targetName: 'Iron Works', createdAt: 'x', revokedAt: null, redemptionCount: 0 }] });
  assert.match(contextual, /<h3[^>]*id="invites-contextual-title"[^>]*>Your gym and challenge links<\/h3>/);
  assert.match(contextual, /Iron Works/);
  assert.match(contextual, /VYBE-ABCD-EFGH/);
  assert.match(contextual, /aria-label="Copy the invite link for Iron Works"/);

  const withSwitch = card({ settings: { showAvatar: true } }, { onToggleAvatar: noop });
  assert.match(withSwitch, /<button[^>]*role="switch"[^>]*aria-checked="true"[^>]*aria-label="Show my photo on the invite page"/);
  assert.match(withSwitch, /Otherwise the page shows your first name only\./);
  const busy = card({}, { busy: true });
  assert.match(busy, /<button[^>]*disabled=""[^>]*data-testid="invite-new-link"/);
});

test('the shared link block renders the same code and buttons for a contextual invite under its own id', () => {
  const html = decode(mount(h(InviteLinkBlock, { codeId: 'contextual-invite-code', code: 'abcdefgh', url: 'https://vybeapp.fit/join/ABCDEFGH', canShare: true, copied: 'selected' })));
  assert.match(html, /<code[^>]*id="contextual-invite-code"[^>]*>VYBE-ABCD-EFGH<\/code>/);
  assert.match(html, /data-testid="contextual-invite-code-url"[^>]*>https:\/\/vybeapp\.fit\/join\/ABCDEFGH</);
  assert.match(html, /data-testid="invite-share"/);
  assert.match(html, /Copying is blocked here\. The code is selected, so copy it by hand\./, 'the clipboard-refused line');
  assert.doesNotMatch(html, /invite-new-link/, 'New link belongs to the general code only');
});

/* ------------------------------------------------------------------ suggestion row */

const chipTexts = (html) => [...html.matchAll(/data-testid="reason-chip"[^>]*>([^<]*)</g)].map((m) => m[1]);

test('a suggestion row: the chips in order with "Invited you" first, the labelled list, Follow, the profile link and the overflow menu', () => {
  const row = { _id: 'u7', username: 'sam', fullName: 'Sam Lee', reason: 'same-gym', reasons: ['same-gym', 'invited-by'], reasonText: 'Also at Iron Works', activeThisWeek: true, followStatus: 'none', isFollowing: false, gymName: 'Iron Works' };
  const html = decode(mount(h(SuggestionRow, { row, onDismiss: noop })));
  assert.deepEqual(chipTexts(html), ['Invited you', 'Also at Iron Works', 'Trains at your gym · there this week']);
  assert.match(html, /<ul[^>]*aria-label="Why this suggestion"/);
  // The accent chip is the brand tone; the others are neutral.
  const chips = [...html.matchAll(/<span class="([^"]*)" data-testid="reason-chip">([^<]*)</g)].map((m) => [m[2], m[1]]);
  assert.equal(chips.length, 3);
  assert.match(chips[0][1], /bg-brand-soft/, '"Invited you" is the one accent');
  assert.doesNotMatch(chips[1][1], /bg-brand-soft/);
  assert.doesNotMatch(chips[2][1], /bg-brand-soft/);
  assert.match(html, /<button[^>]*title="Follow Sam Lee"[^>]*>[\s\S]*?Follow<\/span><\/button>/, 'the shared FollowButton');
  assert.match(html, /aria-label="More options for Sam Lee"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-label="Open Sam Lee’s profile"/);
  assert.match(html, /href="\/u\/u7"/);
  assert.match(html, /@sam/);
  assert.doesNotMatch(html, /Not interested/, 'the menu items render only once the menu opens');
  assert.doesNotMatch(html, /!/);
  assert.doesNotMatch(html, BANNED);

  // The live API appends the week suffix itself: one chip, never two.
  const live = decode(mount(h(SuggestionRow, { row: { ...row, reasons: ['same-gym'], reasonText: 'Also at Iron Works · there this week' } })));
  assert.deepEqual(chipTexts(live), ['Also at Iron Works · there this week']);

  const mutual = decode(mount(h(SuggestionRow, { row: { _id: 'u8', username: 'alex', fullName: 'Alex Rivera', reason: 'mutual', reasons: ['mutual'], reasonText: 'Followed by Sam Lee and 2 others', mutualCount: 3, followStatus: 'none' } })));
  assert.deepEqual(chipTexts(mutual), ['Followed by Sam Lee and 2 others']);

  // A row the API sent without a reason renders no chip row at all: a reason is never invented.
  const bare = decode(mount(h(SuggestionRow, { row: { _id: 'u9', username: 'kim', fullName: 'Kim Park', followStatus: 'none' } })));
  assert.doesNotMatch(bare, /reason-chip/);
  assert.doesNotMatch(bare, /Why this suggestion/);
  assert.match(bare, /Kim Park/);
  assert.match(bare, /title="Follow Kim Park"/);

  // A private account already requested reads Requested, from the API's followStatus.
  const requested = decode(mount(h(SuggestionRow, { row: { ...row, followStatus: 'requested', isPrivate: true } })));
  assert.match(requested, /Requested<\/span><\/button>/);
  assert.match(requested, /aria-label="Private account"/);

  const chipsOnly = decode(mount(h(ReasonChips, { row: {} })));
  assert.doesNotMatch(chipsOnly, /reason-chip|Why this suggestion|<ul/, 'ReasonChips alone renders nothing without a reason');
});

/* ------------------------------------------------------------------ have a code? */

const form = (props = {}) => decode(mount(h(InviteCodeForm, { value: SHOWN, onChange: noop, onSubmit: noop, ...props })));

test('the Have a code? form: the #invite-code region, the labelled field with the rule as its hint, Use code, an alert for a refusal, the sentences for an outcome', () => {
  const html = form();
  assert.match(html, /<[a-z]+[^>]*id="invite-code"[^>]*role="region"[^>]*aria-labelledby="invite-code-title"/);
  assert.match(html, /<h2[^>]*id="invite-code-title"[^>]*>Have a code\?<\/h2>/);
  assert.match(html, /<label[^>]*for="invite-code-field"[^>]*>Invite code<\/label>/);
  assert.match(html, /<input[^>]*id="invite-code-field"[^>]*value="VYBE-7K2M-Q9RX"/);
  assert.match(html, /autocapitalize="characters"/i);
  assert.match(html, /placeholder="VYBE-XXXX-XXXX"/);
  assert.match(html, /<p[^>]*id="invite-code-field-hint"[^>]*>Eight letters and numbers, for example VYBE-7K2M-Q9RX\.<\/p>/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>[\s\S]*?Use code<\/span><\/button>/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.doesNotMatch(html, /role="status"/);
  assert.doesNotMatch(html, /!/);
  assert.doesNotMatch(html, BANNED);

  const own = form({ error: 'That’s your own code.' });
  assert.match(own, /<p[^>]*id="invite-code-field-error"[^>]*role="alert"[^>]*>[\s\S]*?That’s your own code\.<\/span><\/p>/);
  assert.match(own, /<input[^>]*aria-invalid="true"/);
  assert.match(own, /aria-describedby="invite-code-field-error"/);
  assert.match(own, /Use code<\/span><\/button>/, 'the submit stays so a corrected code can be sent');

  const done = form({ result: ['You now follow Sam', 'You joined Iron Works'] });
  assert.match(done, /role="status" aria-live="polite"/);
  assert.match(done, /<p>You now follow Sam<\/p>/);
  assert.match(done, /<p>You joined Iron Works<\/p>/);
  assert.ok(done.indexOf('You now follow Sam') < done.indexOf('You joined Iron Works'), 'the follow line comes first');
  assert.doesNotMatch(done, /role="alert"/);

  const busy = form({ busy: true });
  assert.match(busy, /<button[^>]*type="submit"[^>]*disabled[^>]*aria-busy="true"/);
  const blank = form({ value: '' });
  assert.match(blank, /<button[^>]*type="submit"[^>]*disabled/, 'nothing to send yet');
});
