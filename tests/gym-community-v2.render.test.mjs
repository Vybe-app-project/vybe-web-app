/**
 * P7's surfaces render from props alone (renderToString inside a
 * MemoryRouter): the Today card's open-now line and its faces, the "and N
 * others" the `sample` flag asks for, the announcement card's title and body
 * out of one `content` string, the "Seen by N" line that never reads zero,
 * and each RSVP state of an event row.
 *
 * The pure model is exercised here too (`announcementParts`, `actionsFor`,
 * `rsvpStatusOf`, `insightsLine`, `equipmentSummary`, `levelLabel`), so a
 * shape change in a payload fails a test rather than printing a NaN or
 * inventing a headline.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { ToastProvider } = await import('../src/components/ui.tsx');
const v2 = await import('../src/lib/gymCommunityV2.ts');
const detail = await import('../src/pages/CommunityDetail.tsx');
const announcement = await import('../src/pages/gyms/GymAnnouncement.tsx');
const eventRow = await import('../src/pages/gyms/GymEventRow.tsx');
const moderation = await import('../src/pages/gyms/GymModeration.tsx');
const pending = await import('../src/pages/gyms/PendingGyms.tsx');
const ownership = await import('../src/pages/gyms/GymOwnership.tsx');
const gyms = await import('../src/pages/GymCommunity.tsx');

/** Pieces that own no query render in a router alone; pages need the providers the shell gives them. */
const render = (ui) => renderToString(h(MemoryRouter, null, ui));
const mount = (ui) =>
  renderToString(
    h(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      h(MemoryRouter, null, h(ToastProvider, null, ui)),
    ),
  );
/** Visible text only: class names and pixel attributes are full of digits. */
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#x2019;/g, '’')
    .replace(/&#xB7;|&middot;/g, '·')
    .replace(/&#x2014;/g, '—')
    .replace(/\s+/g, ' ')
    // React puts each named face in its own span, so the comma arrives as a
    // separate text node: read the sentence, not the element boundaries.
    .replace(/\s+([,.])/g, '$1');
const count = (html, needle) => html.split(needle).length - 1;

/** A resolved query, as the cards read one (`isPending && fetchStatus !== 'idle'` is the only thing they test). */
const resolved = (data) => ({ data, isPending: false, isLoading: false, isSuccess: true, isError: false, fetchStatus: 'idle' });
const loading = () => ({ data: undefined, isPending: true, isLoading: true, isSuccess: false, isError: false, fetchStatus: 'fetching' });

const actor = (id, name) => ({ _id: id, username: name.toLowerCase().replace(/\W+/g, ''), fullName: name });
const TWELVE = Array.from({ length: 12 }, (_, i) => actor(`u${i + 1}`, `Member ${i + 1}`));

/* ------------------------------------------------------------------ Today: who trained here */

test('the Today card names the faces the server names, and says "and N others" when the row is a sample', () => {
  // Three of three: every one is named, no tail.
  const exact = render(
    h(detail.TodayCard, {
      name: 'Iron Works',
      today: resolved({ count: 3, members: [actor('a', 'Maya Kim'), actor('b', 'Alex Stone'), actor('c', 'Rio Vance')], sample: false }),
      fallbackLine: null,
      member: true,
    }),
  );
  const exactText = textOf(exact);
  assert.match(exactText, /Maya Kim, Alex Stone and 1 other trained here today/);
  assert.doesNotMatch(exactText, /and 1 others/);
  // The faces row itself carries no tail tile when nothing is missing.
  assert.doesNotMatch(exactText, /and \d+ others (?!trained)/);

  // Twelve of forty: `sample` is the API saying the row is a subset, so the
  // faces row ends in the rest rather than pretending twelve is everyone.
  const sampled = render(
    h(detail.TodayCard, {
      name: 'Iron Works',
      today: resolved({ count: 40, members: TWELVE, sample: true }),
      fallbackLine: null,
      member: true,
    }),
  );
  const sampledText = textOf(sampled);
  assert.match(sampledText, /Member 1, Member 2 and 38 others trained here today/);
  assert.match(sampledText, /and 28 others/, 'the faces row admits the twelve are a sample of forty');
  assert.equal(count(sampled, 'aria-label="Trained here today"'), 1);

  // Nobody yet is the next action, never a zero.
  const zero = textOf(render(h(detail.TodayCard, { name: 'Iron Works', today: resolved({ count: 0, members: [] }), fallbackLine: null, member: true })));
  assert.match(zero, /Nobody has checked in yet/);
  assert.doesNotMatch(zero, /\b0 /);

  // The route is not there (an older API, a 404): a member still reads the leaderboard's string.
  const fallback = textOf(render(h(detail.TodayCard, { name: 'Iron Works', today: resolved(null), fallbackLine: 'A few people trained today', member: true })));
  assert.match(fallback, /A few people trained today/);

  // In flight: the skeleton is the card's final geometry, not a hole.
  const busy = render(h(detail.TodayCard, { name: 'Iron Works', today: loading(), fallbackLine: null, member: true }));
  assert.match(busy, /aria-busy="true"/);
});

test('the open-now line is the hours route’s answer, and is omitted when it has none', () => {
  const openNow = v2.readActivity({ count: 2, members: [actor('a', 'Maya Kim')], sample: true });
  assert.equal(openNow.count, 2);

  const open = textOf(
    render(h(detail.TodayCard, { name: 'Iron Works', today: resolved({ count: 0, members: [] }), fallbackLine: null, member: true, openNow: gyms.hoursLine({ open: true, closesAt: '22:00' }) })),
  );
  assert.match(open, /Open now · closes 22:00/);

  const closed = textOf(
    render(h(detail.TodayCard, { name: 'Iron Works', today: resolved({ count: 0, members: [] }), fallbackLine: null, member: true, openNow: gyms.hoursLine({ open: false, opensAt: '06:00' }) })),
  );
  assert.match(closed, /Closed · opens 06:00/);

  // `open: null` — the provider has no hours, or none the parser knows: no chip at all.
  const unknown = textOf(
    render(h(detail.TodayCard, { name: 'Iron Works', today: resolved({ count: 0, members: [] }), fallbackLine: null, member: true, openNow: gyms.hoursLine({ open: null }) })),
  );
  assert.doesNotMatch(unknown, /Open now|Closed/);
});

/* ------------------------------------------------------------------ the announcement */

test('one `content` string becomes a title and a body, and never a truncated headline', () => {
  assert.deepEqual(v2.announcementParts('Squat racks out on Friday\n\nThe left two are being re-bolted. Use the platforms.'), {
    title: 'Squat racks out on Friday',
    body: 'The left two are being re-bolted. Use the platforms.',
  });
  // One line and short: a title with no body.
  assert.deepEqual(v2.announcementParts('Closed on Monday'), { title: 'Closed on Monday', body: '' });
  // A long single paragraph is a body, not a headline the composer never chose.
  const longLine =
    'The gym is shut for the bank holiday and reopens at six on Tuesday, and the class timetable moves by a day for the rest of that week.';
  assert.deepEqual(v2.announcementParts(longLine), { title: null, body: longLine });
  // A multi-line first block is a body too: the first line is not pulled out of a paragraph.
  assert.deepEqual(v2.announcementParts('one\ntwo\n\nthree'), { title: null, body: 'one\ntwo\n\nthree' });
  assert.deepEqual(v2.announcementParts(''), { title: null, body: '' });
  assert.deepEqual(v2.announcementParts(null), { title: null, body: '' });
  // And back again, as the composer sends it.
  assert.equal(v2.announcementContent(' Title ', ' Body '), 'Title\n\nBody');
  assert.equal(v2.announcementContent('Title', ''), 'Title');

  // The form's own rule before the round trip.
  assert.match(v2.announcementError({ title: 'a', body: '' }), /at least 2 characters/);
  assert.equal(v2.announcementError({ title: 'Closed Monday', body: 'See you Tuesday.' }), null);
  assert.match(v2.announcementError({ title: 'x'.repeat(200), body: '' }), /under 120 characters/);
  assert.match(v2.announcementError({ title: 'Long one', body: 'y'.repeat(2300) }), /under 2200 characters/);
});

test('the announcement card draws the notice, says who it is from, and never reads "Seen by 0"', () => {
  const html = mount(
    h(announcement.AnnouncementCard, {
      communityId: 'c1',
      communityName: 'Iron Works',
      post: { _id: 'p1', content: 'Squat racks out on Friday\n\nUse the platforms.', isAnnouncement: true },
      canSeeSeenBy: false,
      canManage: false,
      enabled: false,
    }),
  );
  const text = textOf(html);
  assert.match(text, /Announcement/);
  assert.match(text, /Iron Works/);
  assert.match(text, /Squat racks out on Friday/);
  assert.match(text, /Use the platforms\./);
  assert.match(html, /aria-label="Announcement from Iron Works"/);
  // A member is never shown the seen count, and never a Take it down button.
  assert.doesNotMatch(text, /Seen by/);
  assert.doesNotMatch(text, /Take it down/);

  // The moderator's controls.
  const mod = mount(
    h(announcement.AnnouncementCard, {
      communityId: 'c1',
      communityName: 'Iron Works',
      post: { _id: 'p1', content: 'Closed Monday', isAnnouncement: true },
      canSeeSeenBy: true,
      canManage: true,
      enabled: false,
    }),
  );
  assert.match(textOf(mod), /Take it down/);

  // Below SEEN_COUNT_MIN the API sends null, so the line is absent — never a zero.
  assert.equal(announcement.seenByLine(null), null);
  assert.equal(announcement.seenByLine(0), null);
  assert.equal(announcement.seenByLine(undefined), null);
  assert.equal(announcement.seenByLine(12), 'Seen by 12');

  // The skeleton holds the card's geometry.
  assert.match(render(h(announcement.AnnouncementCardSkeleton, {})), /aria-busy="true"/);
});

test('the pinned announcement is found through the pin strip, in position order', () => {
  const pins = [
    { position: 2, post: { _id: 'p3', isAnnouncement: true, content: 'Later notice' } },
    { position: 0, post: { _id: 'p1', isAnnouncement: false, content: 'An ordinary pinned post' } },
    { position: 1, post: { _id: 'p2', isAnnouncement: true, content: 'The notice' } },
  ];
  assert.equal(v2.pinnedAnnouncementOf(pins)._id, 'p2', 'the lowest-positioned announcement wins');
  assert.equal(v2.pinnedAnnouncementOf([{ position: 0, post: { _id: 'p1', isAnnouncement: false } }]), null);
  assert.equal(v2.pinnedAnnouncementOf([]), null);
});

/* ------------------------------------------------------------------ events: RSVP, faces, insights */

test('an event row reads its own RSVP state back from whichever spelling the payload used', () => {
  assert.equal(eventRow.rsvpStatusOf({ myRsvp: null }), 'none');
  assert.equal(eventRow.rsvpStatusOf({ myRsvp: true }), 'going', 'the legacy boolean');
  assert.equal(eventRow.rsvpStatusOf({ myRsvp: 'going' }), 'going');
  assert.equal(eventRow.rsvpStatusOf({ myRsvp: 'yes' }), 'going', 'the legacy string');
  assert.equal(eventRow.rsvpStatusOf({ myRsvp: 'waitlist' }), 'waitlist');
  assert.equal(eventRow.rsvpStatusOf({ myRsvp: { status: 'going', remind: true } }), 'going');
  assert.equal(eventRow.rsvpStatusOf({ myRsvp: { status: 'none', removed: true } }), 'none');

  assert.equal(eventRow.capacityLine({ isFull: true, spotsLeft: 0 }), 'Full');
  assert.equal(eventRow.capacityLine({ spotsLeft: 1 }), '1 spot left');
  assert.equal(eventRow.capacityLine({ spotsLeft: 9 }), '9 spots left');
  assert.equal(eventRow.capacityLine({ spotsLeft: null }), null, 'unlimited says nothing');
  assert.equal(eventRow.capacityLine({ spotsLeft: 0 }), null, 'a zero is not a fact about spots');
});

test('an event row offers Going / Can’t and the calendar file, per state', () => {
  const base = { _id: 'e1', title: 'Saturday squad', goingCount: 3, attendeesPreview: [actor('a', 'Maya Kim'), actor('b', 'Alex Stone')] };

  const none = mount(h(eventRow.GymEventRow, { event: base, communityId: 'c1', when: 'Sat 3 Oct, 18:00', member: true }));
  const noneText = textOf(none);
  assert.match(noneText, /Saturday squad/);
  assert.match(noneText, /Sat 3 Oct, 18:00/);
  assert.match(noneText, /Going/);
  assert.match(noneText, /Can’t/);
  assert.match(noneText, /Add to calendar/);
  assert.match(noneText, /and 1 more going/, 'the faces the payload sends, then the rest of the count');
  assert.doesNotMatch(noneText, /You’re going/);

  const going = textOf(mount(h(eventRow.GymEventRow, { event: { ...base, myRsvp: { status: 'going' } }, communityId: 'c1', when: 'Sat 3 Oct', member: true })));
  assert.match(going, /You’re going/);

  const waitlisted = textOf(
    mount(h(eventRow.GymEventRow, { event: { ...base, myRsvp: { status: 'waitlist' }, isFull: true }, communityId: 'c1', when: 'Sat 3 Oct', member: true })),
  );
  assert.match(waitlisted, /You’re on the waitlist/);
  assert.match(waitlisted, /Full/);
  assert.match(waitlisted, /Take a place/);

  // A cancelled session keeps its row and its reason, and offers no RSVP.
  const cancelled = textOf(
    mount(h(eventRow.GymEventRow, { event: { ...base, status: 'cancelled', cancelReason: 'Storm' }, communityId: 'c1', when: 'Sat 3 Oct', member: true })),
  );
  assert.match(cancelled, /Cancelled/);
  assert.match(cancelled, /Storm/);
  assert.doesNotMatch(cancelled, /Can’t/);

  // A non-member reading a public session may take the file, not a place.
  const stranger = textOf(mount(h(eventRow.GymEventRow, { event: base, communityId: 'c1', when: 'Sat 3 Oct', member: false })));
  assert.match(stranger, /Add to calendar/);
  assert.doesNotMatch(stranger, /Can’t/);
});

test('the organiser’s turnout line is only what the insights route sent', () => {
  assert.equal(eventRow.insightsLine(null), null);
  assert.equal(eventRow.insightsLine({ going: 0, waitlisted: 0, attended: 0, walkIns: 0 }), null, 'all zeros is no line at all');
  assert.equal(eventRow.insightsLine({ going: 12, attended: 9, walkIns: 2 }), '12 going · 9 turned up · 2 walked in');
  assert.equal(eventRow.insightsLine({ going: 4, previous: { attended: 7 } }), '4 going · 7 last time');
  assert.equal(eventRow.insightsLine({ going: 4, previous: null }), '4 going');
});

/* ------------------------------------------------------------------ moderation: the ladder and the rows */

test('a queue row offers only the ladder rungs its target and the viewer’s role allow', () => {
  const reportOnPost = {
    kind: 'report',
    id: 'r1',
    reportIds: ['r1'],
    reportCount: 2,
    target: { type: 'post', id: 'p1', author: actor('a', 'Maya Kim') },
    member: { user: actor('a', 'Maya Kim') },
  };
  const asModerator = v2.actionsFor(reportOnPost, 'moderator').map((r) => r.action);
  assert.deepEqual(asModerator, ['note', 'approve', 'dismiss', 'collapse', 'remove', 'mute', 'escalate']);
  assert.ok(!asModerator.includes('remove_member'), 'removing a member is an admin rung');
  const asAdmin = v2.actionsFor(reportOnPost, 'admin').map((r) => r.action);
  assert.ok(asAdmin.includes('remove_member'));
  const asOwner = v2.actionsFor(reportOnPost, 'owner').map((r) => r.action);
  assert.ok(asOwner.includes('remove_member'));
  // A plain member holds no rung at all.
  assert.deepEqual(v2.actionsFor(reportOnPost, 'member'), []);

  // A held post is a post: nothing about a report applies to it.
  const held = { kind: 'held_post', id: 'p2', heldReason: 'new_member_hold', target: { type: 'post', id: 'p2', author: actor('b', 'Alex Stone') }, member: { user: actor('b', 'Alex Stone') } };
  const heldRungs = v2.actionsFor(held, 'moderator').map((r) => r.action);
  assert.ok(heldRungs.includes('approve'));
  assert.ok(heldRungs.includes('collapse'));
  assert.ok(!heldRungs.includes('dismiss'), 'dismiss names a report; a held post has none');
  assert.ok(!heldRungs.includes('escalate'));

  // Which target an action names.
  assert.deepEqual(moderation.targetFor(reportOnPost, 'remove'), { kind: 'report', id: 'r1' });
  assert.deepEqual(moderation.targetFor(held, 'approve'), { kind: 'post', id: 'p2' });
  assert.deepEqual(moderation.targetFor(held, 'mute'), { kind: 'member', id: 'b' });
  assert.deepEqual(moderation.targetFor({ kind: 'report', id: 'r9', reportIds: ['r9'], target: { type: 'comment', id: 'cm1' } }, 'dismiss'), { kind: 'report', id: 'r9' });
});

test('a queue row says what it is in words, and a log row says which rule it named', () => {
  assert.equal(moderation.queueItemLine({ kind: 'report', id: 'r1', reportCount: 1, target: { type: 'post' } }), '1 report about a post');
  assert.equal(moderation.queueItemLine({ kind: 'report', id: 'r1', reportCount: 3, target: { type: 'comment' } }), '3 reports about a comment');
  assert.equal(moderation.queueItemLine({ kind: 'held_post', id: 'p1', heldReason: 'new_member_hold', target: { type: 'post' } }), 'A new member’s first post is waiting for review');
  assert.equal(moderation.queueItemLine({ kind: 'held_post', id: 'p1', heldReason: 'filter', target: { type: 'post' } }), 'A post the filter held for review');

  assert.equal(moderation.logLine({ id: 'n1', kind: 'note', text: 'Warned about the language' }), 'Warned about the language');
  assert.equal(
    moderation.logLine({ id: 'n2', kind: 'action', action: { type: 'remove', ruleCode: 'C1', ruleTitle: 'Re-rack your weights' } }),
    'Remove under C1 · Re-rack your weights',
  );
  assert.equal(moderation.logLine({ id: 'n3', kind: 'action', action: { type: 'mute', duration: '24h', ruleCode: 'C2' } }), 'Mute for 24h under C2');

  // The appeals list is the queue rows whose statement carries one.
  const items = [
    { kind: 'report', id: 'r1', reportIds: ['r1'], target: { type: 'post' }, statement: { action: 'remove', appeal: { status: 'open' } } },
    { kind: 'report', id: 'r2', reportIds: ['r2'], target: { type: 'post' }, statement: { action: 'remove' } },
    { kind: 'held_post', id: 'p1', target: { type: 'post' } },
  ];
  const appeals = v2.appealsOf(items);
  assert.equal(appeals.length, 1);
  assert.equal(appeals[0].reportId, 'r1');
  assert.equal(appeals[0].status, 'open');
});

test('the moderation section is absent for a member, and for a moderator whose flag is off', () => {
  // Not a moderator: the component returns null before it asks anything, so
  // the only markup is the toast provider's own live region.
  const html = mount(h(moderation.GymModerationSection, { communityId: 'c1', role: 'member', enabled: false }));
  assert.doesNotMatch(html, /Moderation/);
  assert.doesNotMatch(html, /aria-label="Moderation"/);
  assert.equal(textOf(html).trim(), '');
});

/* ------------------------------------------------------------------ levels, the laurel, the floor */

test('the overflow row says the level in the member’s own words, and a mute wins over it', () => {
  assert.equal(v2.levelLabel({ level: 'highlights', mutedUntil: null, mutedIndefinitely: false, default: 'highlights' }), 'Notifications: Highlights');
  assert.equal(v2.levelLabel({ level: 'all', mutedUntil: null, mutedIndefinitely: false, default: 'highlights' }), 'Notifications: All');
  assert.equal(v2.levelLabel({ level: 'none', mutedUntil: null, mutedIndefinitely: false, default: 'highlights' }), 'Notifications: Off');
  assert.equal(v2.levelLabel({ level: 'mentions', mutedUntil: null, mutedIndefinitely: false, default: 'highlights' }), 'Notifications: Mentions only');
  assert.equal(v2.levelLabel({ level: 'all', mutedUntil: null, mutedIndefinitely: true, default: 'highlights' }), 'Notifications: muted');
  assert.equal(v2.levelLabel(null), 'Notifications');
  // The four the API accepts, and only those.
  assert.deepEqual(v2.NOTIFICATION_LEVELS.map((r) => r.value), ['all', 'highlights', 'mentions', 'none']);
});

test('the Regular laurel is read from the API and never invented', () => {
  assert.deepEqual([...v2.regularSetOf({ userIds: ['a', 'b'] })], ['a', 'b']);
  assert.equal(v2.regularSetOf(null).size, 0, 'the flag is off: nobody is a Regular here');
  assert.equal(v2.regularSetOf({ userIds: [] }).size, 0);
  const html = render(h(ownership.RegularBadge, {}));
  assert.match(textOf(html), /Regular/);
});

test('only the owner may be offered ownership away, and only to an admin or a moderator', () => {
  const roles = {
    owner: actor('o', 'Sam Reid'),
    admins: [actor('o', 'Sam Reid'), actor('a1', 'Maya Kim')],
    moderators: [actor('m1', 'Alex Stone')],
    staff: [],
    regulars: [],
  };
  const candidates = v2.offerCandidates(roles, 'o').map((c) => c._id);
  assert.deepEqual(candidates, ['a1', 'm1'], 'the owner is never offered their own gym');
  assert.deepEqual(v2.offerCandidates(null, 'o'), [], 'the flag is off: no offer flow at all');
});

test('the floor is summarised only where it was described', () => {
  assert.equal(v2.equipmentSummary(null), null);
  assert.equal(v2.equipmentSummary({ isEmpty: true, bars: [], dumbbellsKg: [] }), null, 'nobody has described it: no line');
  assert.equal(
    v2.equipmentSummary({ isEmpty: false, bars: [{ name: 'Olympic bar', weightKg: 20 }], dumbbellsKg: [10, 20], platesKg: [5], machines: [{ name: 'Leg press' }] }),
    '1 bar · 2 dumbbells · 1 plate size · 1 machine',
  );
});

/* ------------------------------------------------------------------ the gym a member added */

test('a gym under review gets its own card, and says who can see it', () => {
  const rows = [
    { _id: 'c1', name: 'Bethlehem Barbell', source: 'member', reviewState: 'pending', vicinity: '12 Main St' },
    { _id: 'c2', name: 'Iron Works', vicinity: 'Broad St' },
    { _id: 'c3', name: 'Garage Gym', source: 'member', reviewState: 'rejected' },
    { _id: 'c4', name: 'Approved One', source: 'member', reviewState: 'approved' },
  ];
  const under = pending.underReview(rows).map((c) => c._id);
  assert.deepEqual(under, ['c1', 'c3'], 'a reviewed community is an ordinary one');
  assert.equal(pending.isPendingReview(rows[0]), true);
  assert.equal(pending.isRejected(rows[2]), true);
  assert.equal(pending.isPendingReview(rows[1]), false);

  const html = mount(h(pending.GymsUnderReview, { list: pending.underReview(rows) }));
  const text = textOf(html);
  assert.match(text, /Pending review/);
  assert.match(text, /Not added/);
  assert.match(text, /Bethlehem Barbell/);
  assert.match(text, /only you and its members can see it/);
  assert.match(html, /href="\/communities\/c1"/);

  // Nothing waiting: no heading at all.
  assert.equal(textOf(mount(h(pending.GymsUnderReview, { list: [] }))).trim(), '');
});
