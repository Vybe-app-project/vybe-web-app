/**
 * The live session renders from props alone (renderToString inside a
 * MemoryRouter): a set row is a number chip, the PREVIOUS ghost, two fields
 * carrying that ghost as their placeholder and one 44 px ✓; a finished card
 * folds to "3 sets · 60 kg × 8"; the recap is the Time · Volume · Sets triple
 * over one row per exercise.
 *
 * The second half pins the wiring the register cares about and a walk cannot
 * see at a glance: the routes, one filled brand button per screen, the
 * "never a zero" rule, and where each entry point on the Train hub goes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const parts = await import('../src/pages/workouts/session/parts.tsx');

const render = (ui) => renderToString(h(MemoryRouter, null, ui));
const count = (html, needle) => html.split(needle).length - 1;
const noop = () => {};

const set = (over = {}) => ({
  id: over.id ?? 's1',
  reps: over.reps ?? null,
  weight: over.weight ?? null,
  weightUnit: over.weightUnit ?? 'kg',
  completed: over.completed ?? false,
  completedAt: over.completed ? '2026-09-21T10:05:00.000Z' : null,
  previous: over.previous ?? null,
});

const exercise = (over = {}) => ({
  key: 'k1',
  exerciseId: 'bench-press',
  name: 'Bench press',
  sets: over.sets ?? [set()],
  restSeconds: over.restSeconds ?? 90,
  notes: '',
  ...(over.collapsed === undefined ? {} : { collapsed: over.collapsed }),
});

/* --------------------------------------------------------------- set rows */

test('a set row shows the PREVIOUS ghost and carries it as the placeholder of both fields', () => {
  const html = render(
    h(
      'ul',
      null,
      h(parts.SetRow, {
        index: 1,
        unit: 'kg',
        exerciseName: 'Bench press',
        set: set({ previous: { reps: 8, weight: 60, weightUnit: 'kg' } }),
        onField: noop,
        onToggle: noop,
      }),
    ),
  );
  assert.ok(html.includes('60 kg × 8'), 'the ghost reads weight × reps in the session unit');
  assert.match(html, /placeholder="60"/, 'the weight field offers last time s load');
  assert.match(html, /placeholder="8"/, 'the reps field offers last time s reps');
  // Both fields are labelled (visually hidden), not placeholder-only.
  assert.match(html, /class="[^"]*sr-only">Weight for set 2 of Bench press<\/label>/);
  assert.match(html, /class="[^"]*sr-only">Reps for set 2 of Bench press<\/label>/);
  assert.match(html, /inputMode="decimal"|inputmode="decimal"/);
  assert.match(html, /inputMode="numeric"|inputmode="numeric"/);
  // The ✓ is a 44 px toggle that says whether it is pressed.
  assert.match(html, /aria-pressed="false"[^>]*aria-label="Mark set 2 of Bench press done"/);
  assert.ok(html.includes('h-11 w-11'), 'the check target is 44 px');
  assert.ok(!html.includes('value="0"'), 'an untouched field is blank, never a zero');
});

test('a row with nothing behind it shows an em dash rather than an empty column', () => {
  const html = render(h('ul', null, h(parts.SetRow, { index: 0, unit: 'lb', exerciseName: 'Row', set: set(), onField: noop, onToggle: noop })));
  assert.ok(html.includes('—'));
  assert.match(html, /placeholder="0"/);
});

test('a completed row is a wash and a filled check, never a green row', () => {
  const html = render(
    h('ul', null, h(parts.SetRow, { index: 0, unit: 'kg', exerciseName: 'Bench press', set: set({ completed: true, reps: 8, weight: 60 }), onField: noop, onToggle: noop })),
  );
  assert.ok(html.includes('bg-surface-2'), 'a completed row gets the surface-2 wash');
  assert.match(html, /aria-pressed="true"/);
  assert.ok(!/text-success|bg-success/.test(html), 'Vybe has no green');
  assert.match(html, /value="60"/);
  assert.match(html, /value="8"/);
});

test('the table header names its columns in the session unit', () => {
  for (const unit of ['kg', 'lb']) {
    const html = render(h(parts.SetTableHeader, { unit }));
    for (const column of ['Set', 'Previous', unit, 'Reps', 'Done']) assert.ok(html.includes(`>${column}<`), `${unit}: ${column}`);
  }
});

/* ---------------------------------------------------------- exercise card */

test('an open card shows the rest chip, the table and Add set', () => {
  const html = render(
    h(parts.ExerciseCard, {
      exercise: exercise({ sets: [set({ id: 'a' }), set({ id: 'b' })] }),
      unit: 'kg',
      onField: noop,
      onToggleSet: noop,
      onAddSet: noop,
      onRemoveSet: noop,
      onRest: noop,
      onCollapse: noop,
    }),
  );
  assert.ok(html.includes('Rest 90 s'));
  assert.ok(html.includes('Add set'));
  assert.equal(count(html, 'aria-pressed='), 2, 'one ✓ per set');
  assert.match(html, /aria-label="Hide the sets of Bench press"/);
  assert.ok(html.includes('Remove set 1 of Bench press'), 'a card with more than one set can drop one');
  assert.ok(!html.includes('btn-primary'), 'no filled brand inside a card — Finish is the screen s one');
});

test('a finished card folds to one line with its set count and best set', () => {
  const html = render(
    h(parts.ExerciseCard, {
      exercise: exercise({ collapsed: true, sets: [set({ id: 'a', completed: true, reps: 8, weight: 60 }), set({ id: 'b', completed: true, reps: 6, weight: 65 })] }),
      unit: 'kg',
      onField: noop,
      onToggleSet: noop,
      onAddSet: noop,
      onRemoveSet: noop,
      onRest: noop,
      onCollapse: noop,
    }),
  );
  assert.ok(html.includes('2 sets · 65 kg × 6'));
  assert.equal(count(html, 'aria-pressed='), 0, 'the rows are away');
  assert.match(html, /aria-label="Show the sets of Bench press"/);
  assert.equal(parts.restLabel(0), 'Rest off');
  assert.equal(parts.restLabel(120), 'Rest 120 s');
});

/* ------------------------------------------------------------- rest dock */

test('the rest dock counts down in mm:ss with ±15 s and Skip, and stays at zero to say so', () => {
  const running = render(h(parts.RestDock, { remainingMs: 83_000, over: false, exerciseName: 'Bench press', onAdd: noop, onSkip: noop }));
  assert.ok(running.includes('1:23'));
  assert.ok(running.includes('Resting after Bench press'));
  assert.ok(running.includes('Skip'));
  assert.match(running, /aria-label="Add 15 seconds to the rest"/);
  assert.match(running, /aria-label="Take 15 seconds off the rest"/);
  assert.ok(running.includes('aria-live="polite"'), 'the clock is announced without stealing focus');
  assert.ok(running.includes('pb-nav'), 'the dock sits above the phone bottom nav');

  const over = render(h(parts.RestDock, { remainingMs: 0, over: true, exerciseName: 'Bench press', onAdd: noop, onSkip: noop }));
  assert.ok(over.includes('0:00'));
  assert.ok(over.includes('Rest done'));
  assert.ok(over.includes('Done'));
  assert.ok(!over.includes('+15 s'), 'nothing left to extend');
});

/* -------------------------------------------------------------- metrics */

test('the metric row never prints a zero and keeps one height whatever the numbers are', () => {
  const empty = parts.sessionMetrics({ elapsedMs: 0, volumeKg: 0, setCount: 0, unit: 'kg' });
  assert.deepEqual(empty.map((item) => item.value), [null, null, null]);
  const full = parts.sessionMetrics({ elapsedMs: 754_000, volumeKg: 1240, setCount: 12, unit: 'kg' });
  assert.deepEqual(full.map((item) => item.value), ['12:34', '1,240', '12']);
  assert.deepEqual(full.map((item) => item.label), ['duration', 'kg lifted', 'sets']);
  assert.equal(parts.sessionMetrics({ elapsedMs: 0, volumeKg: 0, setCount: 1, unit: 'lb' })[2].label, 'set');
  assert.equal(parts.sessionMetrics({ elapsedMs: 0, volumeKg: 100, setCount: 1, unit: 'lb' })[1].label, 'lb lifted');

  const html = render(h(parts.SessionMetrics, { items: empty }));
  assert.equal(count(html, '—'), 3, 'a missing number is an em dash, not a 0');
  assert.ok(!/>0</.test(html));
  assert.ok(html.includes('min-h-[76px]'), 'the strip is one fixed height, so nothing below it moves');
  assert.equal(count(html, 't-metric'), 3);
});

/* --------------------------------------------------------------- the recap */

const summary = {
  name: 'Push day',
  date: '2026-09-21T10:00:00.000Z',
  durationMin: 45,
  setCount: 9,
  volumeKg: 3240,
  unit: 'kg',
  exercises: [
    { exerciseId: 'bench-press', name: 'Bench press', setCount: 3, bestSet: { reps: 8, weightKg: 60 } },
    { exerciseId: 'custom-pull-up', name: 'Pull-up', setCount: 3, bestSet: { reps: 12, weightKg: 0 } },
  ],
};

test('the recap shows the triple, then one row per exercise with its best set', () => {
  const html = render(h(parts.SessionRecap, { summary }));
  assert.ok(html.includes('45:00'), 'the elapsed time reads as a clock');
  assert.ok(html.includes('3,240'));
  assert.ok(html.includes('>9<'));
  assert.equal(count(html, 't-metric'), 3);
  assert.ok(html.includes('Bench press'));
  assert.ok(html.includes('3 sets · '));
  assert.ok(html.includes('60 kg × 8'));
  assert.ok(html.includes('12 reps'), 'a card nobody loaded reads as reps, never 0 kg × 12');
  assert.match(html, /aria-label="Recap: Push day"/);
  assert.match(html, /aria-label="Exercises"/);
  assert.ok(!html.includes('btn-primary'), 'the recap carries no button: Log session is the form s');
});

test('a recap with nothing in it renders the strip and no exercise list', () => {
  const html = render(h(parts.SessionRecap, { summary: { ...summary, setCount: 0, volumeKg: 0, durationMin: 0, exercises: [] } }));
  assert.equal(count(html, '—'), 3);
  assert.ok(!html.includes('aria-label="Exercises"'));
});

/* ------------------------------------------------------- add an exercise */

test('the add field is the fallback for a movement the library does not have, and the picker is beside it', () => {
  const plain = render(h(parts.AddExerciseForm, { value: '', onChange: noop, onAdd: noop }));
  assert.match(plain, /aria-label="Add an exercise"|Add an exercise/);
  assert.ok(plain.includes('disabled'), 'Add is inert until something is typed');
  assert.ok(!plain.includes('Choose from library'), 'no picker, no button');
  const withPicker = render(h(parts.AddExerciseForm, { value: 'Back squat', onChange: noop, onAdd: noop, onPickExercise: noop }));
  assert.ok(withPicker.includes('Choose from library'));
  assert.match(withPicker, /value="Back squat"/);
});

/* ----------------------------------------------------------- the wiring */

test('the runner is a routed page on every width, outside the sheet list', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const SessionRunner = lazyPage\('\/workouts\/session', \(\) => import\('\.\/pages\/workouts\/session\/Runner'\)\);/);
  assert.match(app, /const SessionFinish = lazyPage\(null, \(\) => import\('\.\/pages\/workouts\/session\/Finish'\)\);/);
  assert.match(app, /<Route path="workouts\/session" element=\{<SessionRunner \/>\} \/>/);
  assert.match(app, /<Route path="workouts\/session\/finish" element=\{<SessionFinish \/>\} \/>/);
  // A sheet would put the session over the hub on desktop; it is the whole task.
  const sheets = app.slice(app.indexOf('const SHEET_ROUTES'), app.indexOf('/** Legacy paths that shipped in links'));
  assert.ok(!sheets.includes('workouts/session'), 'the runner is never a sheet route');

  const layout = read('src/components/Layout.tsx');
  assert.match(layout, /\{ pattern: '\/workouts\/session', title: 'Session', tab: 'workouts', nav: '\/workouts', parent: '\/workouts', hub: 'train' \}/);
  assert.match(layout, /\{ pattern: '\/workouts\/session\/finish', title: 'Session'/);
});

test('both session screens publish one h1 and exactly one filled brand button', () => {
  const runner = read('src/pages/workouts/session/Runner.tsx');
  assert.match(runner, /title="Session"/);
  assert.match(runner, /hideSectionTabs/);
  // Finish is the one filled brand, and it is published to both the desktop
  // header and the phone bar (the shell renders whichever fits).
  assert.equal((runner.match(/variant="primary"/g) || []).length, 1, 'one primary button, reused in both action slots');
  assert.match(runner, /disabled=\{!stats\.canFinish\}/);
  assert.match(runner, /mobileActions=\{/);
  assert.ok(!/<h1/.test(runner), 'the shell draws the one h1');

  const finish = read('src/pages/workouts/session/Finish.tsx');
  assert.match(finish, /title="Session"/);
  assert.ok(!/variant="primary"/.test(finish), 'the form s Log session is the recap screen s one filled brand');
  assert.ok(!/<h1/.test(finish));
});

test('the runner derives its clock and persists on every change rather than counting', () => {
  const runner = read('src/pages/workouts/session/Runner.tsx');
  assert.match(runner, /const now = useSessionClock\(Boolean\(session\)\);/);
  const store = read('src/pages/workouts/session/store.ts');
  assert.match(store, /document\.addEventListener\('visibilitychange', onVisible\);/);
  assert.match(store, /window\.addEventListener\('focus', tick\);/);
  assert.match(store, /const tick = \(\) => setNow\(Date\.now\(\)\);/, 'the tick reads the clock; it never increments a counter');
  // Every commit writes the draft, in one place.
  assert.match(store, /if \(session\) draft\.save\(session, nextRest\);/);
  assert.match(read('src/pages/workouts/session/draft.ts'), /export const DRAFT_KEY = 'vybe\.session\.draft';/);
});

test('the runner reads the PREVIOUS column one exerciseId at a time and treats a 404 as "not deployed"', () => {
  const runner = read('src/pages/workouts/session/Runner.tsx');
  assert.match(runner, /api\.get<PreviousBody>\('\/workouts\/records\/previous', \{ params: \{ exerciseId \} \}\)/);
  assert.match(runner, /retry: false/);
  assert.match(runner, /query\.isError \? 'unavailable'/);
});

test('the save is keyed and set-aware, and the recap pre-fills the form it sits above', () => {
  const finish = read('src/pages/workouts/session/Finish.tsx');
  assert.match(finish, /setRecordsVersion: 1/);
  assert.match(finish, /exercises: payloadExercises\(session\) as LogExercise\[\]/);
  assert.match(finish, /clientRequestId=\{session\.clientRequestId\}/);
  assert.match(finish, /queryKey: LOGS_KEY/);
  assert.match(finish, /queryKey: \['workout-progress'\]/);
  assert.match(finish, /queryKey: \['workouts'\]/);
  assert.match(finish, /toast\.success\('Session logged'\)/);
  assert.match(finish, /TRAIN\.session\(saved\._id\)/);
  const form = read('src/pages/workouts/SessionForm.tsx');
  assert.match(form, /\.\.\.\(!editing && clientRequestId && idempotent \? \{ clientRequestId \} : \{\}\)/);
});

test('every Start on the Train hub opens the runner; the post-hoc form stays reachable', async () => {
  const { TRAIN } = await import('../src/pages/workouts/sheet.ts');
  assert.equal(TRAIN.liveSession(), '/workouts/session');
  assert.equal(TRAIN.liveSession({ from: 'w1' }), '/workouts/session?from=w1');
  assert.equal(TRAIN.liveSession({ repeat: 'l1' }), '/workouts/session?repeat=l1');
  assert.equal(TRAIN.sessionFinish, '/workouts/session/finish');
  assert.equal(TRAIN.newSession({ from: 'w1' }), '/workouts/history/new?from=w1');

  const hub = read('src/pages/Workouts.tsx');
  assert.match(hub, /startTo=\{TRAIN\.liveSession\(\{ from: workout\._id \}\)\}/);
  assert.match(hub, /to=\{TRAIN\.liveSession\(\{ repeat: last\._id \}\)\}/);
  assert.match(hub, /label: 'Resume session', to: TRAIN\.liveSession\(\)/);
  assert.match(hub, /label: 'Start a session', to: TRAIN\.liveSession\(\)/);
  assert.match(hub, /to=\{TRAIN\.newSession\(\)\} state=\{sheetState\} variant="quiet">\s*Log a past session/);
  assert.match(hub, /<SessionResumeBar \/>/);
  assert.ok(!/TRAIN\.newSession\(\{ from: /.test(hub), 'the hub no longer seeds the post-hoc form from a workout');
  assert.match(read('src/pages/WorkoutHistory.tsx'), /<SessionResumeBar \/>/);
  assert.match(read('src/pages/WorkoutHistory.tsx'), /to=\{TRAIN\.newSession\(\)\}/);
});
