/**
 * Source contracts for the rhythm, recap and insights surfaces (P6). Every
 * literal request path these surfaces send is listed here and checked against
 * contracts/backend-routes.json, because the audit script only recognises
 * `lib/api` imported from outside src/lib or as `./api` from inside it — and
 * a path written anywhere else would be invisible to both.
 *
 * The rest pins the decisions that make the package correct rather than
 * merely present: two independent feature detections per flagged surface, a
 * 404 FEATURE_DISABLED that renders nothing at all, a Home card that makes no
 * request until it has decided to exist, a fixed card geometry so the feed
 * never moves, and a score that is private to its owner.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const count = (source, re) => (source.match(re) || []).length;

const rhythmLib = read('src/lib/rhythm.ts');
const insightsLib = read('src/lib/insights.ts');
const card = read('src/pages/RhythmCard.tsx');
const feed = read('src/pages/Feed.tsx');
const progress = read('src/pages/WorkoutProgress.tsx');
const insightsCard = read('src/pages/progress/InsightsCard.tsx');
const trainingLoad = read('src/pages/progress/TrainingLoad.tsx');
const focusSheet = read('src/pages/progress/FocusSheet.tsx');
const score = read('src/components/VybeScore.tsx');
const profile = read('src/pages/Profile.tsx');
const userProfile = read('src/pages/UserProfile.tsx');
const recaps = read('src/pages/Recaps.tsx');
const recapDetail = read('src/pages/RecapDetail.tsx');
const snapshot = JSON.parse(read('contracts/backend-routes.json'));

/* ----------------------------------------------------------- request paths */

/** Every request this package makes, as written and as the backend mounts it. */
const REQUESTS = [
  // Weekly Rhythm (routes/rhythm.js). Ungated; the suggestion on it is not.
  { file: 'src/lib/rhythm.ts', method: 'GET', literal: "api.get<{ rhythm: RhythmView }>('/rhythm', { params: { weeks, ...zoneParams() } })", route: '/api/rhythm' },
  { file: 'src/lib/rhythm.ts', method: 'POST', literal: 'api.post<{ rhythm: RhythmView }>(`/rhythm/suggestion/${id}`, { action })', route: '/api/rhythm/suggestion/:id' },
  // Insights v2 + the H-8 weekly series ride the existing analytics payload.
  { file: 'src/lib/insights.ts', method: 'GET', literal: "'/health/analytics'", route: '/api/health/analytics' },
  // routes/me.js (flags focus / welcomeBack).
  { file: 'src/lib/insights.ts', method: 'GET', literal: "api.get<{ focus: Focus | null }>('/me/focus')", route: '/api/me/focus' },
  { file: 'src/lib/insights.ts', method: 'PUT', literal: "api.put<{ focus: Focus | null }>('/me/focus', body)", route: '/api/me/focus' },
  { file: 'src/lib/insights.ts', method: 'GET', literal: "api.get<{ welcomeBack: WelcomeBack | null }>('/me/welcome-back')", route: '/api/me/welcome-back' },
  { file: 'src/lib/insights.ts', method: 'POST', literal: "api.post('/me/welcome-back/ack', body)", route: '/api/me/welcome-back/ack' },
  // The Home card's unopened-recap row.
  { file: 'src/pages/RhythmCard.tsx', method: 'GET', literal: "api.get<{ recaps?: RecapListRow[] }>('/recaps', { params: { page: 1, limit: 5 } })", route: '/api/recaps' },
];

const source = { 'src/lib/rhythm.ts': rhythmLib, 'src/lib/insights.ts': insightsLib, 'src/pages/RhythmCard.tsx': card };

test('every request path is written as a literal and is a mounted backend route', () => {
  for (const request of REQUESTS) {
    assert.ok(source[request.file].includes(request.literal), `${request.file} must call ${request.literal}`);
    const mounted = snapshot.routes.find((r) => r.method === request.method && r.path === request.route);
    assert.ok(mounted, `${request.method} ${request.route} is not in contracts/backend-routes.json`);
  }
  // /rhythm/suggestion/:id must not be shadowed: the snapshot orders the nine
  // rhythm routes as routes/rhythm.js mounts them, and none is a wildcard.
  const rhythmRoutes = snapshot.routes.filter((r) => r.path === '/api/rhythm' || r.path.startsWith('/api/rhythm/'));
  assert.equal(rhythmRoutes.length, 9, 'routes/rhythm.js mounts nine routes');
  const order = (method, p) => snapshot.routes.find((r) => r.method === method && r.path === p)?.order;
  assert.ok(order('GET', '/api/rhythm/weeks') < order('GET', '/api/rhythm/of/:userId'));
  // One axios client, one place: nothing here builds an absolute URL or reaches for fetch.
  for (const [file, text] of Object.entries(source)) {
    assert.doesNotMatch(text, /\bfetch\(/, file);
    assert.doesNotMatch(text, /API_BASE|https?:\/\//, file);
  }
});

test('the routes this package does NOT call stay uncalled', () => {
  const all = rhythmLib + insightsLib + card + progress + insightsCard + trainingLoad + focusSheet + profile;
  // The target, the pause, the celebration ack and the weeks page belong to
  // surfaces this package does not own; the effort routes belong to the
  // session's Workout complete screen; insights-preferences has no UI here.
  for (const untouched of ['/rhythm/target', '/rhythm/pause', '/rhythm/celebrations', '/rhythm/weeks', '/rhythm/of/', '/me/insights-preferences', '/effort', '/buddies']) {
    assert.ok(!all.includes(`'${untouched}`) && !all.includes(`\`${untouched}`), `nothing here calls ${untouched}`);
  }
  // DELETE /api/me/focus exists and is deliberately not wired: the sheet sets
  // a value, it does not clear one, so no route is called that nothing drives.
  assert.ok(snapshot.routes.some((r) => r.method === 'DELETE' && r.path === '/api/me/focus'));
  assert.ok(!insightsLib.includes("api.delete('/me/focus')"));
});

/* --------------------------------------------------- feature detection x2 */

test('a flagged surface is detected twice: the capabilities flag and the route\'s own 404', () => {
  // The flag names, exactly as services/featureFlags.js seeds them.
  assert.match(card, /useFeatureGate\('insightsV2'\)/);
  assert.match(card, /useFeature\('rhythmSuggestions'\)/);
  assert.match(card, /useFeature\('welcomeBack'\)/);
  assert.match(progress, /useFeature\('insightsV2'\)/);
  assert.match(progress, /useFeature\('trainingLoad'\)/);
  assert.match(progress, /useFeature\('focus'\)/);
  assert.match(profile, /useFeature\('insightsV2'\)/);
  // The second detection: FEATURE_DISABLED is an answer, so no retry and no
  // error state — the surface is simply absent.
  assert.match(rhythmLib, /export function isFeatureDisabled\(e: unknown\): boolean/);
  assert.match(rhythmLib, /details\.status === 404 && details\.code === 'FEATURE_DISABLED'/);
  assert.match(card, /isFeatureDisabled\(welcome\.error\)/);
  assert.match(card, /isFeatureDisabled\(insights\.error\)/);
  assert.equal(count(card, /retry: false,/g), 4, 'every read in the card refuses to retry an answer');
  // Progress waits for the read to succeed, not merely to settle: a card that
  // drew a skeleton and then left on a 404 would close a hole under itself.
  assert.match(progress, /\{insightsOn && insights\.isSuccess \? \(/);
  assert.match(progress, /\{loadOn && insights\.isSuccess \? <TrainingLoad load=\{insights\.data\.trainingLoad\} \/> : null\}/);
  assert.match(progress, /focusEnabled=\{focusOn && focus\.isSuccess\}/);
  assert.doesNotMatch(progress, /<InsightsCard[\s\S]{0,300}?loading=/, 'no skeleton before the route has answered');
  assert.doesNotMatch(progress, /<TrainingLoad[^>]*loading=/, 'no skeleton before the route has answered');
  assert.match(profile, /if \(!enabled \|\| insights\.isError\) return null;/);
  // Never an ErrorState, never a Callout, never a retry button on any of them.
  for (const [name, text] of Object.entries({ card, insightsCard, trainingLoad, score })) {
    assert.doesNotMatch(text, /<ErrorState|Try again/, `${name} must not offer an error state`);
  }
  // A failed rhythm read leaves Home as it was.
  assert.match(card, /if \(rhythm\.isError\) return null;/);
});

test('with the flags off nothing is requested and nothing is drawn', () => {
  // The gate decides before any read starts, the way FirstWeekCard does.
  assert.match(card, /const enabled = gate\.enabled && !!user\?\._id && firstWeekOver;/);
  assert.equal(count(card, /\n    enabled,\n/g), 3, 'all three reads wait on the one decision');
  assert.match(card, /enabled: enabled && welcomeBackOn,/);
  assert.match(card, /if \(!enabled\) return null;/);
  // Nothing renders while /api/capabilities is undecided: a frame that
  // appeared and then left would shift the feed under it.
  assert.match(card, /useFeatureGate\('insightsV2'\)/);
  assert.doesNotMatch(card, /gate\.isPending \? </, 'no placeholder for an undecided flag');
  // The Progress reads wait on their flags too.
  assert.match(progress, /enabled: insightsOn \|\| loadOn,/);
  assert.match(progress, /enabled: focusOn,/);
  assert.match(profile, /const enabled = useFeature\('insightsV2'\);/);
});

/* ------------------------------------------------------------- Home slot */

test('Home mounts the rhythm card once, in the Get started card\'s slot', () => {
  assert.match(feed, /^import RhythmCard from '\.\/RhythmCard';$/m);
  assert.equal(count(feed, /<RhythmCard[^>]*\/>/g), 1);
  // Directly after FirstWeekCard: only one of the two is ever present, because
  // this one waits for that one's window to pass.
  assert.match(feed, /<FirstWeekCard className="my-4" \/>[\s\S]{0,200}?<RhythmCard className="my-4" \/>/);
  assert.match(card, /import \{ isWithinWindow, parseCreatedAt \} from '\.\.\/lib\/firstWeek';/);
  assert.match(card, /const firstWeekOver = createdAt === null \? true : !isWithinWindow\(createdAt, Date\.now\(\)\);/);
  // The rest of Home is untouched.
  assert.match(feed, /<GymHeader variant="compact" gym=\{home\.gym\} member=\{home\.member\} loading=\{home\.loading\}/);
  assert.match(feed, /aria-label="Loading your feed"/);
});

test('the card\'s geometry is fixed, so its skeleton is its exact height', () => {
  // Four rows, each a height the data cannot change: header, strip, line, slot.
  assert.match(card, /flex min-h-12 items-start justify-between/);
  assert.match(card, /className="mt-3 flex h-10 items-start"/);
  assert.match(card, /const SLOT = 'flex h-14 flex-col justify-center';/);
  assert.match(card, /className="grid grid-cols-7 gap-1\.5"/);
  // One secondary row at a time, in a fixed priority: the height never depends
  // on how many things are true at once.
  assert.match(card, /\) : welcomeBack \? \([\s\S]*?\) : suggestionText \? \([\s\S]*?\) : recap \? \([\s\S]*?\) : bank \? \(/);
  // Nothing animates the box.
  assert.doesNotMatch(card, /transition-\[height\]|animate-|style=\{\{ height/);
});

/* --------------------------------------------------------- the Vybe score */

test('the score is private: the owner\'s own surfaces and nowhere else', () => {
  // Three placements, all owner-only: Progress, the Home card, /profile.
  assert.match(progress, /<InsightsCard/);
  // On Progress the two cards sit beside the records shelf, where a late
  // insert moves nothing under them (the CLS the 390 px drive measures).
  assert.ok(progress.indexOf('<RecordsShelf') < progress.indexOf('<InsightsCard'));
  assert.ok(progress.indexOf('<InsightsCard') < progress.indexOf('<TrainingLoad load='));
  assert.match(card, /<VybeScoreMetric headline=\{headline\} size="compact"/);
  assert.match(profile, /<OwnVybeScoreRow \/>/);
  // Never on another member's profile, never on a card, never in a list.
  for (const [name, text] of Object.entries({
    userProfile,
    PostCard: read('src/pages/PostCard.tsx'),
    UserRow: read('src/pages/UserRow.tsx'),
    Discover: read('src/pages/Discover.tsx'),
    PeopleSearch: read('src/pages/PeopleSearch.tsx'),
    Challenges: read('src/pages/Challenges.tsx'),
    ProfileTabs: read('src/pages/ProfileTabs.tsx'),
    PublicPost: read('src/pages/PublicPost.tsx'),
  })) {
    assert.doesNotMatch(text, /VybeScore|insightsKeys|fetchInsights|insightsV2/, `${name} must not read another member's score`);
  }
  // The profile row waits for a real number: a calibrating score is the
  // owner's business on Progress, where the gap is spelled out.
  assert.match(profile, /if \(!headline \|\| headline\.calibrating\) return null;/);
  // And it opens the same About sheet the hub uses.
  assert.match(profile, /<VybeScoreAbout open=\{aboutOpen\}/);
  assert.match(progress, /<VybeScoreAbout open=\{aboutOpen\}/);
});

test('the score never carries a colour, a chain input or a praise word', () => {
  for (const [name, text] of Object.entries({ score, insightsCard, trainingLoad })) {
    // The band and the load label are text; semantic colour means something else.
    assert.doesNotMatch(text, /text-(success|danger|warning)|bg-(success|danger|warning)/, `${name}: no verdict colour`);
    assert.doesNotMatch(text, /TrendingUp|TrendingDown/, `${name}: no trend arrow`);
    // A contract test on the server greps its own module for a chain input; the
    // client must not smuggle one back in either.
    assert.doesNotMatch(text, /weeksKept|restTokens/, `${name}: the score has no chain input`);
  }
  // The comparison is the API's own `movedBy` and nothing else.
  assert.match(insightsCard, /movedHint\(score\)/);
  assert.match(insightsLib, /const moved = Array\.isArray\(score\?\.movedBy\) \? score\.movedBy\[0\] : null;/);
  assert.doesNotMatch(insightsCard, /delta=\{/, 'the hint is text, not a StatTile delta badge');
});

/* -------------------------------------------------------------- the year */

test('the year recap needs no new route, and the list renders whatever the API lists', () => {
  // Every year route already existed; only the kind is new.
  for (const route of ['/api/recaps', '/api/recaps/current', '/api/recaps/:id']) {
    assert.ok(snapshot.routes.some((r) => r.method === 'GET' && r.path === route), route);
  }
  // A locked year is not a row, like a locked month, so nothing asks for one.
  assert.doesNotMatch(recaps, /useCurrentRecap\('year'\)/);
  assert.equal(count(recaps, /useCurrentRecap\('(week|month)'\)/g), 2);
  assert.match(recaps, /lockedCopy\(recap\.data\.progress, recap\.kind\)/);
  assert.match(recapDetail, /const lockedShare = lockedShareMessage\(recap\.kind\);/);
  const body = read('src/pages/RecapBody.tsx');
  assert.match(body, /\{kind === 'year' \? \(/, 'one branch on the kind, nothing restructured');
  assert.match(body, /<RecapYearTotals recap=\{recap\} unit=\{unit\} \/>/);
  assert.match(body, /<RecapYearMonths recap=\{recap\} \/>/);
  assert.match(body, /lockedCopy\(data\.progress, kind\)/);
  // No chart library on this page: a grid of divs and nothing more.
  assert.doesNotMatch(body, /recharts|Recharts|<Sparkline/);
  assert.doesNotMatch(trainingLoad, /recharts|Recharts|<Sparkline/);
  // The share card accepts the third kind.
  assert.match(read('src/lib/recapSummary.ts'), /export type RecapKind = 'week' \| 'month' \| 'year';/);
  assert.match(read('src/lib/recapSummary.ts'), /if \(kind === 'year'\) return 'Year in Vybe';/);
});

/* ---------------------------------------------------------------- writes */

test('every write sends exactly the body its route documents', () => {
  // POST /api/rhythm/suggestion/:id { action }
  assert.match(rhythmLib, /export type SuggestionAction = 'accept' \| 'dismiss' \| 'not_now';/);
  assert.match(rhythmLib, /\{ action \}/);
  // POST /api/me/welcome-back/ack { id, action, countAsBreak? }
  assert.match(card, /action: offer\?\.action \?\? 'seen',/);
  assert.match(card, /\.\.\.\(offer\?\.countAsBreak \? \{ countAsBreak: true \} : \{\}\),/);
  assert.match(insightsLib, /export type WelcomeBackAction = 'seen' \| 'keep_target' \| 'lower_target' \| 'start_session' \| 'not_now';/);
  // PUT /api/me/focus { focus, eventDate? } -- eventDate only with `event`,
  // which the route refuses otherwise.
  assert.match(focusSheet, /const needsDate = kind === 'event';/);
  assert.match(focusSheet, /onSave\(\{ focus: kind, \.\.\.\(needsDate \? \{ eventDate \} : \{\}\) \}\)/);
  assert.match(focusSheet, /fieldError === 'eventDate' \? error : null/, 'the route names the field; the sentence lands under it');
  assert.match(focusSheet, /fieldError === 'focus' \? error : null/);
  // A write that changed what the server's rules read invalidates the reads.
  assert.match(progress, /void qc\.invalidateQueries\(\{ queryKey: insightsKeys\.all \}\);/);
  assert.match(card, /void qc\.invalidateQueries\(\{ queryKey: rhythmKeys\.all \}\);/);
});

test('the zone hints ride inside the fetchers, so the hub still sends two', () => {
  assert.match(rhythmLib, /const timezone = browserTimeZone\(\);/);
  assert.match(rhythmLib, /\.\.\.\(timezone \? \{ timezone \} : \{\}\), \.\.\.localDayParams\(\)/);
  assert.match(insightsLib, /params: \{ timeWindow: 'week', windows, \.\.\.localDayParams\(\) \},/);
  // The progression hub's own pin: summary and calendar, and nothing else.
  assert.equal(count(progress, /\.\.\.localDayParams\(\)/g), 2);
});
