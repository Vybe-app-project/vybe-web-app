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
const logs = read('src/pages/WorkoutLogs.tsx');
const caps = read('src/lib/capabilities.ts');
const types = read('src/lib/accountTypes.ts');

test('the route and its entry points are registered, and every one hides behind features.progression', () => {
  assert.match(app, /lazyPage\('\/workouts\/progress', \(\) => import\('\.\/pages\/WorkoutProgress'\)\)/);
  assert.match(app, /<Route path="workouts\/progress" element=\{<WorkoutProgress \/>\} \/>/);
  // Static before params: the meta for /workouts/progress must win over /workouts/:workoutId.
  const progressIndex = layout.indexOf("pattern: '/workouts/progress'");
  const paramIndex = layout.indexOf("pattern: '/workouts/:workoutId'");
  assert.ok(progressIndex > 0 && progressIndex < paramIndex, 'ROUTES lists /workouts/progress before /workouts/:workoutId');
  assert.match(layout, /\{ pattern: '\/workouts\/progress', title: 'Progress', tab: 'workouts', nav: '\/workouts\/progress', hub: 'train' \}/);
  assert.match(layout, /\{ to: '\/workouts\/progress', label: 'Progress' \}/, 'HUBS.train');
  assert.match(layout, /\{ to: '\/workouts\/progress', label: 'Progress', Icon: TrendingUp \}/, 'SIDEBAR Train');
  assert.match(layout, /const PROGRESS_PATH = '\/workouts\/progress';/);
  assert.match(layout, /const progressionEnabled = useFeature\('progression'\);/);
  assert.match(layout, /progressionEnabled \? g\.items : g\.items\.filter\(\(i\) => i\.to !== PROGRESS_PATH\)/, 'sidebar filter');
  assert.match(layout, /\.filter\(\(t\) => progressionEnabled \|\| t\.to !== PROGRESS_PATH\)/, 'hub tab filter');
  assert.match(layout, /progressionEnabled=\{progressionEnabled\}/);
  // The Live gating this sits beside is untouched.
  assert.match(layout, /liveEnabled \? g\.items : g\.items\.filter\(\(i\) => i\.to !== LIVE_PATH\)/);
  assert.match(layout, /import \{ useLiveEnabled \} from '\.\.\/lib\/capabilities';/);
  assert.equal(count(layout, /useLiveEnabled\(\)\.enabled/g), 2);
  // WorkoutLogs: the button and the invalidation.
  assert.match(logs, /const progressionEnabled = useFeature\('progression'\);/);
  assert.match(logs, /\{progressionEnabled \? \(\s*<ButtonLink to="\/workouts\/progress" variant="secondary" icon=\{<TrendingUp size=\{18\} \/>\}>\s*View progress\s*<\/ButtonLink>\s*\) : null\}/);
  assert.match(logs, /qc\.invalidateQueries\(\{ queryKey: \['workout-progress'\] \}\);/);
  assert.match(logs, /\^day-\\d\{4\}-\\d\{2\}-\\d\{2\}\$/, 'the #day-<date> deep link from a calendar cell');
  // Today's stats stay as they were.
  assert.match(logs, /qc\.invalidateQueries\(\{ queryKey: \['workout-logs'\] \}\);/);
  assert.match(logs, /api\.get<LogsResponse>\('\/workouts\/logs', \{ params: \{ page: 1, limit: 100 \} \}\)/);
});

test('the page waits for the capabilities answer, then hides or renders; nothing fetches before the flag is true', () => {
  assert.match(caps, /export function useFeatureGate\(name: string\)/);
  assert.match(caps, /isPending: capabilities\.isPending,/);
  assert.match(page, /const gate = useFeatureGate\('progression'\);/);
  assert.match(page, /if \(gate\.isPending\) return <PageSkeleton \/>;/);
  assert.match(page, /if \(gate\.isError\) return <ErrorState title="Could not check what is available"/);
  assert.match(page, /if \(!enabled\) return <Navigate to="\/workouts\/logs" replace \/>;/);
  assert.match(page, /^\s+enabled,\s*$/m, 'the summary query is gated on the flag');
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
  assert.match(sheet, /params: \{ exerciseId: id, page: 1, limit: 100 \}/);
  assert.match(sheet, /enabled: open && preferences\.progressionHints,/, '/previous is read only while Suggestions is on');
  assert.match(sheet, /previous\.data\?\.suggested \?\? null/, 'a missing key draws no line');
  assert.match(sheet, /role="img" aria-label=\{trendDescription\(shownSeries\)\}/);
  assert.match(sheet, /stroke=\{VIZ\.brand\}/);
  assert.doesNotMatch(sheet, /variant="primary"/, 'nothing in the sheet is a primary action');
  // Units: only the formatters convert; the page reads the store once and hands `system` down.
  assert.match(page, /const system = useUnits\(\(s\) => s\.system\);/);
  for (const file of ['src/pages/progress/ProgressTiles.tsx', 'src/pages/progress/TrainingCalendar.tsx', 'src/pages/progress/MuscleGroups.tsx', 'src/pages/progress/Movements.tsx', 'src/pages/progress/RecordsList.tsx']) {
    const card = read(file);
    assert.doesNotMatch(card, /useUnits|useQuery|useAuth|useCapabilities|useFeature/, `${file} stays pure`);
  }
});

test('the settings card sends only { workout } through the shared PATCH and hides with the flag', () => {
  assert.match(types, /'accessibility',\s+'workout',\s+\] as const;/, "SETTINGS_KEYS ends with 'workout'");
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
