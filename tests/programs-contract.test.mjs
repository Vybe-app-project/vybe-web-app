import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const api = read('src/lib/programs.ts');
const planDetail = read('src/pages/WorkoutPlanDetail.tsx');
const hub = read('src/pages/Workouts.tsx');
const workoutDetail = read('src/pages/WorkoutDetail.tsx');
const finish = read('src/pages/workouts/session/Finish.tsx');
const runner = read('src/pages/workouts/session/Runner.tsx');
const sheet = read('src/pages/workouts/sheet.ts');
const continueSrc = read('src/pages/workouts/continue.ts');
const foldersSrc = read('src/pages/workouts/folders.tsx');
const snapshot = JSON.parse(read('contracts/backend-routes.json'));

/**
 * Programmes, routine folders and share links against the backend route
 * snapshot (v2-be-programs-routines). Every request the package makes is
 * written as a literal at its call site, so `scripts/audit-api-contracts.cjs`
 * can resolve it statically; this file is the second half of that promise —
 * it names the mounted route each literal is meant to reach, so a rename on
 * either side is a failing test rather than a 404 in production.
 */

/* ----------------------------------------------------------- request paths */

/** Every request src/lib/programs.ts makes, as written and as the backend mounts it. */
const REQUESTS = [
  { method: 'GET', literal: 'api.get<EnrollmentView>(`/plans/${planId}/enrollment`)', route: '/api/plans/:id/enrollment' },
  { method: 'POST', literal: 'api.post<EnrollmentView>(`/plans/${planId}/enroll`', route: '/api/plans/:id/enroll' },
  { method: 'PATCH', literal: 'api.patch<PatchResult>(`/plans/${planId}/enrollment`', route: '/api/plans/:id/enrollment' },
  { method: 'POST', literal: 'api.post<SessionMarkResult>(`/plans/${planId}/enrollment/sessions`', route: '/api/plans/:id/enrollment/sessions' },
  { method: 'DELETE', literal: 'api.delete<SessionChangeResult>(`/plans/${planId}/enrollment/sessions/${slot.week}/${slot.day}/${slot.order}`', route: '/api/plans/:id/enrollment/sessions/:week/:day/:order' },
  { method: 'POST', literal: 'api.post<SessionChangeResult>(`/plans/${planId}/enrollment/skip`', route: '/api/plans/:id/enrollment/skip' },
  { method: 'DELETE', literal: 'api.delete<SessionChangeResult>(`/plans/${planId}/enrollment/skip/${slot.week}/${slot.day}/${slot.order}`', route: '/api/plans/:id/enrollment/skip/:week/:day/:order' },
  { method: 'POST', literal: '(`/plans/${planId}/enrollment/complete`, { clientRequestId })', route: '/api/plans/:id/enrollment/complete' },
  { method: 'DELETE', literal: '(`/plans/${planId}/enrollment/complete`, { data: { clientRequestId } })', route: '/api/plans/:id/enrollment/complete' },
  { method: 'GET', literal: "api.get<EnrollmentList>('/plans/enrollments'", route: '/api/plans/enrollments' },
  { method: 'GET', literal: "api.get<FolderList>('/routines/folders')", route: '/api/routines/folders' },
  { method: 'POST', literal: "api.post<{ folder?: RoutineFolder }>('/routines/folders'", route: '/api/routines/folders' },
  { method: 'PATCH', literal: 'api.patch<{ folder?: RoutineFolder }>(`/routines/folders/${folderId}`', route: '/api/routines/folders/:folderId' },
  { method: 'DELETE', literal: 'api.delete<{ moved?: number }>(`/routines/folders/${folderId}`)', route: '/api/routines/folders/:folderId' },
  { method: 'PATCH', literal: 'api.patch(`/routines/${routineId}/folder`, { folderId })', route: '/api/routines/:id/folder' },
  { method: 'POST', literal: 'api.post<ShareLink>(`/routines/${routineId}/share-link`)', route: '/api/routines/:id/share-link' },
  { method: 'DELETE', literal: 'api.delete<{ revoked?: number }>(`/routines/${routineId}/share-link`)', route: '/api/routines/:id/share-link' },
  { method: 'GET', literal: 'api.get<LinkStats>(`/routines/${routineId}/links`)', route: '/api/routines/:id/links' },
];

test('every programme request is written as a literal and is a mounted backend route', () => {
  for (const { method, literal, route } of REQUESTS) {
    assert.ok(api.includes(literal), `src/lib/programs.ts must call ${literal}`);
    const mounted = snapshot.routes.find((r) => r.method === method && r.path === route);
    assert.ok(mounted, `${method} ${route} is not in contracts/backend-routes.json`);
  }
  // One axios client, one place: nothing here builds an absolute URL or reaches for fetch.
  assert.doesNotMatch(api, /\bfetch\(/);
  assert.doesNotMatch(api, /API_BASE|https?:\/\//);
});

test('the literal-segment routes are mounted ahead of the :id routes that would swallow them', () => {
  const order = (method, p) => snapshot.routes.find((r) => r.method === method && r.path === p)?.order;
  assert.ok(order('GET', '/api/plans/enrollments') < order('POST', '/api/plans/:id/enroll'));
  assert.ok(order('GET', '/api/routines/folders') < order('POST', '/api/routines/:id/share-link'));
  assert.ok(order('GET', '/api/routines/folders') < order('PATCH', '/api/routines/:id/folder'));
});

test('the enrolment router carries no route this package needs and cannot reach', () => {
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'GET /api/plans/enrollments',
    'POST /api/plans/:id/enroll',
    'GET /api/plans/:id/enrollment',
    'PATCH /api/plans/:id/enrollment',
    'POST /api/plans/:id/enrollment/sessions',
    'DELETE /api/plans/:id/enrollment/sessions/:week/:day/:order',
    'POST /api/plans/:id/enrollment/skip',
    'DELETE /api/plans/:id/enrollment/skip/:week/:day/:order',
    'POST /api/plans/:id/enrollment/complete',
    'DELETE /api/plans/:id/enrollment/complete',
    'GET /api/routines/folders',
    'POST /api/routines/folders',
    'PATCH /api/routines/folders/:folderId',
    'DELETE /api/routines/folders/:folderId',
    'PATCH /api/routines/:id/folder',
    'POST /api/routines/:id/share-link',
    'DELETE /api/routines/:id/share-link',
    'GET /api/routines/:id/links',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

/* ------------------------------------------------------------ the bodies */

test('the bodies are exactly what the contract takes: Monday, the server’s own clock, one key per write', () => {
  // weekStartsOn: 1 is sent explicitly (the contract's default, pinned here so
  // a server-side change cannot move a member's first week under them), and
  // weekAnchor is deliberately absent: the server anchors to the current week
  // on the account's timezone, which a browser must not second-guess.
  assert.match(api, /`\/plans\/\$\{planId\}\/enroll`, \{ clientRequestId, weekStartsOn: 1 \}/);
  assert.doesNotMatch(api, /enroll`, \{[^}]*weekAnchor/);
  // Pause / resume / leave and "Shift schedule" are the same PATCH.
  assert.match(api, /export type EnrollmentPatch = \{ status\?: 'active' \| 'paused' \| 'left'; weekAnchor\?: string \}/);
  // A mark names the slot and, when the runner produced one, the log it came from.
  assert.match(api, /export type MarkSessionInput = \{\s*week: number;\s*day: number;\s*order: number;/);
  assert.match(api, /workoutLogId\?: string;/);
  assert.match(api, /workoutLogClientRequestId\?: string;/);
  assert.match(api, /source\?: 'log' \| 'manual';/);
  // Every keyed write defaults its own id; a DELETE carries it in the body.
  assert.equal((api.match(/clientRequestId: string = requestId\(\)/g) || []).length, 8, 'every keyed write takes a reusable id');
  assert.equal((api.match(/data: \{ clientRequestId \}/g) || []).length, 3, 'the three DELETEs key in the body');
  // services/clientRequests.js: 16 to 100 letters, digits, underscores or dashes.
  assert.match(api, /crypto\.randomUUID/);
  assert.match(api, /id\.slice\(0, 100\)/);
});

test('"Shift schedule to this week" sends a local calendar date, never a UTC instant', () => {
  assert.match(api, /export function dateKey\(date: Date\): string/);
  assert.match(api, /date\.getFullYear\(\)/);
  assert.doesNotMatch(api, /toISOString\(\)\.slice/);
  assert.match(planDetail, /weekAnchor: shiftAnchor\(view\.pointer\?\.week \?\? 1\)/);
});

/* ------------------------------------------------------- the feature gates */

test('every programme surface is feature-detected, so a flag-off server shows no error and no gap', () => {
  // The gate before the request…
  assert.match(api, /export function programsFeature\(\): ProgramsFeature/);
  assert.match(api, /useFeatureGate\('programs'\)/);
  assert.match(api, /useFeatureGate\('routineShareLinks'\)/);
  // …and the safety net after one.
  assert.match(api, /export function isFeatureDisabled\(error: unknown\): boolean/);
  assert.match(api, /code === 'FEATURE_DISABLED'/);
  assert.match(api, /retry: \(count, error\) => !isFeatureDisabled\(error\) && count < 2/);

  // The plan page: no card while the flag is off, and the schedule stays.
  assert.match(planDetail, /const \{ programs: programsOn \} = programsFeature\(\);/);
  assert.match(planDetail, /const showEnrolment = programsOn && !enrolment\.isError;/);
  assert.match(planDetail, /\{showEnrolment \? \(/);
  // The hub's folders and the routine's share link, each behind their own flag.
  assert.match(hub, /const folders = useRoutineFolders\(tab === 'mine'\);/);
  assert.match(hub, /\.\.\.\(folders\.data \? \[\{ label: 'Move to folder…'/);
  assert.match(workoutDetail, /const \{ shareLinks: shareLinksOn \} = programsFeature\(\);/);
  assert.match(workoutDetail, /\.\.\.\(isOwn && shareLinksOn \? \[\{ label: 'Share link'/);
});

test('the two Wave G flags are in the admin registry under G-3, so they can be flipped from /admin/flags', () => {
  const flags = read('src/lib/adminFlags.ts');
  assert.match(flags, /\{ name: 'programs', group: 'G-3'/);
  assert.match(flags, /\{ name: 'routineShareLinks', group: 'G-3'/);
});

/* -------------------------------------------------------------- the loop */

test('the slot travels from a plan row, through the runner, to the mark on the recap', () => {
  // The URL the plan page's next-up Start opens.
  assert.match(sheet, /export function programSlotFromParams\(params: URLSearchParams\): ProgramSlotParam \| null/);
  assert.match(planDetail, /TRAIN\.liveSession\(\{ from: nextRow\.workoutId, program: \{ planId: plan\._id, week: nextRow\.week, day: nextRow\.day, order: nextRow\.order \} \}\)/);
  // The runner reads it and puts it on the session, where the draft keeps it.
  assert.match(runner, /const program = useMemo\(\(\) => programSlotFromParams\(params\), \[params\]\);/);
  assert.match(read('src/pages/workouts/session/math.ts'), /program: seed\?\.program \?\? null,/);
  // The recap marks it, after the log and never instead of it.
  assert.match(finish, /const slot = session\.program \?\? null;/);
  assert.match(finish, /markSession\(slot\.planId, \{/);
  assert.match(finish, /source: 'log',/);
  assert.match(finish, /workoutLogId: logId/);
  assert.match(finish, /keyedLogs \? \{ workoutLogClientRequestId: logKey \} : \{\}/);
  assert.match(finish, /if \(!isFeatureDisabled\(e\)\) toast\.error\(e, 'The session is saved\. It was not counted toward the plan\.'\)/);
  // One line on the recap, with an Undo beside it — a text action, not a button.
  assert.match(finish, /export function countedLine\(/);
  assert.match(finish, /`Counted toward \$\{planTitle \|\| 'your plan'\} · Week \$\{slot\.week\} · Day \$\{slot\.day\}`/);
  assert.match(finish, /unmarkSession\(done\.program\.planId, done\.program\)/);
  assert.match(finish, /\$\{ROW_ACTION\} ml-auto`[\s\S]{0,140}Undo/);
  assert.ok(!/variant="primary"/.test(finish), 'the form’s Log session stays the recap screen’s one filled brand');
  // "Plan complete — {next.title} is next" only when the API names one.
  assert.match(finish, /next\?\.title \? `Plan complete — \$\{next\.title\} is next` : 'Plan complete'/);
});

test('the hub reads one enrolments query and the Continue button carries the slot', () => {
  assert.match(continueSrc, /export const ENROLLMENT_STATUSES = 'active,paused,completed';/);
  assert.match(continueSrc, /export function continueProgramOf\(items: readonly EnrollmentListItem\[\]\): ContinueProgram \| null/);
  assert.match(continueSrc, /item\.enrollment\?\.status === 'active'/);
  assert.match(continueSrc, /TRAIN\.liveSession\(\{ from: pointer\.workoutId, program \}\)/);
  assert.match(hub, /\? \{ label: continueProgram\.label, to: continueProgram\.to \}/);
  assert.match(hub, /extra=\{\[enrolledMeta\(enrolments\.byPlan\.get\(plan\._id\)\)\]\}/);
});

/* ---------------------------------------------------------------- the copy */

test('nothing on these surfaces punishes a member for a day they did not train', () => {
  const surfaces = [read('src/pages/workouts/enrolment.tsx'), foldersSrc, api, continueSrc];
  // services/programsCopy.js bans these server-side; the client keeps the same
  // vocabulary, so the two halves of the feature never contradict each other.
  for (const source of surfaces) {
    const prose = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of [/\bmissed\b/i, /\bbehind\b/i, /\blocked\b/i, /\bstreak\b/i, /\bresets?\b/i]) {
      assert.doesNotMatch(prose, banned, `${banned} has no place in the programme copy`);
    }
    assert.doesNotMatch(prose.replace(/[^\n]*aria-label[^\n]*/g, ''), /!['"<]/, 'no exclamation marks');
  }
  // Curly quotes: a straight apostrophe between two letters can only be a
  // contraction inside a string, and the register does not use one.
  assert.ok(foldersSrc.includes('Weights aren’t included.'));
  for (const source of surfaces) {
    const prose = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(prose, /[a-z]'[a-z]/i, 'the register uses curly apostrophes');
  }
});
