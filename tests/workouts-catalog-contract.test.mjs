/**
 * Source contracts for the workouts-catalog fixes (qa8). Each block pins the
 * shape that made a finding reproducible so a refactor cannot quietly
 * reintroduce it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const workouts = read('src/pages/Workouts.tsx');
const detail = read('src/pages/WorkoutDetail.tsx');
const planDetail = read('src/pages/WorkoutPlanDetail.tsx');
const logs = read('src/pages/WorkoutLogs.tsx');
const challenges = read('src/pages/Challenges.tsx');
const achievements = read('src/pages/Achievements.tsx');
const settings = read('src/pages/Settings.tsx');
const search = read('src/pages/Search.tsx');
const notifications = read('src/pages/Notifications.tsx');
const ui = read('src/components/ui.tsx');
const app = read('src/App.tsx');

test('editing a workout saves through the full update route and waits for the echoed document', () => {
  // PATCH /workouts/:id was a privacy toggle that answered 200 and dropped every other field.
  assert.match(workouts, /api\.put<SaveEnvelope>\(`\/workouts\/update\/\$\{editing\._id\}`, payload\)/);
  assert.doesNotMatch(workouts, /api\.patch[^\n]*`\/workouts\/\$\{editing\._id\}`/);
  assert.match(workouts, /The server did not confirm the save/);
  assert.match(workouts, /saved\.title !== payload\.title/);
  // Plans edit through their own full update route.
  assert.match(workouts, /api\.put<PlanEnvelope>\(`\/workouts\/update-plan\/\$\{editing\._id\}`, payload\)/);
});

test('exercise durations are seconds on screen and in the editor', () => {
  assert.match(workouts, /label="Seconds"/);
  assert.doesNotMatch(workouts, /label="Minutes"/);
  assert.match(detail, /secondsParts\(ex\.duration\)/);
  assert.doesNotMatch(detail, /formatStat\(ex\.duration\), 'min'/);
  assert.match(logs, /formatSeconds\(ex\.duration\)/);
  assert.doesNotMatch(logs, /\$\{formatStat\(ex\.duration\)\} min/);
});

test('plans have an editor: schedule, remove, edit, delete, and a canonical route', () => {
  assert.match(app, /path=["']workouts\/plans\/:planId["']/);
  assert.match(app, /import\('\.\/pages\/WorkoutPlanDetail'\)/);
  assert.match(workouts, /`\/workouts\/plans\/add-workout\/\$\{planId\}`/);
  assert.match(planDetail, /`\/workouts\/plans\/\$\{planId\}\/workouts\/\$\{workoutId\}`/);
  assert.match(planDetail, /label=\{`Remove \$\{entry\.workout\?\.title \?\? 'session'\} from week/);
  assert.match(workouts, /const href = `\/workouts\/plans\/\$\{plan\._id\}`/);
  assert.match(workouts, /label: 'Add workout'/);
  assert.match(workouts, /label: 'Add to plan'/);
  assert.match(detail, /label: 'Add to plan'/);
  assert.match(workouts, /api\.delete\(`\/workouts\/plan\/\$\{plan\._id\}`\)/);
  // Legacy /workouts/<planId> links land on the canonical plan page.
  assert.match(detail, /<Navigate to=\{`\/workouts\/plans\/\$\{plan\.data\._id\}`\} replace \/>/);
  assert.match(planDetail, /humanize\(plan\.level\)/);
  // A program card with sessions stays openable: the title links, and so does "View schedule".
  assert.match(workouts, /aria-label=\{`View schedule for \$\{plan\.title\}`\}/);
  assert.match(workouts, /<Link to=\{href\} viewTransition className="relative z-\[2\][^"]*">\s*\{plan\.title\}/);
});

test('premade and community programs are browsable and lists page', () => {
  assert.match(workouts, /'\/workouts\/commom\/workouts\/plan\/all\/premade\/fetch'/);
  assert.match(workouts, /'\/workouts\/plans\/filter\/all\/workouts\/feed\/filter\/feed'/);
  assert.match(workouts, /\{ key: 'programs', label: 'Programs'/);
  assert.match(workouts, /useInfiniteQuery\(/);
  assert.match(workouts, /Load more/);
});

test('workouts can carry a cover photo uploaded through the owned-media route', () => {
  assert.match(workouts, /uploadImage\(file, 'posts'\)/);
  assert.match(workouts, /payload\.image = \{ uri: form\.imageKey \}/);
  assert.match(workouts, /payload\.image = null/);
});

test('workout comments can be deleted and timestamps use the compact style', () => {
  assert.match(detail, /api\.delete\(`\/workouts\/interaction\/\$\{workoutId\}\/comment\/\$\{c\._id\}`\)/);
  assert.match(detail, /label=\{`Delete comment by \$\{name\}`\}/);
  assert.match(detail, /timeAgo\(value\)/);
  assert.doesNotMatch(detail, /formatDistanceToNow/);
  // Hashtag chips search workouts, not the post index.
  assert.match(detail, /\/search\?q=\$\{encodeURIComponent\(`#\$\{tag\}`\)\}&type=workouts/);
});

test('challenge copy: readable time, named custom units, honest delete, closed items kept', () => {
  assert.match(challenges, /from '\.\.\/lib\/challengeFormat'/);
  assert.match(challenges, /formatChallengeWindow\(challenge\.startDate, challenge\.endDate\)/);
  assert.match(challenges, /remainingLabel\(challenge\.endDate\)/);
  assert.doesNotMatch(challenges, /formatStat\(stats\.data\.timeRemaining\)/);
  assert.doesNotMatch(challenges, /humanize\(challenge\.goalUnit\)/);
  assert.match(challenges, /goalUnitLabel/);
  assert.match(challenges, /label="Unit name"/);
  assert.match(challenges, /const setField = /);
  assert.match(challenges, /onChange=\{\(e\) => setField\('endDate', e\.target\.value\)\}/);
  assert.match(challenges, /key: 'challenge-validation'/);
  assert.match(challenges, /api\.get<ChallengeListResponse>\('\/challenges\/created'\)/);
  assert.match(challenges, /closed \? 'Challenge closed/);
  // A joined challenge can only be closed (the API keeps it), and a closed one has no owner actions left.
  assert.match(challenges, /isOwner && !archived \? \(/);
  assert.match(challenges, /hasParticipants \? 'Close challenge' : 'Delete'/);
  assert.match(challenges, /pendingHasParticipants \? 'Close challenge' : 'Delete challenge'/);
  // "Synced: 1 workout logged", "1 workout to go" — never "1 workouts".
  assert.match(challenges, /pluralUnit\(unit, progress\)/);
  assert.match(challenges, /pluralUnit\(unit, left\)/);
});

test('achievement tiles read from the always-loaded personal set, and progress never exceeds the target', () => {
  assert.match(achievements, /queryKey: \['achievements', 'user', 'summary'\]/);
  assert.match(achievements, /unit=\{`of \$\{summary\.length\}`\}/);
  assert.doesNotMatch(achievements, /unit=\{`of \$\{items\.length\}`\}/);
  assert.match(achievements, /const shown = Math\.min\(current, required\)/);
  assert.match(achievements, /formatStat\(Math\.min\(data\.current, data\.required\)\)/);
});

test('web members can apply to coach from Settings, with the mobile field list', () => {
  assert.match(settings, /api\.post<[^>]*>\('\/auth\/becomeTrainer'/);
  assert.match(settings, /api\.get<TrainerApplicationResponse>\('\/auth\/trainer-application'\)/);
  assert.match(settings, /id="coaching"/);
  assert.match(settings, /TRAINER_FIELDS/);
  assert.match(settings, /Apply to coach/);
  assert.match(read('src/pages/Discover.tsx'), /to="\/settings#coaching"/);
  assert.match(read('src/pages/UserRow.tsx'), /Coaching specialties/);
});

test('search indexes workouts and notifications link workout events to the workout', () => {
  assert.match(search, /\{ key: 'workouts', label: 'Workouts' \}/);
  assert.match(search, /results\?\.workouts/);
  assert.match(notifications, /from '\.\.\/lib\/notificationRoutes'/);
  assert.match(notifications, /workout_like: \{ icon/);
  assert.match(read('src/components/Layout.tsx'), /placeholder="Search people, posts, workouts…"/);
});

test('toasts never cover a sheet footer on phones and validation toasts do not stack', () => {
  assert.match(ui, /toastViewportClass\(compact, modalOpen\)/);
  assert.match(ui, /export const useModalPresence/);
  assert.match(ui, /upsertToast\(list, \{/);
});

test('the compare panel treats a missing measurement as unknown', () => {
  const photos = read('src/pages/ProgressPhotos.tsx');
  assert.match(photos, /raw != null && Number\.isFinite\(Number\(raw\)\)/);
});

test('the live suites keep their labels and routes', () => {
  assert.match(workouts, /label=\{`More options for \$\{workout\.title\}`\}/);
  assert.match(workouts, /label=\{`More options for \$\{plan\.title\}`\}/);
  assert.match(workouts, /aria-label="Workout library"/);
  assert.match(workouts, /New workout/);
  assert.match(workouts, /New plan/);
  assert.match(detail, /Log this workout/);
  assert.match(detail, /label=\{`More options for \$\{title\}`\}/);
  assert.match(app, /path=["']workouts\/:workoutId["']/);
  assert.match(app, /path=["']workouts\/logs["']/);
});

test('the backend route snapshot pins every route the catalog fixes call', () => {
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'PUT /api/workouts/update/:id',
    'PUT /api/workouts/update-plan/:id',
    'PUT /api/workouts/plans/add-workout/:planId',
    'DELETE /api/workouts/plans/:planId/workouts/:workoutId',
    'GET /api/workouts/commom/workouts/plan/all/premade/fetch',
    'GET /api/workouts/plans/filter/all/workouts/feed/filter/feed',
    'DELETE /api/workouts/interaction/:workoutId/comment/:commentId',
    'GET /api/challenges/created',
    'GET /api/challenges/:challengeId/stats',
    'POST /api/auth/becomeTrainer',
    'GET /api/auth/trainer-application',
    'GET /api/search',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});
