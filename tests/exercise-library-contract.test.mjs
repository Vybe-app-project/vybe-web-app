/**
 * Source contracts for the exercise library package (P2). Every literal
 * request path the web client sends for the library is listed here and
 * checked against contracts/backend-routes.json — the audit script's client
 * detection only recognises `lib/api` imported from outside src/lib, so a
 * fetcher module that sits beside api.ts is invisible to it and this is what
 * holds those paths.
 *
 * The rest pins the decisions that make the package correct rather than
 * merely present: the 200 ms debounce the 300-per-15-minutes search limit
 * needs, the 404/empty-meta feature detection instead of an error state, the
 * slug written as `exerciseId` so records and history find the same lift,
 * immutable media URLs used as sent, and the zero rule on the page.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const api = read('src/lib/exerciseLibrary.ts');
const pickerSrc = read('src/pages/workouts/ExercisePicker.tsx');
const draft = read('src/pages/workouts/exerciseDraft.tsx');
const detail = read('src/pages/ExerciseDetail.tsx');
const workoutDetail = read('src/pages/WorkoutDetail.tsx');
const settings = read('src/pages/Settings.tsx');
const app = read('src/App.tsx');
const layout = read('src/components/Layout.tsx');
const model = read('src/pages/workouts/model.ts');
const snapshot = JSON.parse(read('contracts/backend-routes.json'));

/* ----------------------------------------------------------- request paths */

/** Every request src/lib/exerciseLibrary.ts makes, as written and as the backend mounts it. */
const REQUESTS = [
  { method: 'GET', literal: "api.get<ExerciseSearchPage>('/exercises/library'", route: '/api/exercises/library' },
  { method: 'GET', literal: "api.get<ExerciseMeta>('/exercises/library/meta')", route: '/api/exercises/library/meta' },
  { method: 'GET', literal: "api.get<{ exercises?: RecentExercise[] }>('/exercises/library/recent')", route: '/api/exercises/library/recent' },
  { method: 'GET', literal: 'api.get<{ exercise?: Exercise }>(`/exercises/library/${slug}`)', route: '/api/exercises/library/:slug' },
  { method: 'PUT', literal: 'api.put<{ note?: ExerciseNote }>(`/exercises/library/${slug}/note`', route: '/api/exercises/library/:slug/note' },
  { method: 'DELETE', literal: 'api.delete(`/exercises/library/${slug}/note`)', route: '/api/exercises/library/:slug/note' },
  { method: 'GET', literal: "api.get<{ records?: ProgressRecords }>('/workouts/records'", route: '/api/workouts/records' },
  { method: 'GET', literal: "api.get<ProgressHistory>('/workouts/records/history'", route: '/api/workouts/records/history' },
];

test('every request path is written as a literal and is a mounted backend route', () => {
  for (const { method, literal, route } of REQUESTS) {
    assert.ok(api.includes(literal), `src/lib/exerciseLibrary.ts must call ${literal}`);
    const mounted = snapshot.routes.find((r) => r.method === method && r.path === route);
    assert.ok(mounted, `${method} ${route} is not in contracts/backend-routes.json`);
  }
  // The dynamic-path routes must not be shadowed by /:slug, which the snapshot orders after them.
  const order = (p) => snapshot.routes.find((r) => r.method === 'GET' && r.path === p)?.order;
  assert.ok(order('/api/exercises/library/meta') < order('/api/exercises/library/:slug'));
  assert.ok(order('/api/exercises/library/recent') < order('/api/exercises/library/:slug'));
  // One axios client, one place: nothing here builds an absolute URL or reaches for fetch.
  assert.doesNotMatch(api, /\bfetch\(/);
  assert.doesNotMatch(api, /API_BASE|https?:\/\//);
});

test('media URLs come from the API and are never built client-side', () => {
  // GET /exercises/library/media/:slug/:file is public, immutable and cached for a year; the
  // exact URL is always the one the API returned in media[].url.
  assert.doesNotMatch(api, /library\/media/, 'never construct a rendition path');
  assert.doesNotMatch(pickerSrc, /library\/media/);
  assert.doesNotMatch(detail, /library\/media/);
  assert.match(api, /export function thumbnailOf/);
  assert.match(api, /pool\.find\(\(m\) => m\.width === width\)/, 'prefer the exact rendition the API sent');
  // Every image reserves its box from the dimensions the API measured.
  assert.match(pickerSrc, /width=\{shot\.width\}/);
  assert.match(pickerSrc, /height=\{shot\.height\}/);
  assert.match(pickerSrc, /loading="lazy"/, 'a picker page loads 20-40 renditions');
  assert.match(detail, /aspectRatio: `\$\{start\.width\} \/ \$\{start\.height\}`/);
});

test('the history read asks for the whole history; records take the raw id', () => {
  // all=1 raises the page rule to 100 by default and 500 at most (Wave H).
  assert.match(api, /params: \{ exerciseId, all: 1, page, limit \}/);
  assert.match(api, /export const EXERCISE_PAGE_SIZE = 20/, 'the search route caps limit at 50');
  assert.match(api, /q: trimmed\(params\.q\)\?\.slice\(0, 100\)/, 'q is capped at 100 characters');
});

/* ------------------------------------------------------------ the picker */

test('search is debounced and a 404 is feature detection, not a flake or an error state', () => {
  assert.match(pickerSrc, /window\.setTimeout\(\(\) => setQ\(text\.trim\(\)\), 200\)/, '200 ms: 300 searches per 15 minutes per member');
  assert.equal(pickerSrc.split('retry: false,').length - 1, 3, 'meta, recent and the search must not retry a 404');
  assert.match(pickerSrc, /const unavailable = isLibraryUnavailable\(meta\.error\) \|\| isLibraryUnavailable\(results\.error\) \|\| metaIsEmpty\(meta\.data\)/);
  assert.match(pickerSrc, /\{LIBRARY_UNAVAILABLE_COPY\}/);
  assert.match(pickerSrc, /results\.isError && !isLibraryUnavailable\(results\.error\) \? results\.error : null/, 'only a real failure is an ErrorState');
  // The zero rule: skeleton rows of the final geometry while the first page is in flight.
  assert.match(pickerSrc, /results\.isPending \? \(\s*<RowSkeleton rows=\{6\} \/>/);
  assert.match(pickerSrc, /hasNextPage \? last\.page \+ 1 : undefined/);
});

test('the picker is a sheet on phones and a dialog above, with chips from /meta and keyboard walking', () => {
  assert.match(pickerSrc, /<Modal\b[\s\S]{0,400}?size="md"/);
  assert.doesNotMatch(pickerSrc, /presentation="(sheet|dialog)"/, 'presentation stays auto: a sheet under md, a dialog above');
  assert.match(pickerSrc, /initialFocusRef=\{searchRef\}/);
  assert.match(pickerSrc, /<ChipRow label="Muscle"/);
  assert.match(pickerSrc, /<ChipRow label="Equipment"/);
  assert.match(pickerSrc, /chips=\{meta\.data\.muscleGroups\}/, 'the chip labels are the API’s, not humanised keys');
  assert.match(pickerSrc, /e\.key !== 'ArrowDown' && e\.key !== 'ArrowUp' && e\.key !== 'Enter'/);
  assert.match(pickerSrc, /data-picker-row/);
  // Recent is skipped when empty and hidden the moment a filter is on.
  assert.match(pickerSrc, /!filtering && recentItems\.length \? \(/);
});

test('choosing writes the slug as exerciseId; the typed name clears it', () => {
  assert.match(pickerSrc, /onSelect\(\{ exerciseId: exercise\.slug, name: exercise\.name/);
  assert.match(pickerSrc, /onSelect\(\{ exerciseId: null, name: text\.trim\(\) \|\| initialQuery\.trim\(\) \}\)/);
  assert.match(pickerSrc, /Use “\$\{query\}” as a custom exercise/, 'curly quotes around the member’s own words');

  // The row rewrites both fields together, so a name never outlives its id.
  assert.match(draft, /exerciseId: pick\.exerciseId \?\? undefined/);
  assert.match(draft, /library: pick\.exerciseId \? \{ thumbnail: pick\.thumbnail \?\? null, meta: pick\.meta \} : undefined/);
  assert.match(draft, /aria-label=\{`Choose exercise \$\{i \+ 1\} from the library`\}/);
  assert.match(draft, /Choose from library/);
  assert.match(draft, /aria-label=\{`Change exercise \$\{i \+ 1\}`\}/);
  // The name field stays an ordinary editable input until an exercise is chosen.
  assert.match(draft, /<Input label=\{`Exercise \$\{i \+ 1\}`\}[^\n]*value=\{row\.name\}/);
  assert.doesNotMatch(draft, /readOnly/);
  // `library` is for the row header only: the payload carries the id and nothing else new.
  assert.match(draft, /\.\.\.\(d\.exerciseId \? \{ exerciseId: d\.exerciseId \} : \{\}\)/);
  assert.doesNotMatch(draft.slice(draft.indexOf('export function toExercisePayload'), draft.indexOf('const UNIT_OPTIONS')), /library/);
});

/* ------------------------------------------------------------- the page */

test('/exercises/:slug is a lazy page, a sheet route and a ROUTES row in the train hub', () => {
  assert.match(app, /^const ExerciseDetail = lazyPage\(null, \(\) => import\('\.\/pages\/ExerciseDetail'\)\);$/m);
  assert.match(app, /\{ path: 'exercises\/:slug', element: <ExerciseDetail \/> \},/);
  // The sheet list is rendered both inside the shell and over a background location, so one entry covers both.
  assert.equal(app.split("path: 'exercises/:slug'").length - 1, 1);
  assert.match(layout, /\{ pattern: '\/exercises\/:slug', title: 'Exercise', tab: 'workouts', nav: '\/workouts', parent: '\/workouts', hub: 'train' \}/);
  assert.match(detail, /<RouteSheet title=\{name \|\| 'Exercise'\}/, 'RouteSheet owns the title in both presentations');
});

test('the page keeps the zero rule and offers no invented primary action', () => {
  // Records exist only once there is a past to beat: the section is absent, not empty.
  assert.match(detail, /\{recordRows\.length \? \(\s*<Section title="Records">/);
  assert.match(detail, /You haven’t logged this one yet\./, 'the empty history is one line with a curly apostrophe');
  assert.match(detail, /history\.isPending \? \(/, 'the history block has a skeleton of its own geometry');
  assert.match(detail, /function PageBodySkeleton/);
  // Nothing on this page is --brand: there is no route that seeds a session from one exercise.
  assert.doesNotMatch(detail, /variant="primary"|variant="brand"|text-brand|ROW_ACTION/);
  // A 404 from the library read keeps the member's own half of the page.
  assert.match(detail, /const libraryMiss = isLibraryUnavailable\(exercise\.error\)/);
  assert.match(detail, /exercise\.isError && !libraryMiss \?/);
});

test('the pinned note writes through PUT and clears through DELETE, and repaints from the cache', () => {
  assert.match(detail, /mutationFn: \(\) => putExerciseNote\(slug, text\)/);
  assert.match(detail, /mutationFn: \(\) => deleteExerciseNote\(slug\)/);
  assert.match(detail, /maxLength=\{500\}/, 'the route rejects anything over 500');
  assert.match(detail, /disabled=\{!text\.trim\(\)\}/, 'the route rejects an empty note');
  assert.match(detail, /qc\.setQueryData<Exercise>\(exerciseKeys\.detail\(slug\)/);
});

/* --------------------------------------------------------------- links in */

test('a workout row opens the exercise page only when the row carries a library id', () => {
  assert.match(model, /exerciseId\?: string;/, 'models/SocialWorkout.js keeps the id on a routine exercise');
  assert.match(workoutDetail, /to=\{`\/exercises\/\$\{ex\.exerciseId\}`\}/);
  assert.match(workoutDetail, /\{ex\.exerciseId \? \(/);
  assert.match(workoutDetail, /aria-label=\{`About \$\{ex\.name\}`\}/);
  assert.match(workoutDetail, /state=\{sheetState\}/, 'the page opens over the same background on desktop');
});

test('Settings credits the data sources from /meta, and only when there are entries', () => {
  assert.match(settings, /queryKey: exerciseKeys\.meta\(\), queryFn: fetchExerciseMeta/);
  assert.match(settings, /if \(!attributions\.length\) return null;/);
  assert.match(settings, /Data sources &amp; licences/);
  assert.match(settings, /<DataSourcesRow \/>/);
  // The sentence and its link are the API's, rendered as given.
  assert.match(settings, /\{a\.text\}/);
  assert.match(settings, /href=\{a\.url\}/);
  assert.ok(settings.indexOf('<DataSourcesRow />') < settings.indexOf('<VersionRow />'), 'inside the Help and legal card, above the build row');
});
