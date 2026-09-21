import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useUnits } from '../../../lib/units';
import { Button, ConfirmDialog, Menu, PageHeader, Skeleton, useToast, type MenuItem } from '../../../components/ui';
import { Trash } from '../../../components/icons';
import { ExercisePicker, type ExercisePick } from '../ExercisePicker';
import { fetchWorkout, type SocialWorkout } from '../model';
import { fetchLog, type WorkoutLog } from '../sessions';
import { TRAIN } from '../sheet';
import { AddExerciseForm, ExerciseCard, RestDock, SessionMetrics, sessionMetrics } from './parts';
import { restStats, sessionStats, useSessionClock, useSessionStore } from './store';
import { canFinish, weightUnitFor } from './math';
import type { PreviousSet, SessionSeed, WeightUnit } from './types';

/**
 * `/workouts/session` — the live session. A page on every width, not a
 * sheet: this is the whole task for the next forty minutes, not a detail
 * over something else.
 *
 * Three web-specific rules shape it. A hidden tab throttles timers, so the
 * duration is `now − startedAt` read off a 1 s tick that is corrected
 * whenever the tab comes back. There are no notifications, so the rest
 * countdown lives on screen in a fixed dock and nowhere else. And a tab can
 * be closed or reloaded without anyone deciding to, so every change is
 * mirrored to a `localStorage` draft and a reload resumes the same session —
 * same elapsed origin, same rest deadline.
 *
 * `?from=<workoutId>` seeds from a library workout, `?repeat=<logId>` from a
 * past session, and no parameter starts empty with the add field focused. A
 * draft that is already open always wins: sets nobody typed are cheap, sets
 * somebody typed are not.
 */

const seedFromWorkout = (w: SocialWorkout): SessionSeed => ({
  name: w.title,
  type: w.category,
  workoutId: w._id,
  exercises: (w.exercises ?? []).map((e) => ({ name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, rest: e.rest, notes: e.notes })),
});

/** The same session again, live. A set-aware log hands over its own sets; the store gives them new ids. */
const seedFromLog = (log: WorkoutLog): SessionSeed => ({
  name: log.name,
  type: log.type,
  workoutId: null,
  exercises: (log.exercises ?? []).map((e) => ({
    name: e.name,
    exerciseId: e.exerciseId,
    sets: e.sets,
    reps: e.reps,
    weight: e.weight,
    weightUnit: e.weightUnit,
    notes: e.notes,
    setRecords: e.setRecords,
  })),
});

/** How many exercises' PREVIOUS columns are read at once; one request each (the route takes one id). */
const PREVIOUS_LIMIT = 12;

type PreviousBody = { previous?: { sets?: Array<{ reps?: number; weight?: number; weightUnit?: string; synthetic?: boolean }> } | null };

/**
 * Last session's sets for one exercise. `GET /workouts/records/previous`
 * takes exactly one `exerciseId` (controllers/workoutRecordsController.js
 * `exactlyOne`), so this is one request per card. `retry: false`: a 404 here
 * is the feature detection — the route is not deployed everywhere yet — not
 * a flake, and the column simply shows nothing.
 */
async function fetchPrevious(exerciseId: string): Promise<PreviousSet[]> {
  const { data } = await api.get<PreviousBody>('/workouts/records/previous', { params: { exerciseId } });
  return (data.previous?.sets ?? [])
    .filter((set) => typeof set.reps === 'number')
    .map((set) => ({
      reps: Math.max(0, Math.round(set.reps as number)),
      weight: typeof set.weight === 'number' && set.weight > 0 ? set.weight : 0,
      weightUnit: (set.weightUnit === 'lb' ? 'lb' : 'kg') as WeightUnit,
      ...(set.synthetic ? { synthetic: true as const } : {}),
    }));
}

/** The seed skeleton: the metric row and two cards at their final size. */
function SeedSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Preparing your session">
      <Skeleton className="h-[76px] w-full rounded-lg" />
      <Skeleton className="h-52 w-full rounded-lg" />
      <Skeleton className="h-52 w-full rounded-lg" />
    </div>
  );
}

export default function Runner() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const system = useUnits((s) => s.system);
  const unit = weightUnitFor(system);

  const session = useSessionStore((s) => s.session);
  const rest = useSessionStore((s) => s.rest);
  const start = useSessionStore((s) => s.start);
  const setPrevious = useSessionStore((s) => s.setPrevious);
  const store = useSessionStore.getState;

  const [name, setName] = useState('');
  const [picking, setPicking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const fromId = params.get('from');
  const repeatId = params.get('repeat');
  const from = useQuery({ queryKey: ['workout', fromId], queryFn: () => fetchWorkout(fromId as string), enabled: Boolean(fromId) && !session, retry: false });
  const repeat = useQuery({ queryKey: ['workout-log', repeatId], queryFn: () => fetchLog(repeatId as string), enabled: Boolean(repeatId) && !session, retry: false });

  /**
   * Starting, once. A draft already open wins over a seed in the URL — it
   * holds sets somebody typed — and the parameters are dropped so a reload
   * does not try again. Otherwise the seed is awaited, and a seed that cannot
   * be read still opens an empty session rather than a dead end.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (session) {
      started.current = true;
      if (fromId || repeatId) {
        setParams(new URLSearchParams(), { replace: true });
        toast.info('You already had a session open.');
      }
      return;
    }
    if (fromId && from.isPending) return;
    if (repeatId && repeat.isPending) return;
    started.current = true;
    const seed = from.data ? seedFromWorkout(from.data) : repeat.data ? seedFromLog(repeat.data) : null;
    start({ from: seed, unit });
    if ((fromId || repeatId) && !seed) toast.error('Could not load that workout. Add your exercises to start.');
    if (fromId || repeatId) setParams(new URLSearchParams(), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, fromId, repeatId, from.isPending, from.data, repeat.isPending, repeat.data, unit]);

  /* The PREVIOUS column: one request per card, in first-appearance order. */
  const exerciseIds = useMemo(() => {
    const ids: string[] = [];
    for (const exercise of session?.exercises ?? []) if (!ids.includes(exercise.exerciseId)) ids.push(exercise.exerciseId);
    return ids.slice(0, PREVIOUS_LIMIT);
  }, [session?.exercises]);

  const previousQueries = useQueries({
    queries: exerciseIds.map((exerciseId) => ({
      queryKey: ['workout-previous', exerciseId],
      queryFn: () => fetchPrevious(exerciseId),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });

  // The answers are pushed into the store (they are part of the session's
  // rows, not of this render), guarded on the reference so the write happens
  // once per answer rather than once per render.
  const pushed = useRef(new Map<string, unknown>());
  useEffect(() => {
    exerciseIds.forEach((exerciseId, index) => {
      const query = previousQueries[index];
      if (!query) return;
      const answer = query.isPending ? 'loading' : query.isError ? 'unavailable' : (query.data ?? 'unavailable');
      if (pushed.current.get(exerciseId) === answer) return;
      pushed.current.set(exerciseId, answer);
      setPrevious(exerciseId, answer as never);
    });
  });

  const now = useSessionClock(Boolean(session));
  const stats = sessionStats(session, now);
  const dock = restStats(rest, now);
  const metrics = sessionMetrics({ elapsedMs: stats.elapsedMs, volumeKg: stats.volumeKg, setCount: stats.setCount, unit: session?.unit ?? unit });
  const restingIn = rest ? session?.exercises.find((exercise) => exercise.key === rest.exerciseKey)?.name ?? 'that exercise' : '';

  const add = (pickName: string, exerciseId?: string | null) => {
    if (!pickName.trim()) return;
    store().addExercise(pickName, exerciseId);
    setName('');
    addRef.current?.focus();
  };

  const onPick = (pick: ExercisePick) => {
    setPicking(false);
    add(pick.name, pick.exerciseId);
  };

  const onFinish = () => {
    if (!store().finish()) return;
    navigate(TRAIN.sessionFinish, { viewTransition: true });
  };

  const menu: MenuItem[] = [
    { label: 'Log a past session', description: 'The old form: name, duration and totals', to: TRAIN.newSession() },
    { label: 'Discard session', icon: <Trash size={18} />, onSelect: () => setDiscarding(true), danger: true, divider: true },
  ];
  const finish = (
    <Button variant="primary" disabled={!stats.canFinish} onClick={onFinish}>
      Finish
    </Button>
  );

  const waiting = !session;

  return (
    <div className="space-y-4 lg:max-w-form">
      <PageHeader
        title="Session"
        back={TRAIN.hub}
        hideSectionTabs
        actions={
          <>
            <Menu items={menu} label="Session options" />
            {finish}
          </>
        }
        mobileActions={
          <>
            <Menu items={menu} label="Session options" />
            {finish}
          </>
        }
      />

      {waiting ? (
        <SeedSkeleton />
      ) : (
        <>
          <SessionMetrics items={metrics} />
          {session.exercises.length > 0 && !canFinish(session) ? <p className="t-meta">Check a set to finish this session.</p> : null}

          {session.exercises.length === 0 ? (
            <p className="t-body text-text-2">Add an exercise to begin.</p>
          ) : (
            <div className="space-y-3">
              {session.exercises.map((exercise) => (
                <ExerciseCard
                  key={exercise.key}
                  exercise={exercise}
                  unit={session.unit}
                  onField={(setId, field, text) => store().setField(setId, field, text)}
                  onToggleSet={(setId) => store().toggleSet(setId)}
                  onAddSet={() => store().addSet(exercise.key)}
                  onRemoveLastSet={() => {
                    const last = exercise.sets[exercise.sets.length - 1];
                    if (last) store().removeSet(exercise.key, last.id);
                  }}
                  onRest={(seconds) => store().setRest(exercise.key, seconds)}
                  onCollapse={() => store().toggleCollapsed(exercise.key)}
                  menu={[{ label: 'Remove exercise', icon: <Trash size={18} />, onSelect: () => store().removeExercise(exercise.key), danger: true }]}
                />
              ))}
            </div>
          )}

          <AddExerciseForm
            value={name}
            inputRef={addRef}
            autoFocus={session.exercises.length === 0}
            onChange={setName}
            onAdd={() => add(name)}
            onPickExercise={() => setPicking(true)}
          />
        </>
      )}

      {dock ? (
        <>
          {/* The dock is fixed, so the page ends with room for it rather than under it. */}
          <div aria-hidden="true" className="h-16" />
          <RestDock
            remainingMs={dock.remainingMs}
            over={dock.over}
            exerciseName={restingIn}
            onAdd={(delta) => store().addRest(delta)}
            onSkip={() => store().skipRest()}
          />
        </>
      ) : null}

      <ExercisePicker open={picking} initialQuery={name} onClose={() => setPicking(false)} onSelect={onPick} />

      <ConfirmDialog
        open={discarding}
        title="Discard this session?"
        message="The sets you have logged here will be gone. Nothing is saved to your history."
        confirmLabel="Discard"
        destructive
        onCancel={() => setDiscarding(false)}
        onConfirm={() => {
          store().discard();
          setDiscarding(false);
          navigate(TRAIN.hub, { replace: true, viewTransition: true });
        }}
      />
    </div>
  );
}
