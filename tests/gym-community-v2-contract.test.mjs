/**
 * Source contracts for P7 (the gym page's v2 surfaces). Every literal request
 * path `src/lib/gymCommunityV2.ts` sends is listed here — as written, and as
 * the backend mounts it — and checked against
 * `contracts/backend-routes.json`. The audit script only recognises `lib/api`
 * imported from outside `src/lib`, so a module that sits beside `api.ts` is
 * invisible to it and this is what holds those paths.
 *
 * The rest pins the decisions that make the package correct rather than
 * merely present: a flag-off 404 and a role 403 both read as absence, no
 * surface calls the claim routes (`gymOwnerClaim` stays dark, D-98), the
 * announcement bodies are the ones the controllers parse, the moderation
 * ladder matches `services/gymModeration.js`, and the `.ics` download goes
 * through the bearer client rather than a bare link.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const count = (source, re) => (source.match(re) || []).length;

const v2 = read('src/lib/gymCommunityV2.ts');
const hooks = read('src/pages/gyms/useGymV2.ts');
const detail = read('src/pages/CommunityDetail.tsx');
const gymsPage = read('src/pages/Gyms.tsx');
const community = read('src/pages/GymCommunity.tsx');
const announcement = read('src/pages/gyms/GymAnnouncement.tsx');
const eventRow = read('src/pages/gyms/GymEventRow.tsx');
const moderation = read('src/pages/gyms/GymModeration.tsx');
const ownership = read('src/pages/gyms/GymOwnership.tsx');
const pending = read('src/pages/gyms/PendingGyms.tsx');
const snapshot = JSON.parse(read('contracts/backend-routes.json'));

/* ----------------------------------------------------------- request paths */

/** Every request this package makes, as written and as the backend mounts it. */
const REQUESTS = [
  // The gym page's activity reads (not flagged).
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/active-this-week`)', route: '/api/gyms/community/:id/active-this-week' },
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/trained-today`, { params: { timeZone } })', route: '/api/gyms/community/:gymId/trained-today' },
  { method: 'GET', literal: 'api.get(`/gyms/places/${encodeURIComponent(placeId)}/hours`, { params: { timeZone } })', route: '/api/gyms/places/:placeId/hours' },
  // Pins: where the community's own announcement lives.
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/pins`)', route: '/api/gyms/community/:gymId/pins' },
  // Announcements (gymAnnouncements).
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/announcements`, body)', route: '/api/gyms/community/:gymId/announcements' },
  { method: 'PATCH', literal: 'api.patch(`/gyms/community/${communityId}/announcements/${postId}`, body)', route: '/api/gyms/community/:gymId/announcements/:postId' },
  { method: 'DELETE', literal: 'api.delete(`/gyms/community/${communityId}/announcements/${postId}`)', route: '/api/gyms/community/:gymId/announcements/:postId' },
  { method: 'PUT', literal: 'api.put(`/gyms/community/${communityId}/announcements/${postId}/seen`)', route: '/api/gyms/community/:gymId/announcements/:postId/seen' },
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/announcements/${postId}/seen`)', route: '/api/gyms/community/:gymId/announcements/:postId/seen' },
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/composer-context`)', route: '/api/gyms/community/:gymId/composer-context' },
  // Moderation (gymModerationQueue).
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/moderation/queue`, { params })', route: '/api/gyms/community/:gymId/moderation/queue' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/moderation/actions`, body)', route: '/api/gyms/community/:gymId/moderation/actions' },
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/moderation/log`, { params })', route: '/api/gyms/community/:gymId/moderation/log' },
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/moderation/members/${userId}/context`)', route: '/api/gyms/community/:gymId/moderation/members/:userId/context' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/moderation/notes`, body)', route: '/api/gyms/community/:gymId/moderation/notes' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/moderation/appeals/${reportId}`, body)', route: '/api/gyms/community/:gymId/moderation/appeals/:reportId' },
  // Notification levels and member prefs (gymNotificationLevels).
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/me/notification-level`)', route: '/api/gyms/community/:gymId/me/notification-level' },
  { method: 'PUT', literal: 'api.put(`/gyms/community/${communityId}/me/notification-level`, body)', route: '/api/gyms/community/:gymId/me/notification-level' },
  { method: 'PUT', literal: 'api.put(`/gyms/community/${communityId}/me/community-prefs`, body)', route: '/api/gyms/community/:gymId/me/community-prefs' },
  { method: 'GET', literal: "api.get('/gyms/community/me/notification-levels')", route: '/api/gyms/community/me/notification-levels' },
  // Ownership (gymOwnership).
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/ownership`)', route: '/api/gyms/community/:gymId/ownership' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/ownership/offer`, { to })', route: '/api/gyms/community/:gymId/ownership/offer' },
  { method: 'DELETE', literal: 'api.delete(`/gyms/community/${communityId}/ownership/offer`)', route: '/api/gyms/community/:gymId/ownership/offer' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/ownership/accept`, {}, { headers: reauthToken ? { \'X-Reauth\': reauthToken } : {} })', route: '/api/gyms/community/:gymId/ownership/accept' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/ownership/decline`, {})', route: '/api/gyms/community/:gymId/ownership/decline' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/ownership/nominate`, {}, { headers: reauthToken ? { \'X-Reauth\': reauthToken } : {} })', route: '/api/gyms/community/:gymId/ownership/nominate' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/ownership/leave`, {})', route: '/api/gyms/community/:gymId/ownership/leave' },
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/roles`)', route: '/api/gyms/community/:gymId/roles' },
  // The Regular laurel (gymRegular).
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/me/regular`)', route: '/api/gyms/community/:gymId/me/regular' },
  { method: 'POST', literal: 'api.post(`/gyms/community/${communityId}/me/regular/offer-seen`, {})', route: '/api/gyms/community/:gymId/me/regular/offer-seen' },
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/regulars`)', route: '/api/gyms/community/:gymId/regulars' },
  // Events: RSVP, attendees, insights, the calendar file.
  { method: 'PUT', literal: 'api.put(`/gyms/events/${eventId}/rsvp`, body)', route: '/api/gyms/events/:eventId/rsvp' },
  { method: 'DELETE', literal: 'api.delete(`/gyms/events/${eventId}/rsvp`)', route: '/api/gyms/events/:eventId/rsvp' },
  { method: 'GET', literal: 'api.get(`/gyms/events/${eventId}/attendees`, { params })', route: '/api/gyms/events/:eventId/attendees' },
  { method: 'GET', literal: 'api.get(`/gyms/events/${eventId}/insights`)', route: '/api/gyms/events/:eventId/insights' },
  { method: 'GET', literal: 'api.get<Blob>(`/gyms/events/${eventId}/ics`, { responseType: \'blob\' })', route: '/api/gyms/events/:eventId/ics' },
  // The floor.
  { method: 'GET', literal: 'api.get(`/gyms/community/${communityId}/equipment`)', route: '/api/gyms/community/:gymId/equipment' },
];

test('every request path in lib/gymCommunityV2 is written out, and the backend mounts it', () => {
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const request of REQUESTS) {
    assert.ok(v2.includes(request.literal), `src/lib/gymCommunityV2.ts sends ${request.literal}`);
    assert.ok(pinned.has(`${request.method} ${request.route}`), `contracts/backend-routes.json must pin ${request.method} ${request.route}`);
  }
  // And the pending-review card reads the list the member already has.
  assert.match(pending, /api\.get\('\/gyms\/community\/my-communities', \{ params: \{ page: 1, limit: 50 \} \}\)/);
  const myCommunities = 'GET /api/gyms/community/my-communities';
  assert.ok(pinned.has(myCommunities), `contracts/backend-routes.json must pin ${myCommunities}`);
});

test('the claim routes are never called: gymOwnerClaim stays dark past the wave (D-98)', () => {
  for (const source of [v2, hooks, detail, announcement, eventRow, moderation, ownership, pending, gymsPage, community]) {
    assert.doesNotMatch(source, /\/claim\b/, 'no surface calls a claim route');
    assert.doesNotMatch(source, /claims\//);
  }
  // The flag is named for completeness and nothing reads it.
  assert.match(v2, /claim: 'gymOwnerClaim'/);
  // Two doc mentions and the one entry in the flag map; no fetcher, no hook, no surface.
  assert.equal(count(v2, /gymOwnerClaim/g), 3, 'named in prose and in the flag map, and nowhere else');
  assert.doesNotMatch(v2, /FLAGS\.claim|GYM_V2_FLAGS\.claim/, 'nothing reads the claim flag');
});

/* ----------------------------------------------------------- absence, not errors */

test('a flag that is off and a role refusal both read as absence, and nothing retries', () => {
  // The one helper every additive read goes through.
  assert.match(v2, /export async function absentOnRefusal<T>\(read: \(\) => Promise<T>\): Promise<T \| null>/);
  assert.match(v2, /if \(status === 404 \|\| status === 403\) return null;/);
  assert.match(v2, /export function isFeatureDisabled\(e: unknown\): boolean \{[\s\S]*?details\.code === 'FEATURE_DISABLED'/);

  // Every hook: no retry, and the fetcher wrapped.
  assert.match(hooks, /const V2_QUERY = \{ retry: false, staleTime: 60_000 \} as const;/);
  const hookFns = hooks.match(/export function use[A-Za-z]+\(/g) || [];
  assert.ok(hookFns.length >= 9, 'one hook per surface');
  assert.equal(count(hooks, /absentOnRefusal\(/g), hookFns.length, 'every hook degrades to null');
  assert.equal(count(hooks, /\.\.\.V2_QUERY,/g), hookFns.length);

  // The activity hooks in the page use the same helper.
  assert.equal(count(community, /absentOnRefusal\(/g), 3);

  // A write that meets the flag says so plainly instead of "Something went wrong".
  for (const [name, source] of Object.entries({ announcement, moderation, ownership })) {
    assert.match(source, /isFeatureDisabled\(e\)/, `${name} tells a flag-off write apart from a fault`);
  }
});

test('the whole gym page is unchanged with the six flags off: nothing is rendered unconditionally', () => {
  // The announcement card only exists when a pinned announcement was found.
  assert.match(detail, /const announcement: PinnedPost \| null = pinnedAnnouncementOf\(pins\.data\?\.pins \|\| \[\]\);/);
  assert.match(detail, /\{announcement \? \(\s*<AnnouncementCard/);
  // The overflow menu only exists when a v2 read gave it a row.
  assert.match(detail, /const overflow = owner\.items\.length \? <Menu items=\{owner\.items\}/);
  // The offer row only when the offer is for the viewer.
  assert.match(detail, /\{ownership\.data\?\.myOffer \? <OwnershipOfferRow/);
  // The moderation section decides for itself, and takes the viewer's role with it.
  assert.match(detail, /<GymModerationSection communityId=\{communityId\} role=\{membership\.role\} enabled=\{canModerate\} \/>/);
  assert.match(moderation, /if \(!enabled \|\| \(queue\.isSuccess && queue\.data === null\)\) return null;/);
  // The laurel comes from the API's own list; an empty set is "nobody here".
  assert.match(detail, /regular=\{Boolean\(m\.user\?\._id && regularIds\.has\(String\(m\.user\._id\)\)\)\}/);
  assert.match(v2, /export const regularSetOf = \(regulars\?: \{ userIds: string\[\] \} \| null\): Set<string> => new Set\(regulars\?\.userIds \|\| \[\]\);/);
  // The v2 reads are members-only, so a stranger's page asks nothing of them.
  for (const hook of ['useNotificationLevel', 'useOwnership', 'useRoles', 'useRegulars']) {
    assert.match(detail, new RegExp(`${hook}\\(communityId, membership\\.isMember\\)`), `${hook} is members-only`);
  }
});

/* ----------------------------------------------------------- the bodies the controllers parse */

test('the announcement writes carry the bodies the controller reads, keyed for a replay', () => {
  // `content` is one string: the API has no title field, so the composer folds
  // the two together and the card splits them back.
  assert.match(v2, /export const announcementContent = \(title: string, body: string\): string =>/);
  assert.match(announcement, /content: announcementContent\(title, body\),/);
  assert.match(announcement, /pin: true,/);
  assert.match(announcement, /clientRequestId: keyRef\.current,/);
  // CLIENT_REQUEST_ID_PATTERN: 16-100 of [A-Za-z0-9_-].
  assert.match(v2, /\.replace\(\/\[\^A-Za-z0-9_-\]\/g, ''\)\.slice\(0, 100\)\.padEnd\(16, '0'\)/);
  // 2200 is the API's own ceiling on `content`.
  assert.match(v2, /export const ANNOUNCEMENT_CONTENT_MAX = 2200;/);
  // pinned: false with pinReason 'limit' is said, not swallowed.
  assert.match(announcement, /result\.pinned === false && result\.pinReason === 'limit'/);
  assert.match(announcement, /result\.held/, 'the C2 filter holding it is said too');
  // Seen-by is a moderator read and mark-seen is fire-and-forget.
  assert.match(detail, /canSeeSeenBy=\{canModerate\}/, 'members are never shown the seen count');
  assert.match(announcement, /const seen = useAnnouncementSeen\(communityId, post\._id, enabled && canSeeSeenBy\);/);
  assert.match(announcement, /markAnnouncementSeen\(communityId, post\._id\)\.catch\(\(\) => undefined\)/);
});

test('a moderation action names the API’s own ladder, its target kind and the rule it requires', () => {
  // The ladder, verbatim from services/gymModeration.js LADDER.
  for (const action of ['note', 'approve', 'dismiss', 'collapse', 'remove', 'mute', 'remove_member', 'escalate']) {
    assert.match(v2, new RegExp(`action: '${action}'`), `the ladder carries ${action}`);
  }
  // The four punitive rungs are the ones that must name a rule.
  assert.equal(count(v2, /rule: true/g), 4);
  assert.match(v2, /\{ action: 'remove_member', label: '[^']+', targets: \['member', 'report'\], rule: true, minRole: 'admin' \}/);
  // mute takes the API's own two durations and nothing else.
  assert.match(v2, /duration\?: '24h' \| '7d';/);
  assert.match(moderation, /const PUNITIVE = new Set<ModerationAction>\(\['collapse', 'remove', 'mute', 'remove_member'\]\);/);
  // The write: keyed, with the target the row resolves and the reports it groups.
  assert.match(moderation, /clientRequestId: clientRequestId\('gym-mod'\),/);
  assert.match(moderation, /\.\.\.\(item\.reportIds\?\.length \? \{ reportIds: item\.reportIds \} : \{\}\)/);
  assert.match(moderation, /\.\.\.\(input\.ruleCode \? \{ ruleCode: input\.ruleCode \} : \{\}\)/);
  // The notes body is the controller's (`memberId`, `label`, `text`) — the doc's `userId` is stale.
  assert.match(v2, /body: \{ memberId: string; text: string; label\?: string \}/);
  // Appeals are `upheld` or `reversed`, as the route defines them.
  assert.match(v2, /decision: 'upheld' \| 'reversed'/);
});

test('an RSVP sends the API’s own words and reads the counts back rather than guessing', () => {
  assert.match(v2, /body: \{ status: 'going' \| 'not_going'; showOnList\?: boolean; remind\?: boolean \}/);
  assert.match(eventRow, /rsvp\.mutate\('going'\)/);
  assert.match(eventRow, /rsvp\.mutate\('not_going'\)/);
  // "Can't" is the person's word; not_going is the API's.
  assert.match(eventRow, /Can’t/);
  // A full event with a waitlist answers `waitlist`, and the row says so.
  assert.match(eventRow, /result\.status === 'waitlist'/);
  assert.doesNotMatch(eventRow, /goingCount: \(event\.goingCount/, 'no optimistic count: the answer carries the new ones');
  assert.match(eventRow, /qc\.invalidateQueries\(\{ queryKey: \['community', communityId, 'events'\] \}\)/);
});

test('the .ics goes through the bearer client and is handed over as a blob, never a bare link', () => {
  assert.match(v2, /responseType: 'blob'/);
  assert.match(v2, /filename="\?\(\[\^";\]\+\)"\?/, "the server's own attachment name wins");
  assert.match(eventRow, /import \{ saveBlob \} from '\.\.\/\.\.\/lib\/portability';/);
  assert.match(eventRow, /const \{ blob, fileName \} = await fetchEventIcs\(event\._id\);/);
  // No <a href> to the route: the token would not travel with it (D-54).
  assert.doesNotMatch(eventRow, /href=\{[^}]*ics/);
  assert.doesNotMatch(detail, /\/ics/);
});

/* ----------------------------------------------------------- the design register */

test('the gym page keeps one blue, one h1 and the zero rule', () => {
  // The header's action is the page's one filled control; every v2 control is
  // secondary, quiet or a ghost.
  assert.match(detail, /<JoinButton community=\{community\} mutation=\{join\} variant="primary" \/>/);
  for (const [name, source] of Object.entries({ eventRow, pending })) {
    assert.doesNotMatch(source, /variant="primary"/, `${name} adds no second filled blue to a page`);
  }
  // A dialog is its own screen and owns one primary; nothing outside one does.
  for (const [name, source] of Object.entries({ announcement, ownership, moderation })) {
    const outsideModal = source.split('<Modal')[0];
    assert.doesNotMatch(outsideModal, /variant="primary"/, `${name} adds no second filled blue to the page behind it`);
  }
  // No page draws its own <h1>: the shell does, from PageHeader.
  for (const [name, source] of Object.entries({ detail, announcement, eventRow, moderation, ownership, pending, gymsPage })) {
    assert.doesNotMatch(source, /<h1/, `${name} draws no heading of its own`);
  }
  // Skeletons are the final geometry, and an empty state waits for its query.
  assert.match(announcement, /export function AnnouncementCardSkeleton\(\)/);
  assert.match(moderation, /\{queue\.isLoading \?/);
  assert.match(pending, /if \(loading\) \{/);
  // No raw hex anywhere in the new code: tokens only.
  for (const [name, source] of Object.entries({ v2, hooks, announcement, eventRow, moderation, ownership, pending })) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, `${name} names no raw colour`);
  }
});

test('what the 390 px drive measured stays fixed: the Today tab holds its geometry', () => {
  // The open-now line is its own request; its row is reserved while it is in
  // flight, or the faces and the check-in under it jump when it lands.
  assert.match(detail, /openNowPending=\{hours\.isPending && hours\.fetchStatus !== 'idle'\}/);
  assert.match(detail, /\{openNowPending \? \(/);
  // Twelve faces in a wrapping row made the card 120 px taller (a 0.27 shift,
  // measured): one row that scrolls is the same height whatever arrives.
  assert.match(detail, /flex items-center gap-2 overflow-x-auto/);
  assert.doesNotMatch(detail, /flex flex-wrap items-center gap-2" aria-label=\{label\}/);
  // The week card is two requests deep and paints once, with both skeletons.
  assert.match(detail, /const settling = isFetchingFigure\(week\) \|\| Boolean\(board && board\.isLoading\);/);
  assert.match(detail, /\{settling \? \(\s*<>\s*<FigureSkeleton \/>\s*\{board \? <BoardSkeleton \/> : null\}/);
  // The board's skeleton draws the same number of rows the list does.
  assert.match(detail, /const BOARD_ROWS = 5;/);
  assert.match(detail, /\.slice\(0, BOARD_ROWS\)/);
  assert.match(detail, /Array\.from\(\{ length: BOARD_ROWS \}\)/);
});

test('the empty states say what to do, and never a zero', () => {
  // Events: the members' state and the admins' ask.
  assert.match(detail, /title=\{canModerate \? 'Plan the first session' : 'No sessions planned yet'\}/);
  // Today: nobody yet is the next action.
  assert.match(detail, /Nobody has checked in yet\./);
  // The directory's first act is the Places search, in one line.
  assert.match(gymsPage, /<p className="t-body text-text-2">\s*Type the name of the place you train at/);
  assert.match(gymsPage, /Add the first gym to the directory/);
  // A gym under review says its state on its own card.
  assert.match(pending, /\{rejected \? 'Not added' : 'Pending review'\}/);
  assert.match(gymsPage, /<GymsUnderReview list=\{underReview\.data \|\| \[\]\}/);
  // Counts obey the zero rule: no figure is drawn from a 0.
  assert.match(moderation, /\{open > 0 \? <Badge tone="info">\{open\}<\/Badge> : null\}/);
  assert.match(eventRow, /const going = typeof goingCount === 'number' && goingCount > 0 \? goingCount : 0;/);
});
