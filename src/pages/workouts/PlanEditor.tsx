import { useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../../lib/api';
import { Button, Checkbox, ErrorState, Input, Select, Skeleton, Stepper, Textarea, useToast } from '../../components/ui';
import { RouteSheet } from '../../components/RouteSheet';
import { LEVEL_OPTIONS, fetchPlan, type PlanEnvelope, type WorkoutPlan } from './model';
import { TRAIN, useSheetClose } from './sheet';

/**
 * /workouts/plans/new and /workouts/plans/:planId/edit — create a plan, or
 * edit its name, goal, description, level, length and visibility. Sessions
 * are scheduled from the plan page itself.
 */

function PlanForm({ editing, onDone }: { editing: WorkoutPlan | null; onDone: (saved: WorkoutPlan) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const close = useSheetClose(editing ? TRAIN.plan(editing._id) : TRAIN.tab('plans'));
  const [name, setName] = useState(editing?.title ?? '');
  const [goal, setGoal] = useState(editing?.goal ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [level, setLevel] = useState<string>(editing?.level ?? 'beginner');
  const [weeks, setWeeks] = useState(editing?.durationWeeks ?? 4);
  const [isPublic, setIsPublic] = useState(editing?.isPublic ?? true);
  const [errors, setErrors] = useState<{ name?: string; goal?: string }>({});

  const mutation = useMutation({
    mutationFn: async () => {
      const next: typeof errors = {};
      if (!name.trim()) next.name = 'Give the plan a name.';
      if (!goal.trim()) next.goal = 'Say what the plan is for.';
      setErrors(next);
      if (next.name || next.goal) throw Object.assign(new Error('validation'), { silent: true });
      const payload = {
        name: name.trim(),
        goal: goal.trim(),
        description: description.trim() || undefined,
        level,
        duration: Math.max(1, weeks),
        isPublic,
      };
      const { data } = editing
        ? await api.put<PlanEnvelope>(`/workouts/update-plan/${editing._id}`, payload)
        : await api.post<PlanEnvelope>('/workouts/create-plan', { ...payload, workouts: [] });
      if (!data?.data?._id) throw new Error('The server did not confirm the save.');
      return data.data;
    },
    onSuccess: (plan) => {
      toast.success(editing ? 'Plan saved' : 'Plan created');
      if (editing) qc.setQueryData<WorkoutPlan>(['workout-plan', editing._id], (old) => (old ? { ...old, ...plan, workouts: old.workouts } : plan));
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      if (editing) qc.invalidateQueries({ queryKey: ['workout-plan', editing._id] });
      onDone(plan);
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) return;
      toast.error(errMsg(e, editing ? 'Could not save plan' : 'Could not create plan'));
    },
  });

  return (
    <form
      id={formId}
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      {editing ? null : <p className="text-sm text-text-2">Group workouts into a multi-week programme.</p>}
      <Input
        label="Name"
        placeholder="e.g. 8-week strength block"
        autoComplete="off"
        required
        value={name}
        error={errors.name}
        onChange={(e) => {
          setName(e.target.value);
          if (errors.name) setErrors((er) => ({ ...er, name: undefined }));
        }}
      />
      <Input
        label="Goal"
        placeholder="e.g. Build a bigger squat"
        autoComplete="off"
        required
        value={goal}
        error={errors.goal}
        onChange={(e) => {
          setGoal(e.target.value);
          if (errors.goal) setErrors((er) => ({ ...er, goal: undefined }));
        }}
      />
      <Textarea label="Description" hint="Optional." rows={2} autoGrow maxRows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Level" options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
        <Stepper label="Length" value={weeks} min={1} max={52} unit={weeks === 1 ? 'week' : 'weeks'} onChange={setWeeks} />
      </div>
      <Checkbox checked={isPublic} onChange={setIsPublic} label="Share publicly" description="Anyone on Vybe can follow this plan." />
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="quiet" onClick={close} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" form={formId} variant="primary" loading={mutation.isPending}>
          {editing ? 'Save changes' : 'Create plan'}
        </Button>
      </div>
    </form>
  );
}

export default function PlanEditor() {
  const { planId } = useParams();
  const editing = Boolean(planId);
  const close = useSheetClose(planId ? TRAIN.plan(planId) : TRAIN.tab('plans'));
  const plan = useQuery({ queryKey: ['workout-plan', planId], queryFn: () => fetchPlan(planId!), enabled: editing });
  return (
    <RouteSheet title={editing ? 'Edit plan' : 'New plan'} onClose={close}>
      {editing && plan.isLoading ? (
        <div className="space-y-5" aria-busy="true" aria-label="Loading plan">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : editing && (plan.isError || !plan.data) ? (
        <ErrorState error={plan.error} title="Plan not found" message="It may have been deleted or made private." onRetry={() => plan.refetch()} />
      ) : (
        <PlanForm key={plan.data?._id ?? 'new'} editing={plan.data ?? null} onDone={() => close()} />
      )}
    </RouteSheet>
  );
}
