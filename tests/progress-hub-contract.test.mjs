/**
 * Source pins for the progression hub (Wave F, API 83dbffb): the route and
 * its three entry points exist and hide behind `features.progression`, the
 * page gates on the capabilities query before deciding, every records route
 * is called once with the API's timezone convention, the calendar degrades on
 * FEATURE_DISABLED, the settings card sends only the `workout` key, and the
 * new copy carries none of the design's banned words.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const count = (source, re) => (source.match(re) || []).length;

const app = read('src/App.tsx');
const layout = read('src/components/Layout.tsx');
const page = read('src/pages/WorkoutProgress.tsx');
const sheet = read('src/pages/progress/ExerciseTrendSheet.tsx');
const settings = read('src/pages/settings/WorkoutSettingsSection.tsx');
const prefs = read('src/pages/SettingsPreferences.tsx');
const logs = read('src/pages/WorkoutHistory.tsx');
const sessions = read('src/pages/workouts/sessions.ts');
const sessionForm = read('src/pages/workouts/SessionForm.tsx');
const caps = read('src/lib/capabilities.ts');
const types = read('src/lib/accountTypes.ts');
const calendar = read('src/pages/progress/TrainingCalendar.tsx');

test('the route and its entry points are registered, and every one hides behind features.progression', () => {
  assert.match(app, /lazyPage\('\/workouts\/progress', \(\) => import\('\.\/pages\/WorkoutProgress'\)\)/);
  assert.match(app, /<Route path="workouts\/progress" element=\{<WorkoutProgress \/>\} \/>/);
  // Static before params: the meta for /workouts/progress must win over /workouts/:workoutId.
  const progressIndex = layout.indexOf("pattern: '/workouts/progress'");
  const paramIndex = layout.indexOf("pattern: '/workouts/:workoutId'");
  assert.ok(progressIndex > 0 && progressIndex < paramIndex, 'ROUTES lists /workouts/progress before /workouts/:workoutId');
  assert.match(layout, /\{ pattern: '\/workouts\/progress', title: 'Progress', tab: 'workouts', nav: '\/workouts\/progress', hub: 'train' \}/);
  assert.match(layout, /\{ to: '\/workouts\/progress', label: 'Progress' \}/, 'HUBS.train');
  // Gym First (P2): the sidebar is six flat hubs; Progress lives only in the Train hub's tabs.
  assert.match(layout, /\{ to: '\/workouts', label: 'Train', Icon: Dumbbell, hub: 'train' \}/, 'SIDEBAR Train hub');
  // The old shell kept a PROGRESS_PATH constant to filter the sidebar; the six-hub shell has no
  // such filter, so the path lives in ROUTES and HUBS above, which this test already pins.
  // The hub is visible with the flag off, like the app (GET /workouts/records/summary is not gated): no nav or tab filter.
  assert.doesNotMatch(layout, /progressionEnabled/);
  assert.doesNotMatch(layout, /\{ to: '\/workouts\/progress', label: 'Progress', Icon: TrendingUp \}/, 'no sub-page rows in the flat sidebar');
  // The Live gating this sits beside is untouched.
  assert.match(layout, /\.filter\(\(t\) => liveEnabled \|\| t\.to !== LIVE_PATH\)/, 'Live is gated where it is listed: the Explore hub tabs');
  assert.match(layout, /import \{ useLiveEnabled \} from '\.\.\/lib\/capabilities';/);
  assert.equal(count(layout, /useLiveEnabled\(\)\.enabled/g), 2);
  // WorkoutLogs: the button and the invalidation.
  assert.doesNotMatch(logs, /progressionEnabled/);
  assert.match(logs, /<ButtonLink to="\/workouts\/progress" variant="secondary" icon=\{<TrendingUp size=\{18\} \/>\}>\s*View progress\s*<\/ButtonLink>/, 'View progress shows with the flag off');
  // Both writers of the log invalidate the hub: the save path and the delete path (the hub's queries carry a 60 s staleTime).
  // Save lives in the session form (the /workouts/history/:logId route); delete stays on History. Both invalidate the hub.
  assert.equal(count(logs, /qc\.invalidateQueries\(\{ queryKey: \['workout-progress'\] \}\);/g), 1, 'delete invalidates the hub');
  assert.equal(count(sessionForm, /qc\.invalidateQueries\(\{ queryKey: \['workout-progress'\] \}\);/g), 1, 'save invalidates the hub');
  assert.match(logs, /\^day-\\d\{4\}-\\d\{2\}-\\d\{2\}\$/, 'the #day-<date> deep link from a calendar cell');
  // A #day- target the loaded window does not reach gets an honest line instead of a silent landing at the top.
  assert.match(logs, /const missingDay = useMemo\(/);
  assert.match(logs, /groups\.some\(\(g\) => g\.key === match\[1\]\)/);
  assert.match(logs, /Boolean\(data\.hasNextPage\) && !!oldest && day < startOfDay\(oldest\)/);
  assert.match(logs, /data-testid="log-day-missing"/);
  assert.match(logs, /is further back than the latest \$\{formatStat\(logs\.length\)\} sessions shown here\./);
  assert.match(logs, /No sessions on \$\{missingDay\.label\} in this history\./);
  // Today's stats stay as they were.
  assert.match(logs, /qc\.invalidateQueries\(\{ queryKey: LOGS_KEY \}\);/);
  assert.match(sessions, /export const LOGS_KEY = \['workout-logs'\] as const;/);
  assert.match(sessions, /export const LOGS_LIMIT = 100;/);
  assert.match(sessions, /api\.get<LogsResponse>\('\/workouts\/logs', \{ params: \{ page: 1, limit: LOGS_LIMIT \} \}\)/);
});

test('the page waits for the capabilities answer; the summary is not flag-gated, the Year calendar is', () => {
  assert.match(caps, /export function useFeatureGate\(name: string\)/);
  assert.match(caps, /isPending: capabilities\.isPending,/);
  assert.match(page, /const gate = useFeatureGate\('progression'\);/);
  assert.match(page, /if \(gate\.isPending\) return <PageSkeleton \/>;/);
  assert.match(page, /if \(gate\.isError\) return <ErrorState title="Could not check what is available"/);
  assert.match(page, /enabled: !gate\.isPending,/, 'the summary query waits only for the capabilities answer (the route is not flag-gated, as in the app)');
  assert.match(page, /enabled: enabled && period === 'year',/, 'the calendar query is gated on the flag and the Year chip');
  assert.doesNotMatch(page, /useCapabilities/, 'reads the shared gate, not the raw query');
  // useFeature keeps its pinned shape and FEATURE_DEFAULTS stays at four keys (progression rides on the unknown-name default).
  assert.match(caps, /export function useFeature\(name: string\): boolean/);
  const defaults = caps.slice(caps.indexOf('FEATURE_DEFAULTS'), caps.indexOf('});', caps.indexOf('FEATURE_DEFAULTS')));
  assert.equal(count(defaults, /^\s+'?[A-Za-z.]+'?: false,$/gm), 4);
  assert.doesNotMatch(defaults, /progression/);
});

test('each records route is called once, with the API\'s raw timezone offset; the calendar degrades on FEATURE_DISABLED', () => {
  const source = page + sheet;
  for (const route of ['/workouts/records/summary', '/workouts/records/calendar', '/workouts/records/history', '/workouts/records/previous']) {
    assert.equal(count(source, new RegExp(`api\\.get<[^>]+>\\('${route.replace(/\//g, '\\/')}'`, 'g')), 1, route);
  }
  assert.equal(count(source, /api\.get<\{ records: ProgressRecords \}>\('\/workouts\/records', /g), 1, '/workouts/records');
  assert.equal(count(page, /\.\.\.localDayParams\(\)/g), 2, 'summary and calendar send timezoneOffsetMinutes the way every day-keyed page does');
  assert.match(page, /params: \{ from: range\.from, to: range\.to, \.\.\.localDayParams\(\) \}/);
  assert.match(page, /params: \{ from: yearRange\.from, to: yearRange\.to, \.\.\.localDayParams\(\) \}/);
  assert.match(page, /retry: false,/, 'a FEATURE_DISABLED 404 is not retried');
  assert.match(page, /calendar\.isError && isFeatureDisabled\(calendar\.error\)/);
  assert.match(page, /PROGRESS_STRINGS\.yearFallback/);
  assert.match(page, /YEAR_FALLBACK/, 'the Year chip reads the quarter summary');
  // The label under the chips names the summary's window (the quarter on Year); the year range sits on the calendar card alone.
  assert.match(page, /const label = periodLabel\(range\);/);
  assert.doesNotMatch(page, /periodLabel\(period === 'year' \? yearRange : range\)/);
  assert.match(page, /calendarHidden \? PROGRESS_STRINGS\.yearAllQuarterNote : PROGRESS_STRINGS\.yearSummaryNote/);
  assert.match(page, /const heatRangeLabel = heatRange === yearRange \? periodLabel\(yearRange\) : null;/);
  assert.match(page, /rangeLabel=\{heatRangeLabel\}/);
  // The heatmap: a non-colour cue on every trained level, 24 px-clear targets under a coarse pointer, and the newest week in view.
  assert.match(calendar, /0: 'border border-line bg-surface-2',/);
  // The ramp is the ink token, never the action colour (the accent is for the one action on a screen).
  for (const level of ['1', '2', '3']) assert.match(calendar, new RegExp(`${level}: 'border border-text-2 bg-text-1`), `level ${level} carries the outline cue`);
  assert.doesNotMatch(calendar, /bg-brand/, 'no accent fill on the heatmap');
  assert.match(calendar, /const CELL = 'size-3 pointer-coarse:size-5 rounded-\[3px\]';/);
  assert.match(calendar, /const GAP = 'gap-1 pointer-coarse:gap-1\.5';/);
  assert.match(calendar, /const COLS = 'auto-cols-\[0\.75rem\] pointer-coarse:auto-cols-\[1\.25rem\]';/);
  assert.match(calendar, /if \(el\) el\.scrollLeft = el\.scrollWidth;/);
  assert.match(calendar, /\}, \[range\.from, range\.to, grid\.columns\.length\]\);/);
  assert.match(sheet, /params: \{ exerciseId: id, page: 1, limit: 100 \}/);
  assert.match(sheet, /enabled: open && preferences\.progressionHints,/, '/previous is read only while Suggestions is on');
  assert.match(sheet, /previous\.data\?\.suggested \?\? null/, 'a missing key draws no line');
  assert.match(sheet, /role="img" aria-label=\{trendDescription\(shownSeries\)\}/);
  // The line itself lives in the lazy chart module (Recharts off the hub's critical path); the sheet keeps the 13 rem box.
  assert.match(sheet, /const TrendChart = lazy\(\(\) => import\('\.\/TrendChart'\)\);/);
  assert.match(read('src/pages/progress/TrendChart.tsx'), /stroke=\{VIZ\.brand\}/);
  assert.doesNotMatch(sheet, /variant="primary"/, 'nothing in the sheet is a primary action');
  // Units: only the formatters convert; the page reads the store once and hands `system` down.
  assert.match(page, /const system = useUnits\(\(s\) => s\.system\);/);
  for (const file of ['src/pages/progress/ProgressTiles.tsx', 'src/pages/progress/TrainingCalendar.tsx', 'src/pages/progress/MuscleGroups.tsx', 'src/pages/progress/Movements.tsx', 'src/pages/progress/RecordsList.tsx']) {
    const card = read(file);
    assert.doesNotMatch(card, /useUnits|useQuery|useAuth|useCapabilities|useFeature/, `${file} stays pure`);
  }
});

test('the settings card sends only { workout } through the shared PATCH and hides with the flag', () => {
  assert.match(types, /'accessibility',\s+'workout',\s+'homeGym',\s+\] as const;/, "SETTINGS_KEYS: 'workout' then the Gym First 'homeGym'");
  assert.match(types, /workout\?: \{ progressionHints\?: boolean; defaultRepRange\?: \{ min: number; max: number \} \| null \};/);
  assert.match(types, /export type WorkoutSettings = \{/);
  assert.match(prefs, /export function useAccount\(\)/);
  assert.match(prefs, /export const settingsFieldError = /);
  assert.match(prefs, /export function useSettingsSave\(/);
  assert.match(prefs, /import WorkoutSettingsSection from '\.\/settings\/WorkoutSettingsSection';/);
  assert.match(prefs, /<AccessibilitySection \/>\s*<WorkoutSettingsSection \/>/, 'mounted after Accessibility, inside the one mount point');
  assert.match(settings, /const enabled = useFeature\('progression'\);\s*if \(!enabled\) return null;/);
  assert.match(settings, /<SettingsCard id="workouts" title=\{PROGRESS_STRINGS\.settingsTitle\}/);
  const patches = settings.match(/patch: \{[^}]*\}[^}]*\}/g) || [];
  assert.ok(patches.length >= 3, `expected the toggle, range and reset writers, found ${patches.length}`);
  for (const patch of patches) assert.match(patch, /^patch: \{ workout: \{/, patch);
  assert.match(settings, /patch: \{ workout: \{ progressionHints \} \}/);
  assert.match(settings, /patch: \{ workout: \{ defaultRepRange: \{ min, max \} \} \}/);
  assert.match(settings, /patch: \{ workout: \{ defaultRepRange: null \} \}/);
  assert.match(settings, /settingsFieldError\(e, 'workout'\)/, 'the server sentence lands under the range');
  assert.match(settings, /disabled=\{!changed \|\| invalid \|\| busy\}/, 'an inverted range is never sent');
  assert.match(settings, /min=\{REP_RANGE_BOUNDS\.min\}\s+max=\{REP_RANGE_BOUNDS\.max\}/);
  assert.doesNotMatch(settings, /api\.put/, 'writes go through useSettingsSave');
});

/* ------------------------------------------------------------------ copy */

const BANNED = /streak|missed|lost|behind|crushed|beast|smash|weak|fat\b|weight loss|lean|calories|burn|!/i;

/** Every string literal and JSX text node in a TSX source: what a person can read, not the code around it. */
function readableText(relative) {
  const source = read(relative);
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text);
      for (const span of node.templateSpans) out.push(span.literal.text);
    } else if (ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out.map((t) => t.trim()).filter(Boolean);
}

test('the new surface carries none of the design\'s banned words and no exclamation mark', () => {
  const files = [
    'src/lib/progress.ts',
    'src/pages/WorkoutProgress.tsx',
    ...fs.readdirSync(path.join(root, 'src/pages/progress')).map((name) => `src/pages/progress/${name}`),
    'src/pages/settings/WorkoutSettingsSection.tsx',
  ];
  assert.ok(files.length >= 8);
  for (const file of files) {
    const texts = readableText(file);
    assert.ok(texts.length > 0, `${file} has readable text`);
    for (const text of texts) {
      // Class lists and query keys are code, not copy, but they must not smuggle a banned word either.
      assert.doesNotMatch(text, BANNED, `${file}: "${text}"`);
    }
    assert.doesNotMatch(read(file), /e-mail/i, 'email, not e-mail');
  }
});

test('with the flag off the hub stays, only the Year calendar and the hints wait (parity with the app)', () => {
  const page = fs.readFileSync(new URL('../src/pages/WorkoutProgress.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /if \(!enabled\) return <Navigate to="\/workouts\/logs" replace \/>;/);
  assert.match(page, /if \(!enabled && period === 'year'\) return <Navigate to="\/workouts\/progress" replace \/>;/);
  assert.match(page, /PERIODS\.filter\(\(p\) => enabled \|\| p\.key !== 'year'\)/);
  assert.match(page, /enabled: enabled && period === 'year',/, 'the calendar read still waits for the flag');
  assert.match(fs.readFileSync(new URL('../src/pages/settings/WorkoutSettingsSection.tsx', import.meta.url), 'utf8'), /useFeature\('progression'\)/, 'the hints switch still waits for the flag');
});
