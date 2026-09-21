import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Menu,
  Section,
  Skeleton,
  SkeletonRow,
  SkeletonText,
  formatStat,
  humanize,
  useToast,
} from './ui';
import { Activity, Clock, Dumbbell, Flame, Layers, Plus, Trash } from './icons';
import { RouteSheet } from '../components/RouteSheet';
import { planMenu } from './Workouts';
import { LikeButton, MetaList } from './workouts/cards';
import { fetchPlan, type PlanEntry, type WorkoutPlan } from './workouts/model';
import { AddWorkoutPicker } from './workouts/planPickers';
import { TRAIN, useSheetClose, useSheetNav } from './workouts/sheet';

type PlanEnvelope = { success?: boolean; data?: WorkoutPlan };

function PlanSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading plan">
      <Card className="space-y-3">
        <SkeletonText lines={2} />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-xs" />
          <Skeleton className="h-6 w-24 rounded-xs" />
        </div>
      </Card>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} padded={false} className="px-4">
            <SkeletonRow />
          </Card>
        ))}
      </div>
    </div>
  );
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayLabel = (day: number) => (day >= 1 && day <= 7 ? `Day ${day} · ${DAY_NAMES[day - 1]}` : `Day ${day}`);

/**
 * /workouts/plans/:planId — a workout plan, week by week, as a sheet over the
 * page that opened it. Owners schedule sessions into a week and day here and
 * take them out again; renaming and the length live at /workouts/plans/:planId/edit.
 */
export default function WorkoutPlanDetail() {
  const { planId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { open, state } = useSheetNav();
  const close = useSheetClose(TRAIN.tab('plans'));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<PlanEntry | null>(null);

  const queryKey = ['workout-plan', planId];
  const { data: plan, isLoading, isError, error, refetch } = useQuery({ queryKey, queryFn: () => fetchPlan(planId), enabled: Boolean(planId) });

  const isOwn = Boolean(user && plan?.createdBy && plan.createdBy._id === user._id);
  const liked = Boolean(user && (plan?.likes ?? []).some((id) => String(id) === user._id));

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.put(`/workouts/interaction/plan/${planId}/like`);
      return data as { isLiked: boolean; likesCount: number };
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<WorkoutPlan>(queryKey);
      if (previous && user) {
        qc.setQueryData<WorkoutPlan>(queryKey, {
          ...previous,
          likes: liked ? (previous.likes ?? []).filter((id) => String(id) !== user._id) : [...(previous.likes ?? []), user._id],
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error(errMsg(e, 'Could not update like'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const removeEntry = useMutation({
    mutationFn: async (entry: PlanEntry) => {
      const workoutId = entry.workout?._id;
      if (!workoutId) throw new Error('This session is no longer available.');
      const { data } = await api.delete<PlanEnvelope>(`/workouts/plans/${planId}/workouts/${workoutId}`);
      return data?.data;
    },
    onMutate: async (entry) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<WorkoutPlan>(queryKey);
      if (previous) {
        qc.setQueryData<WorkoutPlan>(queryKey, {
          ...previous,
          workouts: (previous.workouts ?? []).filter((e) => e.workout?._id !== entry.workout?._id),
        });
      }
      return { previous };
    },
    onSuccess: (saved, entry) => {
      toast.success(`${entry.workout?.title ?? 'Session'} removed from the plan`);
      if (saved) qc.setQueryData<WorkoutPlan>(queryKey, (old) => ({ ...(old ?? {}), ...saved }));
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
    },
    onError: (e, _entry, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error(errMsg(e, 'Could not remove this session'));
    },
    onSettled: () => {
      setPendingRemove(null);
      qc.invalidateQueries({ queryKey });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/workouts/plan/${planId}`);
    },
    onSuccess: () => {
      toast.success('Plan deleted');
      qc.removeQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      navigate(TRAIN.tab('plans'), { replace: true, viewTransition: true });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete plan')),
  });

  const weeks = useMemo(() => {
    const byWeek = new Map<number, PlanEntry[]>();
    for (const entry of plan?.workouts ?? []) {
      if (!entry.workout) continue;
      const list = byWeek.get(entry.week) ?? [];
      list.push(entry);
      byWeek.set(entry.week, list);
    }
    const declared = plan?.durationWeeks ?? 0;
    const keys = new Set<number>([...byWeek.keys()]);
    // Owners see every advertised week so an empty one is a visible slot to fill.
    if (isOwn) for (let w = 1; w <= declared; w += 1) keys.add(w);
    return [...keys]
      .sort((a, b) => a - b)
      .map((week) => ({
        week,
        entries: (byWeek.get(week) ?? []).slice().sort((a, b) => a.day - b.day || (a.order ?? 0) - (b.order ?? 0)),
      }));
  }, [plan, isOwn]);

  if (isLoading) {
    return (
      <RouteSheet title="Workout plan" onClose={close}>
        <PlanSkeleton />
      </RouteSheet>
    );
  }

  if (isError || !plan) {
    return (
      <RouteSheet title="Workout plan" onClose={close}>
        <ErrorState
          error={error}
          title="Plan not found"
          message="It may have been deleted or made private."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => void refetch()}>
                Try again
              </Button>
              <Button variant="secondary" onClick={close}>
                Back to plans
              </Button>
            </div>
          }
        />
      </RouteSheet>
    );
  }

  const cover = plan.image?.uri ? mediaUrl(plan.image.uri) : '';
  const sessions = (plan.workouts ?? []).filter((e) => e.workout);
  const minutes = sessions.reduce((n, e) => n + (Number(e.workout?.duration) || 0), 0);
  const kcal = sessions.reduce((n, e) => n + (Number(e.workout?.caloriesBurned) || 0), 0);
  const author = plan.createdBy;
  const menu = planMenu(plan, {
    isOwn,
    toast,
    onEdit: () => open(TRAIN.editPlan(plan._id)),
    onAddWorkout: () => setPickerOpen(true),
    onDelete: () => setConfirmDelete(true),
  });

  return (
    <RouteSheet title={plan.title} onClose={close}>
    <div className="space-y-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.level ? <Badge>{humanize(plan.level)}</Badge> : null}
          {plan.durationWeeks ? (
            <Badge tone="neutral">
              {plan.durationWeeks} {plan.durationWeeks === 1 ? 'week' : 'weeks'}
            </Badge>
          ) : null}
          {plan.isPremade ? <Badge tone="info">Premade</Badge> : null}
          {isOwn && plan.isPublic === false ? <Badge>Private</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          <LikeButton liked={liked} count={(plan.likes ?? []).length} disabled={like.isPending} onToggle={() => like.mutate()} />
          <Menu items={menu} label={`More options for ${plan.title}`} />
        </div>
      </div>

      <Card padded={false} className="overflow-hidden">
        {cover ? <img src={cover} alt="" className="aspect-[16/9] w-full object-cover md:aspect-auto md:h-64" /> : null}
        <div className="space-y-4 p-4 sm:p-5">
          {plan.goal ? <p className="text-md font-semibold text-text-1">{plan.goal}</p> : null}
          {plan.description ? <p className="prose-measure text-base text-text-1">{plan.description}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            {author ? (
              <Link to={`/u/${author._id}`} viewTransition className="inline-flex min-h-11 items-center gap-2.5 rounded-sm pr-2 text-sm text-text-1 hover:bg-surface-2">
                <Avatar src={author.avatar} name={author.fullName || author.username} alt="" size="md" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{author.fullName || author.username || 'Vybe member'}</span>
                  {author.username ? <span className="block truncate text-xs text-text-2">@{author.username}</span> : null}
                </span>
              </Link>
            ) : (
              <p className="inline-flex min-h-11 items-center text-sm text-text-2">{plan.isPremade ? 'Program by Vybe' : 'Vybe member'}</p>
            )}
            {plan.createdAt ? (
              <p className="text-xs text-text-3">
                Added <time dateTime={plan.createdAt} title={new Date(plan.createdAt).toLocaleString()}>{timeAgo(plan.createdAt)}</time>
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <MetaList
        items={[
          { icon: <Layers size={14} />, label: `${formatStat(plan.durationWeeks ?? weeks.length)} ${(plan.durationWeeks ?? weeks.length) === 1 ? 'week' : 'weeks'}` },
          sessions.length > 0 && { icon: <Dumbbell size={14} />, label: `${formatStat(sessions.length)} ${sessions.length === 1 ? 'session' : 'sessions'}` },
          minutes > 0 && { icon: <Clock size={14} />, label: `${formatStat(minutes)} min planned` },
          kcal > 0 && { icon: <Flame size={14} />, label: `${formatStat(kcal)} kcal` },
        ]}
      />

      <Section
        title="Schedule"
        description={sessions.length ? 'Week by week. Open a session to see the exercises or log it.' : undefined}
        action={
          isOwn ? (
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setPickerOpen(true)}>
              Add workout
            </Button>
          ) : undefined
        }
      >
        {weeks.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Dumbbell size={26} />}
            title="No sessions yet"
            message={isOwn ? 'Add your first workout and place it on a week and day.' : 'This plan has no workouts scheduled.'}
            action={isOwn ? { label: 'Add workout', onClick: () => setPickerOpen(true), icon: <Plus size={18} />, variant: 'secondary' } : undefined}
          />
        ) : (
          <div className="space-y-3">
            {weeks.map(({ week, entries }) => (
              <Card key={week} padded={false}>
                <div className="flex items-center justify-between gap-3 px-4 pt-4">
                  <h3 className="type-heading text-sm text-text-1">Week {week}</h3>
                  <span className="text-xs text-text-3">{entries.length ? `${formatStat(entries.length)} ${entries.length === 1 ? 'session' : 'sessions'}` : 'Rest week'}</span>
                </div>
                {entries.length === 0 ? (
                  <p className="px-4 pb-4 pt-2 text-sm text-text-2">Nothing scheduled this week yet.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-line">
                    {entries.map((entry) => (
                      <li key={`${entry.week}-${entry.day}-${entry.workout?._id}`} className="flex items-center gap-1 pr-2">
                        <Link
                          to={`/workouts/${entry.workout?._id}`}
                          state={state}
                          viewTransition
                          className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-text-1">{entry.workout?.title}</span>
                            <span className="block text-xs text-text-2">
                              {dayLabel(entry.day)}
                              {entry.workout?.duration ? ` · ${formatStat(entry.workout.duration)} min` : ''}
                              {entry.workout?.category ? ` · ${humanize(entry.workout.category)}` : ''}
                            </span>
                          </span>
                          <Activity size={16} className="shrink-0 text-text-3" />
                        </Link>
                        {isOwn ? (
                          <IconButton
                            label={`Remove ${entry.workout?.title ?? 'session'} from week ${entry.week}`}
                            variant="ghost"
                            className="shrink-0 text-text-2 hover:text-danger"
                            disabled={removeEntry.isPending}
                            onClick={() => setPendingRemove(entry)}
                          >
                            <Trash size={18} />
                          </IconButton>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        )}
      </Section>

      <AddWorkoutPicker plan={plan} open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title="Remove from plan?"
        message={`“${pendingRemove?.workout?.title ?? ''}” comes off week ${pendingRemove?.week ?? ''}. The workout itself stays in the library.`}
        confirmLabel="Remove"
        destructive
        loading={removeEntry.isPending}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && removeEntry.mutate(pendingRemove)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete plan?"
        message={`“${plan.title}” will be removed. The workouts scheduled in it stay in your library.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
    </RouteSheet>
  );
}
