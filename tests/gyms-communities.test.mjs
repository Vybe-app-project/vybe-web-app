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

/* ------------------------------------------------------------------ share links */

test('communities have their own share type and canonical route', () => {
  assert.ok(share.SHARE_TYPES.includes('community'));
  assert.equal(share.SHARE_LABEL.community, 'community');
  assert.equal(share.shareDestination('community', '6aad635402be1805f4b9ef72'), '/communities?community=6aad635402be1805f4b9ef72');
  assert.equal(gyms.communityPath('6aad635402be1805f4b9ef72'), '/communities?community=6aad635402be1805f4b9ef72');
  // Directory gyms keep their route: the live smoke expects type=gym -> /gyms.
  assert.equal(share.shareDestination('gym', 'gym1'), '/gyms?gym=gym1');
  assert.equal(share.shareDestination('community', '../admin'), null);
});

/* ------------------------------------------------------------------ source contracts */

test('the community detail acts on the real API shape and offers every member action', () => {
  const src = read('src/pages/GymCommunity.tsx');
  assert.match(src, /membershipOf\(community\)/, 'detail must derive membership from userMembership/isMember');
  assert.doesNotMatch(src, /community\.isMember\s*\?/, 'never branch on the bare isMember flag');
  assert.match(src, /params\.get\('community'\)/, '/communities?community=<id> must open the detail');
  assert.match(src, /next\.delete\('community'\)/, 'closing the detail must drop the parameter');
  for (const label of ['Leave', 'Requests', 'Approve', 'Decline', 'Post to this community', 'Start a community', 'Your request is pending', 'Transfer ownership', 'Remove from community', 'Make moderator']) {
    assert.ok(src.includes(label), `missing UI text: ${label}`);
  }
  // Join / Request to join / Cancel request come from the shared label so the card and the detail never disagree.
  assert.match(src, /const label = joinLabel\(community\);/);
  // The member composer posts into the community and the create form hits the create route.
  assert.match(src, /api\.post\('\/posts\/create',[\s\S]*?community: communityId,/);
  assert.match(src, /api\.post\('\/gyms\/community\/join',\s*body\)/);
  assert.match(src, /api\.delete\(`\/gyms\/community\/\$\{communityId\}\/membership`\)/);
  assert.match(src, /api\.patch\(`\/gyms\/community\/\$\{community\._id\}\/members\/\$\{userId\}\/role`/);
  assert.match(src, /api\.delete\(`\/gyms\/community\/\$\{community\._id\}\/members\/\$\{userId\}`\)/);
  // Covers: photoReference through the shared resolver, gallery for extra photos.
  assert.match(src, /coverSourceOf\(community\)/);
  assert.match(src, /'\/gyms\/place-photo'/);
  assert.match(src, /Community photos/);
  // Explore empty state distinguishes "joined everything" from "nothing exists".
  assert.match(src, /You have joined every community we could find/);
  assert.doesNotMatch(src, /add it to your community/, 'copy must not promise an action that does not exist');
});

test('the Gyms page keeps per-tab search, biases places, and lets people add gyms', () => {
  const src = read('src/pages/Gyms.tsx');
  assert.match(src, /const \[directorySearch, setDirectorySearch\]/);
  assert.match(src, /const \[placesSearch, setPlacesSearch\]/);
  assert.match(src, /placesSearch\.trim\(\) === debouncedPlaces && debouncedPlaces\.length > 0/, 'no provider call until the typed term settled');
  assert.match(src, /api\.get\('\/gyms\/place-search',\s*\{\s*params:\s*\{[^}]*kind:\s*'gym'/s);
  assert.match(src, /\.\.\.\(coords \? \{ lat: coords\.lat, lng: coords\.lng \} : \{\}\)/, 'place search must send the viewer position');
  assert.match(src, /api\.get\('\/gyms\/google-places'/, 'Nearby must list map-provider gyms');
  assert.match(src, /api\.post\('\/gyms\/add'/, 'Add to Vybe must create the gym');
  assert.match(src, /startCommunity: presetFromPlace\(place\)/);
  assert.match(src, /dedupeProviderPlaces\(results, gyms\)/);
  assert.match(src, /queryKey: \['gyms', 'provider-nearby'\]/, 'Update must drop the provider cache too');
  assert.match(src, /queryKey: \['gyms', 'nearby'\]/);
  assert.match(src, /q: debouncedDirectory \|\| undefined, sort \}/, 'directory requests carry the sort');
  assert.match(src, /Top rated/);
  // Page resets ride along with the change, not a trailing effect.
  assert.doesNotMatch(src, /useEffect\(\(\) => setPage\(1\)/);
  assert.match(src, /scrollToTop\(\)/);
  // Detail: 404 state, community fallback, review ownership, exact pager.
  assert.match(src, /This gym is no longer listed/);
  assert.match(src, /api\.get\(`\/gyms\/community\/\$\{gymId\}`\)/, 'a 404 gym id is checked against the community route');
  assert.match(src, /enabled: Boolean\(gymId\) && detail\.isSuccess/, 'reviews wait for the detail');
  assert.match(src, /\{own \? 'Update review' : 'Post review'\}/);
  assert.match(src, /api\.delete\(`\/gyms\/\$\{gymId\}\/review`\)/);
  assert.match(src, /toast\.success\(data\?\.message \|\|/, 'the server message wins over a constant');
  assert.match(src, /if \(page <= 1 && !hasNext\) return null;/, 'single-page lists show no pager');
  assert.match(src, /'Address not listed'/);
  assert.doesNotMatch(src, /add it to your community/);
});

test('sheets only start a drag from a finger and never from a control', () => {
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /if \(e\.pointerType !== 'touch'\) return;/);
  assert.match(ui, /closest\?\.\('button, a, input, textarea, select, \[role="button"\]'\)\) return;/);
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
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});
