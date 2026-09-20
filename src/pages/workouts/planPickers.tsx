import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../../lib/api';
import { Badge, Button, EmptyState, ErrorState, Modal, SearchField, SkeletonRow, Stepper, cx, formatStat, humanize, useToast } from '../../components/ui';
import { Dumbbell, Layers, Plus } from '../../components/icons';
import { CoverArt } from './cards';
import { fetchMyPlans, fetchMyWorkoutsPage, fetchPremade, type PlanEnvelope, type SocialWorkout, type WorkoutPlan } from './model';
import { TRAIN } from './sheet';

/* Schedule pickers: "Add to plan" from a workout, "Add workout" from a plan. Both stay modals — they are choices, not places. */

export type ScheduleSlot = { week: number; day: number };

function SlotSteppers({ slot, weeks, onChange }: { slot: ScheduleSlot; weeks: number; onChange: (next: ScheduleSlot) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Stepper label="Week" value={slot.week} min={1} max={Math.max(1, weeks)} onChange={(week) => onChange({ ...slot, week })} />
      <Stepper label="Day" value={slot.day} min={1} max={7} onChange={(day) => onChange({ ...slot, day })} />
    </div>
  );
}

export async function addWorkoutToPlan(planId: string, workoutId: string, slot: ScheduleSlot): Promise<WorkoutPlan> {
  const { data } = await api.put<PlanEnvelope>(`/workouts/plans/add-workout/${planId}`, { workoutId, week: slot.week, day: slot.day });
  if (!data?.data?._id) throw new Error('The server did not confirm the change.');
  return data.data;
}

const rowClass = (selected: boolean) =>
  cx('flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors dur-1', selected ? 'border-text-1 bg-surface-2' : 'border-line bg-surface-1 hover:bg-surface-2');

/**
 * "Add to plan" from a workout: pick one of your plans, then the week and day.
 * Empty when you have no plans yet, with a way to create one.
 */
export function AddToPlanModal({ workout, onClose, onCreatePlan }: { workout: SocialWorkout | null; onClose: () => void; onCreatePlan?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [planId, setPlanId] = useState<string | null>(null);
  const [slot, setSlot] = useState<ScheduleSlot>({ week: 1, day: 1 });
  const [search, setSearch] = useState('');
  const open = Boolean(workout);

  useEffect(() => {
    if (!open) {
      setPlanId(null);
      setSlot({ week: 1, day: 1 });
      setSearch('');
    }
  }, [open]);

  const plans = useQuery({ queryKey: ['workouts', 'plans'], queryFn: fetchMyPlans, enabled: open });
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = plans.data ?? [];
    return q ? all.filter((p) => `${p.title} ${p.goal ?? ''}`.toLowerCase().includes(q)) : all;
  }, [plans.data, search]);
  const chosen = list.find((p) => p._id === planId) ?? (plans.data ?? []).find((p) => p._id === planId);
  const alreadyIn = Boolean(chosen && workout && (chosen.workouts ?? []).some((e) => e.workout?._id === workout._id));

  const add = useMutation({
    mutationFn: async () => {
      if (!workout || !planId) throw new Error('Pick a plan first.');
      return addWorkoutToPlan(planId, workout._id, slot);
    },
    onSuccess: (plan) => {
      qc.setQueryData<WorkoutPlan>(['workout-plan', plan._id], (old) => ({ ...(old ?? {}), ...plan }));
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      qc.invalidateQueries({ queryKey: ['workout-plan', plan._id] });
      toast.success(`Added to ${plan.title}, week ${slot.week} day ${slot.day}`, {
        action: { label: 'Open plan', onClick: () => navigate(TRAIN.plan(plan._id), { viewTransition: true }) },
      });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add this workout to the plan')),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to plan"
      description={workout ? `Schedule “${workout.title}” into one of your plans.` : undefined}
      footer={
        <>
          <Button type="button" variant="quiet" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={add.isPending} disabled={!planId || alreadyIn} onClick={() => add.mutate()} icon={<Plus size={18} />}>
            Add to plan
          </Button>
        </>
      }
    >
      {plans.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading your plans">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} className="rounded-md border border-line px-3" />
          ))}
        </div>
      ) : plans.isError ? (
        <ErrorState error={plans.error} title="Could not load your plans" onRetry={() => plans.refetch()} />
      ) : !(plans.data ?? []).length ? (
        <EmptyState
          size="sm"
          icon={<Layers size={26} />}
          title="No plans yet"
          message="Create a plan first, then schedule this workout into it."
          action={onCreatePlan ? { label: 'New plan', onClick: onCreatePlan, icon: <Plus size={18} /> } : { label: 'New plan', to: TRAIN.newPlan, icon: <Plus size={18} /> }}
        />
      ) : (
        <div className="space-y-4">
          {(plans.data ?? []).length > 5 ? (
            <SearchField label="Filter plans" hideLabel placeholder="Filter plans by name or goal" value={search} onChange={(e) => setSearch(e.target.value)} />
          ) : null}
          <ul className="max-h-64 space-y-1.5 overflow-y-auto" role="radiogroup" aria-label="Your plans">
            {list.map((p) => {
              const selected = p._id === planId;
              const sessions = (p.workouts ?? []).filter((e) => e.workout).length;
              return (
                <li key={p._id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setPlanId(p._id);
                      setSlot((s) => ({ ...s, week: Math.min(s.week, Math.max(1, p.durationWeeks ?? 52)) }));
                    }}
                    className={rowClass(selected)}
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">
                      <Layers size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text-1">{p.title}</span>
                      <span className="block truncate text-xs text-text-2">
                        {p.durationWeeks ? `${p.durationWeeks} ${p.durationWeeks === 1 ? 'week' : 'weeks'} · ` : ''}
                        {sessions} {sessions === 1 ? 'session' : 'sessions'}
                      </span>
                    </span>
                    {selected ? <Badge>Selected</Badge> : null}
                  </button>
                </li>
              );
            })}
            {list.length === 0 ? <li className="px-3 py-2 text-sm text-text-2">No plans match “{search.trim()}”.</li> : null}
          </ul>
          {chosen ? (
            alreadyIn ? (
              <p role="status" className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text-2">
                This workout is already in {chosen.title}.
              </p>
            ) : (
              <SlotSteppers slot={slot} weeks={chosen.durationWeeks ?? 52} onChange={setSlot} />
            )
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/**
 * "Add workout" from a plan: search your library and the premade catalogue,
 * pick a session, then the week and day.
 */
export function AddWorkoutPicker({ plan, open, onClose, onAdded }: { plan: WorkoutPlan; open: boolean; onClose: () => void; onAdded?: (plan: WorkoutPlan) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [slot, setSlot] = useState<ScheduleSlot>({ week: 1, day: 1 });

  useEffect(() => {
    if (!open) {
      setSearch('');
      setWorkoutId(null);
      setSlot({ week: 1, day: 1 });
    }
  }, [open]);

  const mine = useQuery({ queryKey: ['workouts', 'mine', 'picker'], queryFn: async () => (await fetchMyWorkoutsPage(1)).items, enabled: open });
  const premade = useQuery({ queryKey: ['workouts', 'premade'], queryFn: fetchPremade, enabled: open });

  const scheduled = new Set((plan.workouts ?? []).map((e) => e.workout?._id).filter(Boolean) as string[]);
  const q = search.trim().toLowerCase();
  const filter = (list: SocialWorkout[]) => list.filter((w) => !q || `${w.title} ${w.category} ${(w.hashtags ?? []).join(' ')}`.toLowerCase().includes(q));
  const groups: Array<{ label: string; items: SocialWorkout[] }> = [
    { label: 'Your workouts', items: filter(mine.data ?? []) },
    { label: 'Premade by Vybe', items: filter(premade.data ?? []) },
  ].filter((g) => g.items.length > 0);
  const chosen = [...(mine.data ?? []), ...(premade.data ?? [])].find((w) => w._id === workoutId);

  const add = useMutation({
    mutationFn: async () => {
      if (!workoutId) throw new Error('Pick a workout first.');
      return addWorkoutToPlan(plan._id, workoutId, slot);
    },
    onSuccess: (saved) => {
      qc.setQueryData<WorkoutPlan>(['workout-plan', plan._id], (old) => ({ ...(old ?? {}), ...saved }));
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      qc.invalidateQueries({ queryKey: ['workout-plan', plan._id] });
      toast.success(`${chosen?.title ?? 'Workout'} added to week ${slot.week}, day ${slot.day}`);
      onAdded?.(saved);
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add this workout to the plan')),
  });

  const loading = mine.isLoading || premade.isLoading;
  const error = mine.isError ? mine.error : premade.isError ? premade.error : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add workout"
      description={`Schedule a session into ${plan.title}.`}
      size="lg"
      footer={
        <>
          <Button type="button" variant="quiet" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={add.isPending} disabled={!workoutId} onClick={() => add.mutate()} icon={<Plus size={18} />}>
            Add to plan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SearchField label="Search workouts" hideLabel placeholder="Search your workouts and the premade catalogue" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading workouts">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} className="rounded-md border border-line px-3" />
            ))}
          </div>
        ) : error ? (
          <ErrorState
            error={error}
            title="Could not load workouts"
            onRetry={() => {
              mine.refetch();
              premade.refetch();
            }}
          />
        ) : groups.length === 0 ? (
          <EmptyState
            size="sm"
            variant={q ? 'no-results' : 'first-run'}
            icon={q ? undefined : <Dumbbell size={26} />}
            title={q ? `No workouts match “${search.trim()}”` : 'No workouts to add yet'}
            message={q ? 'Try another title, category or tag.' : 'Create a workout first, then schedule it here.'}
            action={q ? { label: 'Clear search', onClick: () => setSearch(''), variant: 'secondary' } : { label: 'New workout', to: TRAIN.newWorkout, icon: <Plus size={18} /> }}
          />
        ) : (
          <div className="max-h-72 space-y-3 overflow-y-auto pr-1" role="radiogroup" aria-label="Workouts">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="type-label mb-1.5 text-text-2">{g.label}</p>
                <ul className="space-y-1.5">
                  {g.items.map((w) => {
                    const selected = w._id === workoutId;
                    const inPlan = scheduled.has(w._id);
                    return (
                      <li key={w._id}>
                        <button type="button" role="radio" aria-checked={selected} disabled={inPlan} onClick={() => setWorkoutId(w._id)} className={cx(rowClass(selected), inPlan && 'cursor-not-allowed opacity-60')}>
                          <span className="h-10 w-14 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                            <CoverArt workout={w} compact />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-text-1">{w.title}</span>
                            <span className="block truncate text-xs text-text-2">
                              {humanize(w.category)}
                              {w.duration ? ` · ${formatStat(w.duration)} min` : ''}
                              {` · ${w.exercises?.length ?? 0} ${(w.exercises?.length ?? 0) === 1 ? 'exercise' : 'exercises'}`}
                            </span>
                          </span>
                          {inPlan ? <Badge>In plan</Badge> : selected ? <Badge>Selected</Badge> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {chosen ? <SlotSteppers slot={slot} weeks={plan.durationWeeks ?? 52} onChange={setSlot} /> : null}
      </div>
    </Modal>
  );
}
