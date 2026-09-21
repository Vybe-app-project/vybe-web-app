import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/hooks';
import {
  completeEnrollment,
  enroll,
  isFeatureDisabled,
  markSession,
  openWeek,
  patchEnrollment,
  programKeys,
  programsFeature,
  scheduleWeeks,
  shiftAnchor,
  skipSession,
  unmarkSession,
  unskipSession,
  useEnrollment,
  type PlanSlotInput,
  type ScheduleRow,
} from '../lib/programs';
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
  type MenuItem,
} from './ui';
import { Check, Clock, Dumbbell, ExternalLink, Flame, Layers, Minus, Pause, Play, Plus, Trash } from './icons';
import { RouteSheet } from '../components/RouteSheet';
import { planMenu } from './Workouts';
import { LikeButton, MetaList } from './workouts/cards';
import { fetchPlan, type PlanEntry, type WorkoutPlan } from './workouts/model';
import { EnrolmentCard, WeekList } from './workouts/enrolment';
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

/**
 * /workouts/plans/:planId — a workout plan, week by week, as a sheet over the
 * page that opened it. Owners schedule sessions into a week and day here and
 * take them out again; renaming and the length live at /workouts/plans/:planId/edit.
 *
 * Since Wave G the page is also where a member joins the plan and follows it.
 * Under the title sits one enrolment card: before joining, a sentence about
 * what the plan is and the page's one filled blue; after, "Week 2 of 4 · 5 of
 * 12 done", the one next-up row with a blue text Start, and a quiet overflow
 * for pause, shift, complete and leave. The schedule below it is a text-only
 * day list — Monday to Sunday, rest days named and dimmed — and it is the
 * same list whether or not anyone has enrolled: a plan you cannot read is a
 * plan you cannot choose.
 *
 * Every /api/plans route sits behind the `programs` flag and answers 404
 * FEATURE_DISABLED while it is off, so the card is feature-detected: with the
 * flag off it is simply absent and the schedule stays exactly as it was.
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
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<PlanEntry | null>(null);
  /** null until the member opens or closes a week themselves; then it is their choice. */
  const [openWeeks, setOpenWeeks] = useState<Set<number> | null>(null);

  const queryKey = ['workout-plan', planId];
  const { data: plan, isLoading, isError, error, refetch } = useQuery({ queryKey, queryFn: () => fetchPlan(planId), enabled: Boolean(planId) });

  const { programs: programsOn } = programsFeature();
  const enrolment = useEnrollment(planId);
  const view = enrolment.data ?? null;
  const status = view?.enrollment?.status ?? 'none';
  const enrolled = status === 'active' || status === 'paused' || status === 'completed';
  /** The flag is on and the read answered: only then is there a card to draw. */
  const showEnrolment = programsOn && !enrolment.isError;
  const enrolmentKey = programKeys.enrollment(planId);
  const afterEnrolmentWrite = () => {
    qc.invalidateQueries({ queryKey: enrolmentKey });
    qc.invalidateQueries({ queryKey: ['plans', 'enrollments'] });
  };

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

  /* ------------------------------------------------------- the enrolment */

  const startPlan = useMutation({
    mutationFn: () => enroll(planId),
    onSuccess: (data) => {
      qc.setQueryData(enrolmentKey, data);
      qc.invalidateQueries({ queryKey: ['plans', 'enrollments'] });
      toast.success(`You are on ${plan?.title ?? 'the plan'}`);
    },
    onError: (e) => toast.error(e, 'Could not start this plan'),
  });

  const patch = useMutation({
    mutationFn: ({ patch: body }: { patch: Parameters<typeof patchEnrollment>[1]; message: string }) => patchEnrollment(planId, body),
    onSuccess: (_data, { message }) => {
      afterEnrolmentWrite();
      toast.success(message);
    },
    onError: (e) => toast.error(e, 'Could not change this plan'),
  });

  const complete = useMutation({
    mutationFn: () => completeEnrollment(planId),
    onSuccess: () => {
      afterEnrolmentWrite();
      toast.success('Plan complete');
    },
    onError: (e) => toast.error(e, 'Could not mark this plan complete'),
  });

  const slotWrite = useMutation({
    mutationFn: ({ row, action }: { row: ScheduleRow; action: 'mark' | 'unmark' | 'skip' | 'unskip' }) => {
      const slot = { week: row.week, day: row.day, order: row.order };
      if (action === 'mark') return markSession(planId, { ...slot, source: 'manual' });
      if (action === 'unmark') return unmarkSession(planId, slot);
      if (action === 'skip') return skipSession(planId, slot);
      return unskipSession(planId, slot);
    },
    onSuccess: () => afterEnrolmentWrite(),
    onError: (e) => toast.error(e, 'Could not update this session'),
  });

  const leave = useMutation({
    mutationFn: () => patchEnrollment(planId, { status: 'left' }),
    onSuccess: () => {
      afterEnrolmentWrite();
      setConfirmLeave(false);
      toast.success('You have left the plan');
    },
    onError: (e) => {
      setConfirmLeave(false);
      toast.error(e, 'Could not leave this plan');
    },
  });

  /* --------------------------------------------------------- the schedule */

  /** The plan document's own slots: what the list reads before anyone enrols. */
  const slots = useMemo<PlanSlotInput[]>(
    () =>
      (plan?.workouts ?? [])
        .filter((entry) => entry.workout)
        .map((entry) => ({
          week: entry.week,
          day: entry.day,
          order: entry.order,
          workoutId: entry.workout?._id ?? null,
          title: entry.workout?.title ?? null,
          estimatedMin: entry.workout?.duration ?? null,
          exerciseCount: entry.workout?.exercises?.length ?? 0,
        })),
    [plan],
  );

  const weeks = useMemo(
    () => scheduleWeeks({ slots, schedule: view?.schedule, pointer: view?.pointer, durationWeeks: plan?.durationWeeks }),
    [slots, view?.schedule, view?.pointer, plan?.durationWeeks],
  );

  // The suggested week opens on arrival; once the member opens or closes one, their set wins.
  const currentWeek = openWeek(weeks, view?.suggestedWeek, view?.pointer);
  const openSet = openWeeks ?? new Set<number>([currentWeek]);
  const toggleWeek = (week: number) =>
    setOpenWeeks((previous) => {
      const next = new Set(previous ?? [currentWeek]);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });

  /** The pointer as a row, so the card's next-up line and the list agree. */
  const nextRow = useMemo(() => weeks.flatMap((week) => week.days).flatMap((day) => day.rows).find((row) => row.isNext) ?? null, [weeks]);

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

  /** The plan entry a schedule row came from, for the owner's remove control. */
  const entryFor = (row: ScheduleRow): PlanEntry | null =>
    (plan.workouts ?? []).find((entry) => entry.week === row.week && entry.day === row.day && (entry.order ?? 1) === row.order && entry.workout?._id === row.workoutId) ?? null;

  /**
   * Everything that changes the enrolment, in one quiet overflow. Nothing
   * here is irreversible inside the app: a pause resumes, a shift moves the
   * suggested week and nothing else, a completion can be taken back for a
   * day, and leaving asks first.
   */
  const enrolmentMenu: MenuItem[] = [
    ...(status === 'active' ? [{ label: 'Pause', icon: <Pause size={18} />, onSelect: () => patch.mutate({ patch: { status: 'paused' }, message: 'Plan paused' }) }] : []),
    ...(status === 'paused' ? [{ label: 'Resume', icon: <Play size={18} />, onSelect: () => patch.mutate({ patch: { status: 'active' }, message: 'Plan resumed' }) }] : []),
    ...((status === 'active' || status === 'paused') && view?.pointer
      ? [
          {
            label: 'Shift schedule to this week',
            description: 'Moves the suggested week. Nothing you have done changes.',
            icon: <Layers size={18} />,
            onSelect: () => patch.mutate({ patch: { weekAnchor: shiftAnchor(view.pointer?.week ?? 1) }, message: 'Schedule shifted to this week' }),
          },
        ]
      : []),
    ...(view?.canMarkComplete ? [{ label: 'Mark plan complete', icon: <Check size={18} />, onSelect: () => complete.mutate() }] : []),
    ...(status !== 'completed' ? [{ label: 'Leave plan', icon: <Minus size={18} />, danger: true, divider: true, onSelect: () => setConfirmLeave(true) }] : []),
  ];

  /** Per slot: mark it, take the mark back, skip it, put it back, or open the workout. */
  const slotMenu = (row: ScheduleRow): MenuItem[] => [
    ...(row.state === 'done'
      ? [{ label: 'Mark not done', icon: <Minus size={18} />, onSelect: () => slotWrite.mutate({ row, action: 'unmark' }) }]
      : [{ label: 'Mark done', icon: <Check size={18} />, onSelect: () => slotWrite.mutate({ row, action: 'mark' }) }]),
    ...(row.state === 'skipped'
      ? [{ label: 'Un-skip', icon: <Play size={18} />, onSelect: () => slotWrite.mutate({ row, action: 'unskip' }) }]
      : row.state === 'done'
        ? []
        : [{ label: 'Skip', description: 'Reversible, and it stays in the plan.', icon: <Pause size={18} />, onSelect: () => slotWrite.mutate({ row, action: 'skip' }) }]),
    ...(row.workoutId ? [{ label: 'Open workout', icon: <ExternalLink size={18} />, divider: true, to: `/workouts/${row.workoutId}` }] : []),
  ];

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

      {/* The enrolment, above the fold and above the description: joining is the
          decision this page exists for. The skeleton is the card's own height,
          so the cover below it never moves when the read lands. */}
      {showEnrolment ? (
        enrolment.isPending ? (
          <Skeleton className="h-[148px] w-full rounded-lg" />
        ) : (
          <EnrolmentCard
            state={status}
            progress={view?.progress}
            suggestedWeek={view?.suggestedWeek}
            durationWeeks={plan.durationWeeks}
            sessionCount={sessions.length}
            next={nextRow}
            nextTo={nextRow?.workoutId ? TRAIN.liveSession({ from: nextRow.workoutId, program: { planId: plan._id, week: nextRow.week, day: nextRow.day, order: nextRow.order } }) : null}
            onStart={() => startPlan.mutate()}
            starting={startPlan.isPending}
            menu={enrolmentMenu}
          />
        )
      ) : null}

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
        description={sessions.length ? 'Week by week, Monday to Sunday. Every week is open — train them in the order that fits.' : undefined}
        action={
          isOwn ? (
            <Button variant={showEnrolment && !enrolled ? 'secondary' : 'primary'} icon={<Plus size={18} />} onClick={() => setPickerOpen(true)}>
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
          <WeekList
            weeks={weeks}
            open={openSet}
            onToggle={toggleWeek}
            workoutTo={(workoutId) => `/workouts/${workoutId}`}
            linkState={state}
            menuFor={enrolled && status !== 'completed' ? slotMenu : undefined}
            ownerAction={
              isOwn
                ? (row) => {
                    const entry = entryFor(row);
                    if (!entry) return null;
                    return (
                      <IconButton
                        label={`Remove ${entry.workout?.title ?? 'session'} from week ${entry.week}`}
                        variant="ghost"
                        className="shrink-0 text-text-2 hover:text-danger"
                        disabled={removeEntry.isPending}
                        onClick={() => setPendingRemove(entry)}
                      >
                        <Trash size={18} />
                      </IconButton>
                    );
                  }
                : undefined
            }
          />
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
        open={confirmLeave}
        title="Leave this plan?"
        message={`Your progress on “${plan.title}” is kept. You can start it again whenever you want.`}
        confirmLabel="Leave"
        destructive
        loading={leave.isPending}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => leave.mutate()}
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
