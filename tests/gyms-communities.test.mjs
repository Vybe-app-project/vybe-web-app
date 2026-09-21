import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const gyms = await import('../src/lib/gyms.ts');
const share = await import('../src/lib/shareLinks.ts');

/* ------------------------------------------------------------------ membership */

test('membership is derived from every shape the API sends', () => {
  // Detail / my-communities: userMembership only (the shape that used to render the stranger view).
  assert.deepEqual(gyms.membershipOf({ userMembership: { status: 'member', role: 'admin', isMember: true } }), {
    status: 'member', isMember: true, role: 'admin', pending: false,
  });
  assert.deepEqual(gyms.membershipOf({ userMembership: { status: 'member', role: 'member' } }), {
    status: 'member', isMember: true, role: 'member', pending: false,
  });
  // Explore: top-level flags.
  assert.deepEqual(gyms.membershipOf({ isMember: true, userRole: 'moderator' }), {
    status: 'member', isMember: true, role: 'moderator', pending: false,
  });
  // Pending requester and stranger.
  assert.deepEqual(gyms.membershipOf({ isMember: false, userRole: null, userMembership: { status: 'pending', requestId: 'r1' } }), {
    status: 'pending', isMember: false, role: null, pending: true,
  });
  assert.deepEqual(gyms.membershipOf({ userMembership: { status: 'none' } }), {
    status: 'none', isMember: false, role: null, pending: false,
  });
  assert.deepEqual(gyms.membershipOf(undefined), { status: 'none', isMember: false, role: null, pending: false });
  assert.equal(gyms.isModRole('admin'), true);
  assert.equal(gyms.isModRole('Moderator'), true);
  assert.equal(gyms.isModRole('member'), false);
});

test('visibility vocabulary and the join label agree everywhere', () => {
  assert.equal(gyms.visibilityBadge({ settings: { isPublic: false, requireApproval: true } }), 'private');
  assert.equal(gyms.visibilityBadge({ settings: { isPublic: true, requireApproval: true } }), 'approval');
  assert.equal(gyms.visibilityBadge({ settings: { isPublic: true, requireApproval: false } }), null);
  assert.equal(gyms.joinLabel({ settings: { isPublic: true } }), 'Join');
  assert.equal(gyms.joinLabel({ settings: { isPublic: true, requireApproval: true } }), 'Request to join');
  assert.equal(gyms.joinLabel({ settings: { isPublic: false } }), 'Request to join');
  assert.equal(gyms.joinLabel({ userMembership: { status: 'pending' } }), 'Cancel request');
  assert.equal(gyms.pluralize(1, 'member'), '1 member');
  assert.equal(gyms.pluralize(2, 'member'), '2 members');
  assert.equal(gyms.pluralize(3, 'community', 'communities'), '3 communities');
  assert.equal(gyms.founderIdOf({ founder: { _id: 'f1' } }), 'f1');
  assert.equal(gyms.founderIdOf({ founder: 'f2' }), 'f2');
  assert.equal(gyms.founderIdOf({}), null);
});

/* ------------------------------------------------------------------ covers */

test('community covers come from photos[0].photoReference in all three forms', () => {
  assert.deepEqual(gyms.coverSourceOf({ photos: [{ photoReference: 'https://vybeapp.fit/api/media/content/abc.def' }] }), {
    kind: 'url', url: 'https://vybeapp.fit/api/media/content/abc.def',
  });
  assert.deepEqual(gyms.coverSourceOf({ photos: [{ photoReference: 'uploads/0123456789abcdef01234567/media/photo-1.png' }] }), {
    kind: 'media-key', key: 'uploads/0123456789abcdef01234567/media/photo-1.png',
  });
  assert.deepEqual(gyms.coverSourceOf({ photos: [{ photoReference: 'AZose0kGoogleToken_-abc' }] }), {
    kind: 'place-photo', reference: 'AZose0kGoogleToken_-abc',
  });
  // Legacy/alternate fields still work; nothing means no cover (placeholder).
  assert.deepEqual(gyms.coverSourceOf({ coverImage: 'https://cdn.example/x.jpg' }), { kind: 'url', url: 'https://cdn.example/x.jpg' });
  assert.deepEqual(gyms.coverSourceOf({ photos: [{ url: 'https://cdn.example/y.jpg' }] }), { kind: 'url', url: 'https://cdn.example/y.jpg' });
  assert.equal(gyms.coverSourceOf({ photos: [] }), null);
  assert.equal(gyms.coverSourceOf(null), null);
});

/* ------------------------------------------------------------------ nearby / places */

test('map results already in the directory are not listed twice', () => {
  const directory = [
    { _id: 'g1', name: 'Planet Fitness', placeId: 'osm-node-1', location: { lat: 40.6259, lng: -75.3705 } },
    { _id: 'g2', name: 'Iron Works Bethlehem', location: { lat: 40.62, lng: -75.37 } },
  ];
  const places = [
    { place_id: 'osm-node-1', name: 'Planet Fitness (Allentown)', geometry: { location: { lat: 40.63, lng: -75.38 } } },
    { place_id: 'osm-node-2', name: 'Iron Works Bethlehem', geometry: { location: { lat: 40.6201, lng: -75.3701 } } },
    { place_id: 'osm-node-3', name: 'Iron Works Bethlehem', geometry: { location: { lat: 40.7, lng: -75.5 } } },
    { place_id: 'osm-node-4', name: 'Crunch Fitness', geometry: { location: { lat: 40.61, lng: -75.36 } } },
  ];
  assert.deepEqual(gyms.dedupeProviderPlaces(places, directory).map((p) => p.place_id), ['osm-node-3', 'osm-node-4']);
  assert.equal(gyms.providerRadiusMeters('10'), 10000);
  assert.equal(gyms.providerRadiusMeters(50), 50000);
  assert.equal(gyms.providerRadiusMeters(999), 50000);
  assert.equal(gyms.providerRadiusMeters('nope'), 100);
  assert.equal(Math.round(gyms.haversineKm(40.6259, -75.3705, 40.6259, -75.2)), 14);
  assert.equal(gyms.distanceLabelKm(0.02), '50 m');
  assert.equal(gyms.distanceLabelKm(0.83), '850 m');
  assert.equal(gyms.distanceLabelKm(3.26), '3.3 km');
  assert.equal(gyms.distanceLabelKm(14.4), '14 km');
  assert.equal(gyms.distanceLabelKm(null), null);
});

test('a map place pre-fills the community form', () => {
  assert.deepEqual(
    gyms.presetFromPlace({ place_id: 'osm-node-9', name: 'Crunch', formatted_address: '1 Main St, Bethlehem, Pennsylvania', geometry: { location: { lat: 40.6, lng: -75.3 } } }),
    { placeId: 'osm-node-9', name: 'Crunch', vicinity: '1 Main St, Bethlehem, Pennsylvania', location: { latitude: 40.6, longitude: -75.3 } },
  );
  assert.equal(gyms.presetFromPlace({ name: 'Nowhere' }).location, null);
  assert.equal(gyms.communityNameError('A'), 'Give the community a name of at least 2 characters');
  assert.equal(gyms.communityNameError('x'.repeat(121)), 'Keep the name under 120 characters');
  assert.equal(gyms.communityNameError('Bethlehem Lifters'), null);
  assert.equal(gyms.maxMembersError('1'), 'Between 2 and 10,000 members');
  assert.equal(gyms.maxMembersError('1000'), null);
  assert.equal(gyms.isObjectId('6aad635402be1805f4b9ef7c'), true);
  assert.equal(gyms.isObjectId('gym1'), false);
});

/* ------------------------------------------------------------------ the band's gym (Gym First) */

test('bandGymOf maps the details payload honestly: 1 member, no rating, partial vicinity, four faces, the server\'s today string', async () => {
  const { createElement: h } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { bandGymOf, GymTabs } = await import('../src/pages/CommunityDetail.tsx');
  const { memberTotalOf } = await import('../src/pages/GymCommunity.tsx');
  const { memberCountLabel } = await import('../src/components/GymBand.tsx');
  const u = (i) => ({ _id: `u${i}`, username: `m${i}`, fullName: `Member ${i}` });
  // A brand-new community: its creator, an empty vicinity, no rating, no coordinates.
  const fresh = bandGymOf({ _id: 'c1', name: 'Iron Works', vicinity: '', totalMembers: 1, members: [{ user: u(1), role: 'admin' }], stats: { totalMembers: 7 } }, '');
  assert.equal(fresh.memberCount, 1, 'totalMembers wins over the stored stats counter');
  assert.equal(memberCountLabel(fresh.memberCount), '1 member');
  assert.equal(fresh.city, undefined, 'an empty vicinity renders the name alone');
  assert.equal(fresh.rating, null, 'no rating unless a real number');
  assert.equal(fresh.coords, undefined);
  assert.equal(fresh.photoUrl, undefined);
  assert.equal(fresh.sessionsTodayLabel, undefined);
  assert.deepEqual(fresh.people, [{ id: 'u1', name: 'Member 1', avatar: undefined }]);
  // A populated one: a bare-street vicinity, a real rating, five members in the payload -> four faces, "a few" verbatim.
  const busy = bandGymOf(
    { _id: 'c2', name: 'Bethlehem Barbell', vicinity: '120 Market Street', totalMembers: 128, members: [1, 2, 3, 4, 5].map((i) => ({ user: u(i) })), googleMapsData: { rating: 4.6 }, location: { latitude: 40.6, longitude: -75.3 } },
    'uploads/x.jpg',
    'a few',
  );
  assert.equal(busy.city, '120 Market Street');
  assert.equal(busy.rating, 4.6);
  assert.deepEqual(busy.coords, { lat: 40.6, lng: -75.3 });
  assert.equal(busy.people.length, 4, 'the stack shows at most four; the count comes from totalMembers');
  assert.equal(busy.sessionsTodayLabel, 'a few');
  assert.equal(memberCountLabel(busy.memberCount), '128 members');
  // A zero or missing count never reaches the band.
  assert.equal(memberTotalOf({ _id: 'c3', totalMembers: 0 }), undefined);
  assert.equal(memberTotalOf({ _id: 'c4', stats: { totalMembers: 3 } }), 3, 'list payloads fall back to the stored counter');
  assert.equal(bandGymOf({ _id: 'c5', name: 'X', googleMapsData: { rating: 0 } }, '').rating, null);
  // The strip is the page's one tab row (the shared Tabs, underline variant): four link tabs, the active
  // one selected, a count only when a real integer was given. The icon precedes the label from `sm`.
  const html = renderToString(h(MemoryRouter, null, h(GymTabs, { pathname: '/communities/c1', active: 'members', counts: { members: 1 } })));
  assert.match(html, /role="tablist" aria-label="Gym sections"/);
  assert.match(html, /<a (?=[^>]*role="tab")(?=[^>]*href="\/communities\/c1")[^>]*>(?:<svg[\s\S]*?<\/svg>)?Feed<\/a>/);
  assert.match(html, /<a (?=[^>]*aria-selected="true")(?=[^>]*href="\/communities\/c1\?tab=members")[^>]*>(?:<svg[\s\S]*?<\/svg>)?Members<span[^>]*>1<\/span><\/a>/);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.equal((html.match(/role="tab"/g) || []).length, 4);
  assert.doesNotMatch(html, /Today<span/, 'no count for Today unless a real integer was given');
  assert.doesNotMatch(html, /gym-band-tab/, 'the band strip is gone');
  // A zero is not a count.
  const zero = renderToString(h(MemoryRouter, null, h(GymTabs, { pathname: '/communities/c1', active: 'feed', counts: { today: 0, members: 3 } })));
  assert.doesNotMatch(zero, /Today<span/);
  assert.match(zero, /Members<span[^>]*>3<\/span>/);
});

/* ------------------------------------------------------------------ the exact figures (API bb263548, additive) */

test('the activity routes and hours degrade to nothing, the join is optimistic, and "Open now · closes 22:00" is only said with hours', async () => {
  const { hoursLine, optimisticJoin } = await import('../src/pages/GymCommunity.tsx');
  assert.equal(hoursLine({ open: true, closesAt: '22:00' }), 'Open now · closes 22:00');
  assert.equal(hoursLine({ open: false, opensAt: '6:00' }), 'Closed · opens 06:00');
  assert.equal(hoursLine({ open: true, closesAt: '22:00:00' }), 'Open now · closes 22:00');
  assert.equal(hoursLine({ open: true }), 'Open now');
  assert.equal(hoursLine({ open: false, opensAt: 'later' }), 'Closed now', 'an unreadable time is dropped, never guessed');
  assert.equal(hoursLine({ open: null }), null, 'no hours known: nothing said');
  assert.equal(hoursLine(null), null);
  assert.equal(hoursLine(undefined), null);
  // Join: a public community reads as joined at once, with one more member; approval reads as a request;
  // a second tap on a pending request reads as withdrawn. The server's answer replaces all of it.
  const open = optimisticJoin({ _id: 'c1', totalMembers: 4, settings: { isPublic: true } });
  assert.equal(open.status, 'member');
  assert.equal(open.community.totalMembers, 5);
  assert.equal(open.community.userMembership.status, 'member');
  const approval = optimisticJoin({ _id: 'c2', totalMembers: 4, settings: { isPublic: true, requireApproval: true } });
  assert.equal(approval.status, 'pending');
  assert.equal(approval.community.totalMembers, 4);
  const cancel = optimisticJoin({ _id: 'c3', totalMembers: 4, userMembership: { status: 'pending', requestId: 'r1' } });
  assert.equal(cancel.status, 'none');
  assert.equal(cancel.community.userMembership.isMember, false);
  assert.equal(optimisticJoin({ _id: 'c4', settings: { isPublic: true } }).community.totalMembers, undefined, 'no count is invented');

  const src = read('src/pages/GymCommunity.tsx');
  const detail = read('src/pages/CommunityDetail.tsx');
  const v2 = read('src/lib/gymCommunityV2.ts');
  // The three routes, called as the API mounts them. Their request paths moved
  // to lib/gymCommunityV2 with the rest of the gym page's fetchers (P7), so
  // each path has one home; the hooks that call them stay here.
  assert.match(v2, /api\.get\(`\/gyms\/community\/\$\{communityId\}\/active-this-week`\)/);
  assert.match(v2, /api\.get\(`\/gyms\/community\/\$\{communityId\}\/trained-today`, \{ params: \{ timeZone \} \}\)/, 'the local day is drawn in the device zone');
  assert.match(v2, /api\.get\(`\/gyms\/places\/\$\{encodeURIComponent\(placeId\)\}\/hours`, \{ params: \{ timeZone \} \}\)/);
  assert.match(src, /const resolvable = typeof placeId === 'string' && \/\^osm-\/\.test\(placeId\);/, 'only OpenStreetMap ids resolve, so nothing else is asked');
  // A 404 (an older API, a community the viewer may not see, a flag that is
  // off) and a 403 are both "this surface is not for you": one helper, used
  // by every additive read.
  assert.match(v2, /if \(status === 404 \|\| status === 403\) return null;/);
  assert.ok((src.match(/absentOnRefusal\(/g) || []).length >= 3, 'every additive route degrades to nothing');
  // The header: the profile variant, the exact week count as its third figure, the strip as its children, the review line once.
  assert.match(detail, /<GymHeader\s+variant="profile"/);
  assert.match(detail, /thisWeek: activeThisWeek\.data\?\.count/);
  assert.match(detail, /<GymTabs pathname=\{pathname\} active=\{tab\} counts=\{counts\} \/>\s*<\/GymHeader>/);
  assert.match(detail, /community\?\.reviewState === 'pending' \? <p className="t-meta[^"]*">Pending review<\/p> : null/);
  assert.equal((detail.match(/Pending review/g) || []).length, 1);
  // Today: the count is a number (names, then "and N others"); the leaderboard's "a few" string is only the 404 fallback.
  assert.match(detail, /fallbackLine=\{membership\.isMember \? trainingTodayLine\(todayLabel\) : null\}/);
  assert.match(detail, /rest === 1 \? '1 other' : `\$\{formatStat\(rest\)\} others`/);
  assert.match(detail, /figure\?\.timezoneSource === 'default'/, 'a UTC day is named as such');
  assert.match(detail, /if \(\(trainedToday\.data\?\.count \?\? 0\) > 0\) counts\.today = trainedToday\.data!\.count;/, 'a zero never reaches the strip');
  // Optimistic writes: Join and Check in each rewrite the cache first and put it back on error.
  assert.match(src, /onMutate: async \(gymId: string\) => \{[\s\S]*?optimisticJoin\(detail\)\.community/);
  assert.match(detail, /onMutate: async \(\) => \{[\s\S]*?withCheckIn\(old, actor\)/);
  assert.match(detail, /for \(const \[key, data\] of ctx\?\.prev \|\| \[\]\) qc\.setQueryData\(key, data\);/);
  // Hours live on About, in the Where card, and the map tile with them.
  assert.match(detail, /<WhereCard community=\{community\} hours=\{hoursLine\(hours\.data\)\} \/>/);
  // Today says it too (P7), so the read is enabled on both tabs that draw it.
  assert.match(detail, /const hours = usePlaceHours\(community\?\.placeId, tab === 'about' \|\| tab === 'today'\);/);
  assert.match(detail, /openNow=\{hoursLine\(hours\.data\)\}/);
  // No page still declares a band; the header action is a text button.
  for (const file of ['Gyms', 'GymCommunity', 'GymDetail', 'CommunityDetail', 'Friends', 'Discover']) {
    assert.doesNotMatch(read(`src/pages/${file}.tsx`), /band=\{\{/, `${file} declares no band`);
  }
  assert.match(read('src/pages/Gyms.tsx'), /<button type="button" className=\{TEXT_ACTION\} onClick=\{addAGym\}>\s*Add a gym/);
  assert.match(read('src/pages/GymDetail.tsx'), /<GymHeader\s+variant="profile"/);
});

/* ------------------------------------------------------------------ share links */

test('communities have their own share type and canonical route', () => {
  assert.ok(share.SHARE_TYPES.includes('community'));
  assert.equal(share.SHARE_LABEL.community, 'community');
  assert.equal(share.shareDestination('community', '6aad635402be1805f4b9ef72'), '/communities?community=6aad635402be1805f4b9ef72');
  assert.equal(gyms.communityPath('6aad635402be1805f4b9ef72'), '/communities?community=6aad635402be1805f4b9ef72');
  // Directory gyms keep their route: the live smoke expects type=gym -> /gyms.
  assert.equal(share.shareDestination('gym', 'gym1'), '/gyms?gym=gym1');
  assert.equal(share.shareDestination('community', '../admin'), null);
  // Newer app builds (mobile docs/deep-links.md, 2026-09-19) share four more kinds.
  assert.equal(share.shareDestination('workout-plan', '6aad635402be1805f4b9ef72'), '/workouts/plans/6aad635402be1805f4b9ef72');
  assert.equal(share.shareDestination('live', 'stream_1'), '/live/stream_1');
  assert.equal(share.shareDestination('challenge', '6aad635402be1805f4b9ef72'), '/challenges?open=6aad635402be1805f4b9ef72');
  assert.equal(share.shareDestination('hashtag', 'legday'), '/search?q=%23legday');
  assert.equal(share.shareDestination('hashtag', '#legday'), '/search?q=%23legday');
  assert.equal(share.shareDestination('hashtag', 'leg day'), null);
  for (const type of share.SHARE_TYPES) assert.ok(share.SHARE_LABEL[type], `label for ${type}`);
});

/* ------------------------------------------------------------------ source contracts */

test('the community detail acts on the real API shape and offers every member action', () => {
  // Gym First: /communities/:communityId is a route (CommunityDetail.tsx); the list, the create form and the
  // shared join/cover helpers stay in GymCommunity.tsx.
  const src = read('src/pages/GymCommunity.tsx');
  const detail = read('src/pages/CommunityDetail.tsx');
  assert.match(detail, /membershipOf\(community\)/, 'detail must derive membership from userMembership/isMember');
  assert.match(src, /membershipOf\(community\)/, 'cards derive membership the same way');
  for (const file of [src, detail]) assert.doesNotMatch(file, /community\.isMember\s*\?/, 'never branch on the bare isMember flag');
  // /communities?community=<id> (the app's share form) redirects to the route.
  assert.match(src, /params\.get\('community'\)/, '/communities?community=<id> must still land');
  assert.match(src, /<Navigate to=\{communityHref\(shared\)\} replace \/>/, 'the share form redirects to /communities/:id');
  assert.match(src, /export const communityHref = \(id: string\) => `\/communities\/\$\{encodeURIComponent\(id\)\}`;/);
  for (const label of ['Leave', 'Requests', 'Approve', 'Decline', 'Post to this community', 'Your request is pending', 'Transfer ownership', 'Remove from community', 'Make moderator']) {
    assert.ok(detail.includes(label), `missing UI text: ${label}`);
  }
  assert.ok(src.includes('Start a community'), 'missing UI text: Start a community');
  // Join / Request to join / Cancel request come from the shared label so the card and the detail never disagree.
  assert.match(src, /const label = joinLabel\(community\);/);
  assert.match(detail, /<JoinButton community=\{community\} mutation=\{join\} variant="primary" \/>/, 'the header action is the one primary control');
  // The member composer posts into the community and the create form hits the create route.
  assert.match(detail, /api\.post\('\/posts\/create',[\s\S]*?community: communityId,/);
  assert.match(src, /api\.post\('\/gyms\/community\/join',\s*body\)/);
  assert.match(detail, /api\.delete\(`\/gyms\/community\/\$\{communityId\}\/membership`\)/);
  assert.match(detail, /api\.patch\(`\/gyms\/community\/\$\{community\._id\}\/members\/\$\{userId\}\/role`/);
  assert.match(detail, /api\.delete\(`\/gyms\/community\/\$\{community\._id\}\/members\/\$\{userId\}`\)/);
  // Covers: photoReference through the shared resolver, gallery for extra photos.
  assert.match(src, /coverSourceOf\(community\)/);
  assert.match(src, /'\/gyms\/place-photo'/);
  assert.match(detail, /Community photos/);
  // Explore empty state distinguishes "joined everything" from "nothing exists".
  assert.match(src, /You have joined every community we could find/);
  for (const file of [src, detail]) assert.doesNotMatch(file, /add it to your community/, 'copy must not promise an action that does not exist');
  // Honest data (API.md §2, §10c): the band reads totalMembers (never stats.totalMembers from the details
  // payload), the rating only when real, "training today" only as the server's string, and the tabs are links.
  assert.match(detail, /memberCount: memberTotalOf\(c\)/);
  assert.match(src, /typeof c\?\.totalMembers === 'number' \? c\.totalMembers : c\?\.stats\?\.totalMembers/);
  assert.match(detail, /rating: typeof rating === 'number' && Number\.isFinite\(rating\) && rating > 0 \? rating : null/);
  assert.match(detail, /sessionsTodayLabel/);
  assert.doesNotMatch(detail, /activeMembers \?\? 0|activeMembers \|\| 0/, 'never a computed "0 training today"');
  assert.match(detail, /params: \{ week: 'this' \}/);
  assert.match(detail, /enabled: detail\.isSuccess && membership\.isMember,/, 'the leaderboard is members-only');
  assert.match(detail, /<Tabs\s+aria-label="Gym sections"\s+fill\s+active=\{active\}/, 'the strip is the shared Tabs, the page’s one tab row');
  assert.match(detail, /to: gymTabHref\(pathname, t\.key\),/, 'tabs stay links');
  // Home gym (API.md §1): PUT /users/settings { homeGym: { community } }, optimistic on the auth store.
  assert.match(detail, /api\.put\('\/users\/settings', \{ homeGym: \{ community: communityId \} \}\)/);
  assert.match(detail, /queryKey: \['home-gym'\]/);
  // Events carry the device zone (API.md §11b); the check-in board never computes its own week (§11c).
  assert.match(detail, /timezone: zoneOf\(\),/);
  assert.match(detail, /range\.timezoneSource !== 'community'/);
  // Create-from-place (API.md §10): look the place up first; on 409 with a placeId re-query and open the existing one.
  assert.match(src, /api\.get\(`\/gyms\/community\/place\/\$\{encodeURIComponent\(placeId!\)\}`\)/);
  assert.match(src, /if \(statusOf\(e\) === 409 && placeId\) \{/);
  assert.match(src, /\.\.\.\(vicinity \? \{ vicinity \} : \{\}\),/, 'vicinity travels verbatim');
});

test('the Gyms page keeps per-tab search, biases places, and lets people add gyms', () => {
  const src = read('src/pages/Gyms.tsx');
  assert.match(src, /const \[directorySearch, setDirectorySearch\]/);
  assert.match(src, /const \[placesSearch, setPlacesSearch\]/);
  assert.match(src, /placesSearch\.trim\(\) === debouncedPlaces && debouncedPlaces\.length > 0/, 'no provider call until the typed term settled');
  assert.match(src, /api\.get\('\/gyms\/place-search',\s*\{\s*params:\s*\{[^}]*kind:\s*'gym'/s);
  assert.match(src, /\.\.\.\(coords \? \{ lat: coords\.lat, lng: coords\.lng \} : \{\}\)/, 'place search must send the viewer position');
  assert.match(src, /api\.get\('\/gyms\/google-places'/, 'Nearby must list map-provider gyms');
  assert.match(src, /api\.post\('\/gyms\/add'/, 'Add to directory must create the gym');
  assert.match(src, /startCommunity: presetFromPlace\(place\)/);
  assert.match(src, /dedupeProviderPlaces\(results, gyms\)/);
  assert.match(src, /queryKey: \['gyms', 'provider-nearby'\]/, 'Update must drop the provider cache too');
  assert.match(src, /queryKey: \['gyms', 'nearby'\]/);
  assert.match(src, /q: debouncedDirectory \|\| undefined, sort \}/, 'directory requests carry the sort');
  assert.match(src, /Top rated/);
  // Page resets ride along with the change, not a trailing effect.
  assert.doesNotMatch(src, /useEffect\(\(\) => setPage\(1\)/);
  assert.match(src, /scrollToTop\(\)/);
  // Gym First: Places leads (the DB is empty; a place is how a gym comes to exist), every place row looks the
  // community up by placeId before offering Create, and OpenStreetMap is credited wherever its rows show.
  assert.match(src, /: 'places';/, 'Places is the default tab');
  // The search is the first element and follows the list under it; the page never links to itself.
  assert.ok(src.indexOf('<SearchField') < src.indexOf('<SegmentedControl'), 'the Places search sits above the segmented control');
  assert.match(src, /value=\{tab === 'all' \? directorySearch : placesSearch\}/);
  assert.doesNotMatch(src, /to="\/gyms"|to: '\/gyms'|to=\{`\/gyms`\}/, 'the Gyms page never links to itself');
  assert.doesNotMatch(src, /className="card/, 'boxed modules are <Card>, never a raw card class');
  assert.doesNotMatch(read('src/pages/GymCommunity.tsx'), /className="card/);
  assert.match(src, /const existing = useCommunityAtPlace\(placeId\);/);
  assert.match(src, /Start the community here/);
  assert.match(src, /openstreetmap\.org\/copyright/);
  assert.doesNotMatch(src, /google\.com\/maps/, 'map links go to OpenStreetMap');
  // Honest rows: no placeholder address, no "No ratings yet".
  assert.doesNotMatch(src, /'Address not listed'/);
  assert.doesNotMatch(src, /No ratings yet/);
  assert.match(src, /if \(!count \|\| !value\) return null;/);
  // Share links: /gyms?gym=<id> redirects to the gym route.
  assert.match(src, /params\.get\('gym'\)/);
  assert.match(src, /<Navigate to=\{`\/gyms\/\$\{encodeURIComponent\(sharedGym\)\}`\} replace \/>/);

  // The gym page (/gyms/:gymId): 404 state, community fallback, reviews only with a loaded gym, exact copy.
  const page = read('src/pages/GymDetail.tsx');
  assert.match(page, /This gym is no longer listed/);
  assert.match(page, /api\.get\(`\/gyms\/community\/\$\{gymId\}`\)/, 'a 404 gym id is checked against the community route');
  assert.match(page, /<Navigate to=\{communityHref\(communityFallback\.data\._id\)\} replace \/>/);
  assert.match(page, /const linked = useCommunityAtPlace\(gym\?\.placeId\);/, 'a directory gym renders the community at its place');
  assert.match(page, /aboutExtra=\{<GymReviews gym=\{gym\} \/>\}/, 'reviews wait for the detail and live on About');
  assert.match(page, /\{own \? 'Update review' : 'Post review'\}/);
  assert.match(page, /api\.delete\(`\/gyms\/\$\{gymId\}\/review`\)/);
  assert.match(page, /toast\.success\(data\?\.message \|\|/, 'the server message wins over a constant');
  assert.match(page, /rating: reviewCountOf\(g\) > 0 && rating > 0 \? rating : null/, 'the band gets a rating only when real');
  assert.doesNotMatch(page, /add it to your community/);
  // Single-page lists show no pager (shared Pager).
  assert.match(read('src/pages/GymCommunity.tsx'), /if \(page <= 1 && !hasNext\) return null;/, 'single-page lists show no pager');
});

test('sheets only start a drag from a finger and never from a control', () => {
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /if \(e\.pointerType !== 'touch'\) return;/);
  assert.match(ui, /closest\?\.\('button, a, input, textarea, select, \[role="button"\]'\)\) return;/);
  // Escape on an open menu must not reach the Modal's window listener.
  assert.match(ui, /case 'Escape':\s*case 'Tab':\s*e\.preventDefault\(\);[\s\S]{0,400}?e\.stopPropagation\(\);\s*setOpen\(false\);/);
});

test('the modal focus trap arms once the panel exists and only the top modal answers Escape', () => {
  const ui = read('src/components/ui.tsx');
  // usePresence mounts the panel one render after `open`; a trap armed on
  // `open` alone read a null ref and never re-ran (Tab escaped the sheet).
  assert.match(ui, /useFocusTrap\(open && mounted, panelRef, initialFocusRef\);/);
  // Nested dialogs: a ConfirmDialog over a sheet must not take both down.
  assert.match(ui, /const modalStack: symbol\[\] = \[\];/);
  assert.match(ui, /if \(!isTopmostModal\(stackToken\.current\)\) return;\s*e\.stopPropagation\(\);\s*onClose\(\);/);
  // Stack membership is keyed on `open` only, so a parent whose onClose
  // identity changes never leapfrogs the dialog open above it.
  assert.match(ui, /modalStack\.push\(mine\);[\s\S]{0,300}?\}, \[open\]\);/);
});

test('gym and community cards are links to their routes, not buttons', () => {
  // Gym First: a card is a <Card> with an overlay <Link> to /gyms/:id or /communities/:id (real, back-navigable
  // routes), so there is no <button> wrapping block content any more.
  const cardOf = (src, fnName) => {
    const start = src.indexOf(`function ${fnName}(`);
    assert.ok(start >= 0, `${fnName} exists`);
    const end = src.indexOf('\n}\n', start);
    return src.slice(start, end);
  };
  const gymCard = cardOf(read('src/pages/Gyms.tsx'), 'GymCard');
  assert.doesNotMatch(gymCard, /<button/, 'GymCard is a link card');
  assert.match(gymCard, /to=\{`\/gyms\/\$\{encodeURIComponent\(gym\._id\)\}`\}/);
  assert.match(gymCard, /<PlaceImage src=\{img \|\| null\} name=\{name\}/, 'the tokenised PlaceImage cover');
  const communityCard = cardOf(read('src/pages/GymCommunity.tsx'), 'CommunityCard');
  assert.doesNotMatch(communityCard, /<button/, 'CommunityCard is a link card');
  assert.match(communityCard, /to=\{communityHref\(community\._id\)\}/);
  assert.match(communityCard, /state=\{communityLinkState\(community, cover\)\}/, 'the band paints from the card before the fetch lands');
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /as: Tag = 'div',/);
  assert.match(ui, /as\?: 'div' \| 'span';/);
});

test('community posts say where they were posted', () => {
  const card = read('src/pages/PostCard.tsx');
  assert.match(card, /post\.community\?\._id/);
  assert.match(card, /\/communities\?community=\$\{encodeURIComponent\(post\.community\._id\)\}/);
  assert.match(card, /in \{post\.community\.name/);
});

test('the presigned owner upload mirrors the admin cover flow on the member client', () => {
  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /api\.post\('\/upload\/presign', \{ contentType, purpose: 'media', sizeBytes: file\.size \}\)/);
  assert.match(hooks, /export async function uploadOwnedMedia/);
});

test('every gym/community route the pages call is pinned in the backend snapshot', () => {
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'POST /api/gyms/add', 'GET /api/gyms', 'GET /api/gyms/google-places', 'GET /api/gyms/place-search', 'GET /api/gyms/place-photo',
    'GET /api/gyms/nearby', 'GET /api/gyms/:gymId', 'POST /api/gyms/:gymId/review', 'DELETE /api/gyms/:gymId/review', 'GET /api/gyms/:gymId/reviews',
    'POST /api/gyms/community/join', 'GET /api/gyms/community/:gymId/membership-requests',
    'POST /api/gyms/community/:gymId/membership-requests/:requestId/approve', 'DELETE /api/gyms/community/:gymId/membership-requests/:requestId',
    'PATCH /api/gyms/community/:gymId/members/:userId/role', 'DELETE /api/gyms/community/:gymId/members/:userId',
    'DELETE /api/gyms/community/:gymId/membership', 'GET /api/gyms/community/:gymId/members', 'GET /api/gyms/community/my-communities',
    'GET /api/gyms/community/explore', 'GET /api/gyms/community/:gymId', 'GET /api/posts/gym/community/posts/all/:communityId',
    // Gym First (API.md §2–§4, §10): the place lookup, the check-in board, check-ins and events.
    'GET /api/gyms/community/place/:placeId', 'GET /api/gyms/community/:gymId/leaderboard', 'POST /api/gyms/community/:gymId/check-ins',
    'GET /api/gyms/community/:communityId/events', 'POST /api/gyms/community/:communityId/events',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});
