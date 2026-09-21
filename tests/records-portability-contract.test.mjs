/**
 * Source contracts for P4 (records maintenance, CSV export, Strong/Hevy
 * import). Every literal request path the two fetcher modules send is listed
 * here and checked against contracts/backend-routes.json — the audit script
 * only recognises `lib/api` imported from outside src/lib, so a module that
 * sits beside api.ts is invisible to it and this is what holds those paths.
 *
 * The rest pins the decisions that make the package correct rather than merely
 * present: the record id built from the fields the payload carries, the
 * per-exercise scope of both corrections, multipart bodies (the JSON parser is
 * capped below the route's own limit), the mapping sent with the commit rather
 * than re-previewed, 404 NOT_FOUND read as absence and never as an error, and
 * the route, its ROUTES row and its three entry points.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const count = (source, re) => (source.match(re) || []).length;

const recordsApi = read('src/lib/records.ts');
const portability = read('src/lib/portability.ts');
const page = read('src/pages/WorkoutProgress.tsx');
const shelf = read('src/pages/progress/RecordsShelf.tsx');
const importPage = read('src/pages/workouts/ImportWorkouts.tsx');
const history = read('src/pages/WorkoutHistory.tsx');
const dataExport = read('src/pages/settings/DataExport.tsx');
const app = read('src/App.tsx');
const layout = read('src/components/Layout.tsx');
const model = read('src/lib/progress.ts');
const snapshot = JSON.parse(read('contracts/backend-routes.json'));

/* ----------------------------------------------------------- request paths */

/** Every request the two modules make, as written and as the backend mounts it. */
const REQUESTS = [
  { file: 'src/lib/records.ts', method: 'GET', literal: "api.get<{ records?: ProgressRecords }>('/workouts/records', { params: { exerciseId: ids.join(',') } })", route: '/api/workouts/records' },
  { file: 'src/lib/records.ts', method: 'GET', literal: "api.get<ProgressSummary>('/workouts/records/summary'", route: '/api/workouts/records/summary' },
  { file: 'src/lib/records.ts', method: 'GET', literal: "'/workouts/records/adjustments', { params: { exerciseId } }", route: '/api/workouts/records/adjustments' },
  { file: 'src/lib/records.ts', method: 'DELETE', literal: 'api.delete<RecordMaintenance>(`/workouts/records/${encodeURIComponent(recordId)}`)', route: '/api/workouts/records/:id' },
  { file: 'src/lib/records.ts', method: 'POST', literal: 'api.post<RecordMaintenance>(`/workouts/records/${encodeURIComponent(recordId)}/restore`)', route: '/api/workouts/records/:id/restore' },
  { file: 'src/lib/records.ts', method: 'POST', literal: "api.post<RecordMaintenance>('/workouts/records/reset', { exerciseId, from, ...localDayParams() })", route: '/api/workouts/records/reset' },
  { file: 'src/lib/records.ts', method: 'DELETE', literal: "api.delete<RecordMaintenance>('/workouts/records/reset', { params: { exerciseId } })", route: '/api/workouts/records/reset' },
  { file: 'src/lib/portability.ts', method: 'GET', literal: "export const WORKOUTS_CSV_PATH = '/me/export/workouts.csv';", route: '/api/me/export/workouts.csv' },
  { file: 'src/lib/portability.ts', method: 'POST', literal: "api.post<ImportPreview>('/me/import/workouts', importForm(csv, fileName, options, true))", route: '/api/me/import/workouts' },
  { file: 'src/lib/portability.ts', method: 'POST', literal: "api.post<ImportResult>('/me/import/workouts', importForm(csv, fileName, options, false))", route: '/api/me/import/workouts' },
];

const sources = { 'src/lib/records.ts': recordsApi, 'src/lib/portability.ts': portability };

test('every request path is written as a literal and is a mounted backend route', () => {
  for (const { file, method, literal, route } of REQUESTS) {
    assert.ok(sources[file].includes(literal), `${file} must call ${literal}`);
    const mounted = snapshot.routes.find((r) => r.method === method && r.path === route);
    assert.ok(mounted, `${method} ${route} is not in contracts/backend-routes.json`);
  }
  // The literal maintenance paths must not be shadowed by /:id, which the
  // snapshot orders after them (routes/workoutRecords.js declares them first).
  const order = (method, p) => snapshot.routes.find((r) => r.method === method && r.path === p)?.order;
  assert.ok(order('GET', '/api/workouts/records/adjustments') < order('DELETE', '/api/workouts/records/:id'));
  assert.ok(order('POST', '/api/workouts/records/reset') < order('DELETE', '/api/workouts/records/:id'));
  assert.ok(order('DELETE', '/api/workouts/records/reset') < order('DELETE', '/api/workouts/records/:id'));
  // One axios client, one place: nothing here builds an absolute URL or reaches for fetch.
  for (const source of Object.values(sources)) {
    assert.doesNotMatch(source, /\bfetch\(/);
    assert.doesNotMatch(source, /API_BASE|https?:\/\//);
  }
});

test('a record id is built from the payload, never guessed, and an unparseable one offers no removal', () => {
  assert.match(recordsApi, /const ID_PART = \/\^\[A-Za-z0-9_-\]\{1,80\}\$\/;/, "the per-set contract's alphabet");
  assert.match(recordsApi, /const OBJECT_ID = \/\^\[0-9a-fA-F\]\{24\}\$\/;/);
  assert.match(recordsApi, /return `\$\{workoutId\}:\$\{exerciseId\}`;/, 'an aggregate record: two parts');
  assert.match(recordsApi, /return `\$\{workoutId\}:\$\{exerciseId\}:\$\{setId\}`;/, 'a set record: three');
  assert.match(page, /const recordId = recordIdOf\(row\.exerciseId, row\.facts\[factIndex\]\);\s*if \(!recordId\) return;/);
  // The shelf keys its menu on the achieving set, so one set is offered once.
  assert.match(shelf, /const key = `\$\{fact\.workoutId\}:\$\{fact\.setId \?\? ''\}`;/);
  assert.match(shelf, /if \(items\.some\(\(item\) => item\.key === key\)\) return;/);
});

test('both corrections are per exercise, each with its inverse, and repaint from a single invalidation', () => {
  // POST /reset takes an exerciseId; there is no route that resets every
  // exercise, so the control lives on the row and the footer says so.
  assert.match(recordsApi, /export async function resetRecords\(exerciseId: string, from: string\)/);
  assert.match(recordsApi, /export async function clearRecordsReset\(exerciseId: string\)/);
  assert.match(model, /bestsPerExercise: 'Starting fresh applies to one movement at a time, from its own menu\.',/);
  assert.match(shelf, /label: PROGRESS_STRINGS\.bestsReset,/);
  assert.match(shelf, /label: PROGRESS_STRINGS\.bestsRemove,/);
  // Every write offers its Undo in the toast, through the inverse route.
  assert.equal(count(page, /action: \{ label: PROGRESS_STRINGS\.undo, onClick: \(\) => void undo/g), 2);
  assert.match(page, /await restoreRecord\(recordId\);/);
  assert.match(page, /await clearRecordsReset\(exerciseId\);/);
  assert.match(page, /const refreshRecords = async \(\) => \{\s*await qc\.invalidateQueries\(\{ queryKey: recordKeys\.all \}\);\s*await qc\.invalidateQueries\(\{ queryKey: \['workout-progress'\] \}\);/);
  // The date cannot be in the future, which is also the route's rule.
  assert.match(shelf, /<DateField label="From" value=\{from\} max=\{today\}/);
});

test('the adjustments read is per exercise, so nothing is asked until the line is opened', () => {
  assert.match(recordsApi, /export async function fetchAdjustments\(exerciseId: string\)/);
  assert.match(page, /enabled: adjustmentsOpen,/, 'the per-movement reads wait for the disclosure');
  assert.match(page, /const adjustmentQueries = useQueries\(\{/);
  assert.match(shelf, /\{PROGRESS_STRINGS\.adjustmentsShow\}/);
  // Before the read, no count is claimed.
  assert.match(shelf, /\{!open \? \(\s*<p className="t-meta text-text-3">\{PROGRESS_STRINGS\.bestsPerExercise\}<\/p>/);
});

test('a 404 NOT_FOUND is absence, not a fault, and the route-level 404s stay real answers', () => {
  for (const source of Object.values(sources)) {
    assert.match(source, /details\.status === 404 && \(details\.code === null \|\| details\.code === 'NOT_FOUND'\)/);
  }
  assert.match(recordsApi, /details\.code === 'RECORD_NOT_FOUND' \|\| details\.code === 'RECORD_RESET_NOT_FOUND'/);
  assert.match(page, /const bestsHidden = bests\.isError && isNotDeployed\(bests\.error\);/);
  assert.match(page, /\{bestsHidden \? null : \(/);
  assert.match(page, /retry: false,/, 'a 404 is an answer, not a flake');
  // The entry points cannot probe either route cheaply, so one 404 takes them away for the session.
  assert.match(portability, /export function noteIfMissing\(kind: 'import' \| 'export', error: unknown\): boolean \{/);
  assert.match(portability, /usePortabilitySupport\.getState\(\)\.markMissing\(kind\);/);
  assert.match(importPage, /if \(noteIfMissing\('import', e\)\) setMissing\(true\);/);
  assert.match(dataExport, /if \(!noteIfMissing\('export', e\)\) toast\.error\(/);
  assert.match(history, /const canImport = usePortabilitySupport\(\(p\) => p\.importSupported\);/);
  assert.match(history, /if \(records\.isError && isNotDeployed\(records\.error\)\) return new Set<string>\(\);/);
});

/* -------------------------------------------------------------- the import */

test('the import body is multipart, because the JSON parser is capped below the route', () => {
  assert.match(portability, /form\.append\('file', csv, fileName\);/);
  assert.match(portability, /form\.append\('dryRun', dryRun \? '1' : '0'\);/);
  assert.match(portability, /form\.append\('timezoneOffsetMinutes', String\(timezoneOffsetMinutes\(\)\)\);/);
  assert.match(portability, /form\.append\('mapping', JSON\.stringify\(options\.mapping\)\)/, 'a JSON string in a multipart field');
  // No JSON body: express.json() is capped at 2 MiB in app.js while the route allows 5 MiB.
  assert.doesNotMatch(portability, /api\.post<[^>]*>\('\/me\/import\/workouts', \{/);
  assert.match(portability, /export const csvBlobOf = \(text: string\): Blob => new Blob\(\[text\], \{ type: 'text\/csv' \}\);/);
  assert.match(portability, /export const IMPORT_MAX_BYTES = 5 \* 1024 \* 1024;/, 'WORKOUT_IMPORT_MAX_BYTES');
  assert.match(portability, /export const MAPPING_MAX_ENTRIES = 500;/);
  assert.match(portability, /\^custom-\[a-z0-9\]\[a-z0-9-\]\{0,72\}\$/, 'the picker stub id the route accepts');
  // The file never leaves the device when it is over the route's ceiling.
  assert.match(importPage, /if \(next\.size > IMPORT_MAX_BYTES\) \{/);
});

test('the preview is the dry-run; the mapping rides the commit rather than a second upload', () => {
  assert.match(importPage, /mutationFn: \(next: Source\) => previewWorkoutImport\(next\.blob, next\.name\),/);
  assert.match(importPage, /mutationFn: \(next: Source\) => commitWorkoutImport\(next\.blob, next\.name, \{ unit, mapping \}\),/);
  // The unit toggle appears exactly when the file named no unit.
  assert.match(importPage, /const askUnit = !!data && data\.unitDetected === null;/);
  // "Keep as custom" maps to the id the API already computed; nothing is invented.
  assert.match(importPage, /setMapping\(\(prev\) => \(\{ \.\.\.prev, \[name\]: row\.exerciseId \}\)\);/);
  assert.match(importPage, /const id = pick\.exerciseId \?\? row\?\.exerciseId;/);
  // The two formats the server's header sniffing knows, and no third one.
  assert.match(portability, /export type ImportFormat = 'strong' \| 'hevy';/);
  assert.match(portability, /FORMAT_LABELS: Record<ImportFormat, string> = \{ strong: 'Strong', hevy: 'Hevy' \};/);
  // The route answers counts, not lines: the card prints the counts it was given.
  assert.match(importPage, /preview\.alreadyImported > 0/);
  assert.match(importPage, /preview\.invalid > 0/);
  assert.match(importPage, /Math\.max\(0, preview\.workouts - preview\.alreadyImported - preview\.invalid\)/);
  // The commit is the screen's one blue; the done card links to History.
  // Three primaries, one per step, and the steps are mutually exclusive: pick a
  // file, Import, then View history — never two filled blues on one screen.
  assert.equal(count(importPage, /variant="primary"/g), 3);
  assert.match(importPage, /<ButtonLink to="\/workouts\/history" variant="primary">/);
});

test('the export is an authenticated blob with an object URL, not a link', () => {
  assert.match(portability, /api\.get<Blob>\(WORKOUTS_CSV_PATH, \{ responseType: 'blob' \}\)/);
  assert.match(portability, /filename="\?\(\[\^";\]\+\)"\?/, "the server's own attachment name wins");
  assert.match(portability, /export function saveBlob\(blob: Blob, fileName: string\): void \{/);
  assert.match(portability, /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 10_000\);/, 'revoking in the same task cancels the download in Safari');
  assert.match(dataExport, /const \{ blob, fileName \} = await fetchWorkoutsCsv\(\);\s*saveBlob\(blob, fileName\);/);
  // The archive flow above it is untouched and keeps the card's one blue.
  assert.match(dataExport, /api\.post\(['"]\/users\/me\/exports['"],[\s\S]{0,120}'X-Reauth'/);
  assert.match(dataExport, /id="data-export-request"\s+variant="primary"/);
  assert.equal(count(dataExport, /variant="primary"/g), 2, 'the archive request and the archive download; the CSV row is secondary');
  assert.match(dataExport, /variant="secondary"\s+icon=\{<Download size=\{16\} \/>\}/);
});

/* ---------------------------------------------------------------- the route */

test('/workouts/import is a lazy page, a route, a ROUTES row in the train hub and three entry points', () => {
  assert.match(app, /^const ImportWorkouts = lazyPage\('\/workouts\/import', \(\) => import\('\.\/pages\/workouts\/ImportWorkouts'\)\);$/m);
  assert.match(app, /<Route path="workouts\/import" element=\{<ImportWorkouts \/>\} \/>/);
  // Static before params: this row must win over /workouts/:workoutId.
  const importIndex = layout.indexOf("pattern: '/workouts/import'");
  const paramIndex = layout.indexOf("pattern: '/workouts/:workoutId'");
  assert.ok(importIndex > 0 && importIndex < paramIndex, 'ROUTES lists /workouts/import before /workouts/:workoutId');
  // hideTabs on the row, not on the page: SectionTabs prefix-matches /workouts/
  // and would underline Library, and a row-level hide never costs a layout shift.
  assert.match(layout, /\{ pattern: '\/workouts\/import', title: 'Import workouts', tab: 'workouts', nav: '\/workouts\/history', parent: '\/workouts\/history', hub: 'train', hideTabs: true \}/);
  // A lazyPage that registers a preload must be routed, which the line above is.
  assert.ok(app.includes("<Route path=\"workouts/import\""));
  // Entry points: the History header menu, the History empty state, Settings › Data.
  assert.match(history, /export const IMPORT_PATH = '\/workouts\/import';/);
  assert.match(history, /export const IMPORT_LABEL = 'Import from Strong or Hevy';/);
  assert.equal(count(history, /<Menu items=\{IMPORT_MENU\} label="More history options" \/>/g), 2, 'the desktop actions and the phone bar');
  assert.match(history, /<ButtonLink to=\{IMPORT_PATH\} variant="ghost" icon=\{<Upload size=\{18\} \/>\}>/);
  assert.match(dataExport, /const IMPORT_PATH = '\/workouts\/import';/);
  assert.match(dataExport, /const IMPORT_ROW = 'Import from Strong or Hevy';/);
  assert.match(importPage, /back="\/workouts\/history"/, 'the back chevron goes to History');
  assert.doesNotMatch(importPage, /hideSectionTabs/, 'the row hides the tabs, so the first frame never draws them');
  // Nothing outside the sheet list is a sheet route; the import is an ordinary page.
  assert.doesNotMatch(app, /path: 'workouts\/import'/);
});

test('the History PR badge comes from the summary, wears --accent, and covers the window one read can answer', () => {
  assert.match(history, /queryKey: recordKeys\.summary\(prWindow\),/);
  assert.match(history, /queryFn: \(\) => fetchRecordsSummary\(prWindow\),/);
  assert.match(history, /const range = periodRange\('quarter'\);/, 'the summary is capped at 92 days');
  assert.match(history, /\(records\.data\?\.prs \?\? \[\]\)\.map\(\(pr\) => pr\.workoutId\)/, "the server's own prs[], never derived here");
  assert.match(history, /pr=\{prWorkouts\.has\(log\._id\)\}/);
  assert.match(history, /<Badge size="sm" tone="accent" data-testid="log-pr">/, 'ember is the PR badge, per the register');
  assert.match(history, /a personal record in this session/, 'the badge is spoken in full');
  // A deleted session changes the records, so both reads are invalidated.
  assert.match(history, /qc\.invalidateQueries\(\{ queryKey: recordKeys\.all \}\);/);
});

/* ------------------------------------------------------------------- copy */

const BANNED = /streak|missed|lost|behind|crushed|beast|smash|weak|fat\b|weight loss|lean|calories|burn|!/i;

test('the new copy carries none of the design\'s banned words and no exclamation mark', () => {
  // progress-hub-contract already walks src/pages/progress and src/lib/progress.ts;
  // these are the files P4 adds outside that tree.
  for (const file of ['src/lib/records.ts', 'src/lib/portability.ts', 'src/pages/workouts/ImportWorkouts.tsx']) {
    const source = read(file);
    const copy = source.match(/'[^'\n]{4,}'|`[^`\n]{4,}`/g) || [];
    assert.ok(copy.length > 10, `${file} has readable text`);
    for (const literal of copy) {
      // Class lists and request paths are code, not copy, but they must not smuggle a banned word either.
      assert.doesNotMatch(literal, BANNED, `${file}: ${literal}`);
    }
    assert.doesNotMatch(source, /e-mail/i, 'email, not e-mail');
  }
});
