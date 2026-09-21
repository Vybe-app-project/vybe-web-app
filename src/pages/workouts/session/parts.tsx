import type { ReactNode } from 'react';
import { Button, IconButton, Input, Menu, cx, formatStat, hasMetric, type MenuItem } from '../../../components/ui';
import { Check, CheckCircle, ChevronDown, ChevronUp, Clock, Minus, Plus, Timer } from '../../../components/icons';
import {
  REST_PRESETS,
  bestSetOf,
  formatBestSetKg,
  formatElapsed,
  formatGhost,
  formatRestClock,
  formatVolume,
  isExerciseFinished,
} from './math';
import type { SessionExercise, SessionSet, SessionSummary, WeightUnit } from './types';

/**
 * The runner's and the recap's pieces, from props alone — no store, no query
 * hook — so they render under react-dom/server in
 * tests/session-runner.render.test.mjs and the page files hold only wiring.
 *
 * The register: white surfaces and hairlines, `.t-*` roles, no colour that
 * does not mean something. A completed set is a `bg-surface-2` wash and a
 * filled check glyph rather than a green row (Vybe has no green), and the one
 * filled `--brand` on the screen is Finish, drawn by the shell header.
 */

/* ------------------------------------------------------------- the metrics */

export type SessionMetric = { key: string; label: string; value: string | null };

/**
 * Duration · Volume · Sets. A value that is not there shows "—", never a
 * zero: "0 kg" on a bodyweight session is a hole, not a fact. The row is one
 * fixed height, so nothing below it moves as the numbers arrive.
 */
export function SessionMetrics({ items, 'aria-label': ariaLabel = 'This session' }: { items: SessionMetric[]; 'aria-label'?: string }) {
  return (
    <ul
      aria-label={ariaLabel}
      data-testid="session-metrics"
      className="card grid min-h-[76px] divide-x divide-line"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-center">
          {/* A number that is not there takes StatStrip's treatment, not the
              hero size: an em dash at 30 px reads as a redaction. The cell
              keeps its height either way, so nothing below it moves. */}
          {item.value === null ? (
            <span className="t-meta block max-w-full truncate text-text-3">—</span>
          ) : (
            <span className="t-metric block max-w-full truncate">{item.value}</span>
          )}
          <span className="type-label block max-w-full truncate text-text-2">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** The three numbers the header strip and the recap both quote. */
export function sessionMetrics(input: { elapsedMs: number; volumeKg: number; setCount: number; unit: WeightUnit }): SessionMetric[] {
  return [
    // Under a second there is no duration to report: "0:00" is a zero, and
    // the register has no zeros. The cell keeps its height either way.
    { key: 'duration', label: 'duration', value: input.elapsedMs >= 1000 ? formatElapsed(input.elapsedMs) : null },
    { key: 'volume', label: `${input.unit} lifted`, value: hasMetric(input.volumeKg) ? formatVolume(input.volumeKg, input.unit).replace(` ${input.unit}`, '') : null },
    { key: 'sets', label: input.setCount === 1 ? 'set' : 'sets', value: hasMetric(input.setCount) ? formatStat(input.setCount) : null },
  ];
}

/* ------------------------------------------------------------- the set table */

/**
 * Column widths shared by the header and every row, so the table lines up.
 * The last column is 44 px in pixels, not rem: the ✓ is `w-11` off the 4 px
 * spacing scale (44 px), while 2.75rem on this 15 px root is 41 px — three
 * pixels the button spilled over the reps field at 390 px.
 */
const SET_GRID = 'grid grid-cols-[28px_minmax(3.5rem,1fr)_minmax(0,1fr)_minmax(0,1fr)_44px] items-center gap-2';

export function SetTableHeader({ unit }: { unit: WeightUnit }) {
  return (
    <div className={cx(SET_GRID, 'border-b border-line pb-1.5')} aria-hidden="true">
      <span className="type-label text-text-3">Set</span>
      <span className="type-label text-text-3">Previous</span>
      <span className="type-label text-text-3">{unit}</span>
      <span className="type-label text-text-3">Reps</span>
      <span className="type-label text-center text-text-3">Done</span>
    </div>
  );
}

/**
 * One set: number chip · the PREVIOUS ghost · weight · reps · ✓. The two
 * fields carry the ghost as their placeholder, so a lifter repeating last
 * session's numbers types nothing and taps ✓ once — the store commits the
 * placeholders for every field still empty.
 */
export function SetRow({
  index,
  set,
  unit,
  exerciseName,
  onField,
  onToggle,
}: {
  index: number;
  set: SessionSet;
  unit: WeightUnit;
  exerciseName: string;
  onField: (field: 'weight' | 'reps', text: string) => void;
  onToggle: () => void;
}) {
  const ghost = formatGhost(set.previous, unit);
  const previousWeight = set.previous && set.previous.weight > 0 ? String(set.previous.weight) : '';
  const previousReps = set.previous ? String(set.previous.reps) : '';
  const name = `set ${index + 1} of ${exerciseName}`;
  return (
    <li className={cx(SET_GRID, 'rounded-sm py-1.5 transition-colors dur-1', set.completed && 'bg-surface-2')}>
      <span className="t-meta tabular text-center text-text-2" aria-hidden="true">
        {index + 1}
      </span>
      <span className="t-meta tabular truncate" title={ghost || undefined}>
        {ghost || '—'}
      </span>
      <Input
        label={`Weight for ${name}`}
        hideLabel
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="next"
        className="tabular text-center"
        placeholder={previousWeight || '0'}
        value={set.weight === null ? '' : String(set.weight)}
        onChange={(e) => onField('weight', e.target.value)}
      />
      <Input
        label={`Reps for ${name}`}
        hideLabel
        type="text"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        className="tabular text-center"
        placeholder={previousReps || '0'}
        value={set.reps === null ? '' : String(set.reps)}
        onChange={(e) => onField('reps', e.target.value)}
      />
      <button
        type="button"
        aria-pressed={set.completed}
        aria-label={`Mark ${name} done`}
        onClick={onToggle}
        className={cx(
          'pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm transition-colors dur-1',
          set.completed ? 'text-text-1' : 'border border-control bg-surface-2 text-text-3 hover:text-text-1',
        )}
      >
        {set.completed ? <CheckCircle size={22} /> : <Check size={20} />}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------ the rest chip */

export const restLabel = (seconds: number): string => (seconds > 0 ? `Rest ${seconds} s` : 'Rest off');

/** The card's rest, as a quiet chip with a small menu behind it. */
export function RestChip({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  const items: MenuItem[] = REST_PRESETS.map((preset) => ({
    key: String(preset),
    label: preset > 0 ? `${preset} s` : 'Off',
    onSelect: () => onChange(preset),
  }));
  return (
    <Menu
      items={items}
      label={`Rest between sets — ${restLabel(seconds)}`}
      trigger={() => (
        <span className="pressable inline-flex min-h-8 items-center gap-1 rounded-xs border border-line bg-surface-2 px-2 text-xs font-medium text-text-2">
          <Timer size={14} aria-hidden="true" />
          {restLabel(seconds)}
        </span>
      )}
      triggerClassName="shrink-0"
    />
  );
}

/* ------------------------------------------------------------ the exercise card */

/**
 * One exercise. Open it is a name, a rest chip, the set table and "Add set";
 * finished (every set checked) it folds to one line — "3 sets · 60 kg × 8" —
 * with a chevron to reopen, so a long session stays readable on a phone.
 */
export function ExerciseCard({
  exercise,
  unit,
  onField,
  onToggleSet,
  onAddSet,
  onRemoveLastSet,
  onRest,
  onCollapse,
  menu,
}: {
  exercise: SessionExercise;
  unit: WeightUnit;
  onField: (setId: string, field: 'weight' | 'reps', text: string) => void;
  onToggleSet: (setId: string) => void;
  onAddSet: () => void;
  /** The exact inverse of "Add set", which always appends: nobody loses the wrong row. */
  onRemoveLastSet: () => void;
  onRest: (seconds: number) => void;
  onCollapse: () => void;
  menu?: MenuItem[];
}) {
  const done = exercise.sets.filter((set) => set.completed).length;
  const finished = isExerciseFinished(exercise);
  const best = formatBestSetKg(bestSetOf(exercise), unit);
  const collapsed = Boolean(exercise.collapsed);
  const summary = [done ? `${formatStat(done)} ${done === 1 ? 'set' : 'sets'}` : null, best || null].filter(Boolean).join(' · ');

  return (
    <section className="card @container p-3 sm:p-4" aria-label={exercise.name} data-finished={finished || undefined}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="t-name truncate text-text-1">{exercise.name}</h3>
          {collapsed ? (
            <p className="t-meta tabular truncate">{summary || 'No sets yet'}</p>
          ) : (
            <div className="mt-1.5">
              <RestChip seconds={exercise.restSeconds} onChange={onRest} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          {menu?.length ? <Menu items={menu} label={`More options for ${exercise.name}`} /> : null}
          <IconButton label={collapsed ? `Show the sets of ${exercise.name}` : `Hide the sets of ${exercise.name}`} onClick={onCollapse}>
            {collapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </IconButton>
        </div>
      </div>

      {collapsed ? null : (
        <div className="mt-2 space-y-1.5">
          <SetTableHeader unit={unit} />
          <ul className="space-y-1">
            {exercise.sets.map((set, index) => (
              <SetRow
                key={set.id}
                index={index}
                set={set}
                unit={unit}
                exerciseName={exercise.name}
                onField={(field, text) => onField(set.id, field, text)}
                onToggle={() => onToggleSet(set.id)}
              />
            ))}
          </ul>
          {exercise.sets.length === 0 ? <p className="t-body text-text-2">No sets. Add one, or remove the exercise.</p> : null}
          <div className="flex items-center gap-1">
            <Button type="button" variant="quiet" size="sm" icon={<Plus size={16} />} onClick={onAddSet}>
              Add set
            </Button>
            {exercise.sets.length > 1 ? (
              <Button type="button" variant="quiet" size="sm" icon={<Minus size={16} />} aria-label={`Remove the last set of ${exercise.name}`} onClick={onRemoveLastSet}>
                Remove set
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- the dock */

/**
 * The rest countdown. There are no notifications on the web, so this is the
 * only place a rest is announced: a fixed bar above the phone's bottom nav,
 * with ±15 s and Skip. `aria-live="polite"` on the clock means a screen
 * reader hears it without the page stealing focus.
 */
export function RestDock({
  remainingMs,
  over,
  exerciseName,
  onAdd,
  onSkip,
}: {
  remainingMs: number;
  /** The countdown has reached zero: the dock stays, because this is the only signal there is. */
  over: boolean;
  exerciseName: string;
  onAdd: (deltaSec: number) => void;
  onSkip: () => void;
}) {
  return (
    <div data-testid="rest-dock" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-gutter pb-nav lg:pb-4">
      <div className="pointer-events-auto mx-auto flex max-w-form items-center gap-2 rounded-lg border border-line bg-surface-1 p-2 shadow-1">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2" aria-hidden="true">
          <Clock size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="t-name tabular text-text-1" aria-live="polite">
            {formatRestClock(remainingMs)}
          </p>
          <p className="t-meta truncate">{over ? `Rest done — next set of ${exerciseName}` : `Resting after ${exerciseName}`}</p>
        </div>
        {over ? null : (
          <>
            <Button type="button" variant="quiet" size="sm" aria-label="Take 15 seconds off the rest" onClick={() => onAdd(-15)}>
              −15 s
            </Button>
            <Button type="button" variant="quiet" size="sm" aria-label="Add 15 seconds to the rest" onClick={() => onAdd(15)}>
              +15 s
            </Button>
          </>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={onSkip}>
          {over ? 'Done' : 'Skip'}
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- add an exercise */

/**
 * The bottom of the runner: a free-text name and Add. `onPickExercise` is the
 * seam for the exercise-library picker being built in parallel
 * (`src/pages/workouts/ExercisePicker.tsx`, p2-web) — pass it and the quiet
 * "Choose from library" action appears beside the field, which stays as the
 * way to log a movement the library does not have.
 */
export function AddExerciseForm({
  value,
  onChange,
  onAdd,
  onPickExercise,
  inputRef,
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onAdd: () => void;
  onPickExercise?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
}) {
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd();
      }}
    >
      <div className="flex items-end gap-2">
        <Input
          ref={inputRef}
          label="Add an exercise"
          hideLabel
          containerClassName="flex-1"
          placeholder="e.g. back squat"
          autoComplete="off"
          enterKeyHint="done"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="submit" variant="secondary" icon={<Plus size={18} />} disabled={!value.trim()}>
          Add
        </Button>
      </div>
      {/* The picker on its own quiet line: on a 390 px phone it and Add
          together left the field about 100 px wide. */}
      {onPickExercise ? (
        <Button type="button" variant="quiet" size="sm" onClick={onPickExercise}>
          Choose from library
        </Button>
      ) : null}
    </form>
  );
}

/* -------------------------------------------------------------- the recap */

/**
 * The recap: the session's three numbers, then one row per exercise with the
 * anatomy the shared workout card uses (`src/pages/WorkoutSummaryCard.tsx`) —
 * name on the left, "3 sets · 60 kg × 8" on the right. A sibling rather than
 * that component because the card renders a server-built post snapshot
 * (`WorkoutSummary`, keyed on a `workoutId`) and this session has not been
 * saved yet; the numbers come from the same formatters.
 */
export function SessionRecap({ summary, children }: { summary: SessionSummary; children?: ReactNode }) {
  const metrics = sessionMetrics({
    elapsedMs: summary.durationMin * 60_000,
    volumeKg: summary.volumeKg,
    setCount: summary.setCount,
    unit: summary.unit,
  });
  return (
    <section className="space-y-3" aria-label={`Recap: ${summary.name}`} data-testid="session-recap">
      <SessionMetrics items={metrics} aria-label="Session totals" />
      {summary.exercises.length ? (
        <ol className="divide-y divide-line" aria-label="Exercises">
          {summary.exercises.map((exercise) => {
            const best = formatBestSetKg(exercise.bestSet, summary.unit);
            return (
              <li key={exercise.exerciseId} className="flex items-center justify-between gap-3 py-2">
                <span className="t-body min-w-0 truncate text-text-1">{exercise.name}</span>
                <span className="t-meta tabular shrink-0 whitespace-nowrap">
                  {`${formatStat(exercise.setCount)} ${exercise.setCount === 1 ? 'set' : 'sets'}${best ? ' · ' : ''}`}
                  {best ? <span className="font-semibold text-text-1">{best}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {children}
    </section>
  );
}
