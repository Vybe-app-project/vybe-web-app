import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Menu,
  PageHeader,
  Section,
  Skeleton,
  SkeletonRow,
  SkeletonText,
  StatGrid,
  StatTile,
  cx,
  formatStat,
  humanize,
  type MenuItem,
  useToast,
} from './ui';
import { Activity, Clock, Copy, Dumbbell, Edit, Flag, Flame, Heart, MessageCircle, Send, ShareUp, Trash } from './icons';
import { LikeButton, WorkoutModal, shareWorkout, type SocialWorkout, type WorkoutAuthor, type WorkoutExercise, type WorkoutPlan } from './Workouts';
import { useReportModal } from './Report';

type WorkoutComment = {
  _id: string;
  text: string;
  createdAt: string;
  user?: WorkoutAuthor | string;
};

type WorkoutDetailData = SocialWorkout & { comments?: WorkoutComment[] };

const safeDate = (value?: string) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? formatDistanceToNow(d, { addSuffix: true }) : '';
};

const plural = (n: number, one: string, many = `${one}s`) => `${formatStat(n)} ${n === 1 ? one : many}`;

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading workout">
      <div className="card overflow-hidden">
        <Skeleton className="aspect-[16/9] w-full rounded-none md:aspect-auto md:h-72 lg:h-80" />
        <div className="space-y-3 p-4 sm:p-5">
          <SkeletonText lines={2} />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-xs" />
            <Skeleton className="h-6 w-24 rounded-xs" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-3 h-8 w-2/3" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} className="card px-4" />
        ))}
      </div>
    </div>
  );
}

/** Exercise prescription as labelled facts, not a dotted string. */
function Prescription({ ex }: { ex: WorkoutExercise }) {
  const facts: Array<[string, string]> = [];
  if (ex.sets) facts.push([formatStat(ex.sets), ex.sets === 1 ? 'set' : 'sets']);
  if (ex.reps) facts.push([formatStat(ex.reps), ex.reps === 1 ? 'rep' : 'reps']);
  if (ex.weight) facts.push([formatStat(ex.weight), 'kg']);
  if (ex.duration) facts.push([formatStat(ex.duration), 'min']);
  if (ex.distance) facts.push([formatStat(ex.distance), 'km']);
  if (ex.rest) facts.push([formatStat(ex.rest), 's rest']);
  if (!facts.length) return <p className="text-xs text-text-3">No prescription</p>;
  return (
    <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {facts.map(([value, unit]) => (
        <li key={unit} className="flex items-baseline gap-1">
          <span className="type-stat text-md text-text-1">{value}</span>
          <span className="text-xs font-medium text-text-2">{unit}</span>
        </li>
      ))}
    </ul>
  );
}

export default function WorkoutDetail() {
  const { workoutId = '' } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { report, reportModal } = useReportModal();
  const composerRef = useRef<HTMLFormElement>(null);
  const commentsRef = useRef<HTMLElement | null>(null);
  const focusComposer = (preventScroll = false) => composerRef.current?.querySelector('input')?.focus({ preventScroll });

  const queryKey = ['workout', workoutId];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<WorkoutDetailData> => {
      const { data } = await api.get<{ success: boolean; data: WorkoutDetailData }>(
        `/workouts/workout/info/single-workout/${workoutId}`,
      );
      return data.data;
    },
    enabled: Boolean(workoutId),
  });

  // The mobile app shares workout *plans* under the same "workout" link type,
  // so an id that is not a workout may be a plan: try that before giving up.
  const notFound = isError && (error as { response?: { status?: number } } | null)?.response?.status === 404;
  const plan = useQuery({
    queryKey: ['workout-plan', workoutId],
    enabled: notFound && Boolean(workoutId),
    retry: false,
    queryFn: async (): Promise<WorkoutPlan> => {
      const { data } = await api.get<{ success: boolean; data: WorkoutPlan }>(`/workouts/plan/single-plan/${workoutId}`);
      return data.data;
    },
  });

  // Card comment links land on #comments: scroll there and focus the composer.
  useEffect(() => {
    if (!data || hash !== '#comments') return;
    commentsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    focusComposer(true);
  }, [data, hash]);

  const liked = Boolean(user && (data?.likes ?? []).some((id) => String(id) === user._id));
  const isOwn = Boolean(user && data?.createdBy && data.createdBy._id === user._id);

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.put(`/workouts/interaction/${workoutId}/like`);
      return data as { isLiked: boolean; likesCount: number };
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<WorkoutDetailData>(queryKey);
      if (previous && user) {
        qc.setQueryData<WorkoutDetailData>(queryKey, {
          ...previous,
          likes: liked
            ? (previous.likes ?? []).filter((id) => String(id) !== user._id)
            : [...(previous.likes ?? []), user._id],
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error(errMsg(e, 'Could not update like'));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['workouts'] });
    },
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const text = comment.trim();
      if (!text) throw Object.assign(new Error('empty'), { silent: true });
      const { data } = await api.post(`/workouts/interaction/${workoutId}/comment`, { text });
      return data as { comment: WorkoutComment };
    },
    onSuccess: (res) => {
      setComment('');
      qc.setQueryData<WorkoutDetailData>(queryKey, (old) =>
        old ? { ...old, comments: [...(old.comments ?? []), res.comment] } : old,
      );
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['workouts'] });
      toast.success('Comment posted');
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) {
        focusComposer();
        return;
      }
      toast.error(errMsg(e, 'Could not post comment'));
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/workouts/${workoutId}`);
    },
    onSuccess: () => {
      toast.success('Workout deleted');
      qc.removeQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['workouts'] });
      navigate('/workouts', { replace: true, viewTransition: true });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete workout')),
  });

  const title = data?.title ?? 'Workout';

  const menu: MenuItem[] = data
    ? [
        ...(isOwn ? [{ label: 'Edit', icon: <Edit size={18} />, onSelect: () => setEditOpen(true) }] : []),
        { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void shareWorkout(data, toast, 'share') },
        { label: 'Copy link', icon: <Copy size={18} />, onSelect: () => void shareWorkout(data, toast, 'copy') },
        ...(!isOwn
          ? [{ label: 'Report', icon: <Flag size={18} />, divider: true, onSelect: () => report({ targetType: 'workout', targetId: data._id, targetLabel: 'workout' }) }]
          : []),
        ...(isOwn ? [{ label: 'Delete', icon: <Trash size={18} />, danger: true, divider: true, onSelect: () => setConfirmDelete(true) }] : []),
      ]
    : [];

  const headerActions = data ? (
    <>
      <LikeButton liked={liked} count={(data.likes ?? []).length} disabled={like.isPending} onToggle={() => like.mutate()} />
      <Menu items={menu} label={`More options for ${title}`} />
    </>
  ) : null;

  if (isLoading) {
    return (
      <>
        <PageHeader title="Workout" />
        <DetailSkeleton />
      </>
    );
  }

  if (isError || !data) {
    if (plan.isLoading) {
      return (
        <>
          <PageHeader title="Workout plan" />
          <DetailSkeleton />
        </>
      );
    }
    if (plan.data) return <PlanDetail plan={plan.data} />;
    return (
      <>
        <PageHeader title="Workout" />
        <ErrorState
          error={error}
          title="Workout not found"
          message="It may have been deleted or made private."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => void refetch()}>
                Try again
              </Button>
              <Button variant="secondary" onClick={() => navigate('/workouts', { viewTransition: true })}>
                Back to workouts
              </Button>
            </div>
          }
        />
      </>
    );
  }

  const cover = data.image?.uri ? mediaUrl(data.image.uri) : '';
  const comments = [...(data.comments ?? [])].reverse();
  const exercises = data.exercises ?? [];
  const totalSets = exercises.reduce((n, e) => n + (Number(e.sets) || 0), 0);
  const author = data.createdBy;

  return (
    <div className="space-y-6">
      <PageHeader title={title} actions={headerActions} />

      <Card padded={false} className="overflow-hidden">
        <div className={cx('relative bg-surface-2', cover ? 'aspect-[16/9] w-full md:aspect-auto md:h-72 lg:h-80' : 'flex aspect-[21/9] w-full items-center justify-center md:aspect-auto md:h-40')}>
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="inline-flex flex-col items-center gap-2 text-text-3" aria-hidden="true">
              <Dumbbell size={40} />
              <span className="type-label">{humanize(data.category)}</span>
            </span>
          )}
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{humanize(data.category)}</Badge>
            {data.level ? <Badge>{humanize(data.level)}</Badge> : null}
            {data.isPremade ? <Badge tone="accent">Premade</Badge> : null}
            {isOwn && data.isPublic === false ? <Badge>Private</Badge> : null}
          </div>

          {data.description ? <p className="prose-measure text-base text-text-1">{data.description}</p> : null}

          {(data.hashtags ?? []).length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Hashtags">
              {(data.hashtags ?? []).map((tag) => (
                <li key={tag}>
                  <Chip to={`/search?q=${encodeURIComponent(`#${tag}`)}`}>#{tag}</Chip>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            {author ? (
              <Link
                to={`/u/${author._id}`}
                viewTransition
                className="inline-flex min-h-11 items-center gap-2.5 rounded-sm pr-2 text-sm text-text-1 hover:bg-surface-2"
              >
                <Avatar src={author.avatar} name={author.fullName || author.username} alt="" size="md" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{author.fullName || author.username || 'Vybe member'}</span>
                  {author.username ? <span className="block truncate text-xs text-text-2">@{author.username}</span> : null}
                </span>
              </Link>
            ) : (
              <p className="inline-flex min-h-11 items-center text-sm text-text-2">{data.isPremade ? 'Premade by Vybe' : 'Vybe member'}</p>
            )}
            {data.createdAt ? <p className="text-xs text-text-3">Added {safeDate(data.createdAt)}</p> : null}
          </div>
        </div>
      </Card>

      <StatGrid columns={4}>
        <StatTile label="Exercises" value={formatStat(exercises.length)} icon={<Activity size={18} />} tone="brand" />
        <StatTile label="Sets" value={formatStat(totalSets)} icon={<Dumbbell size={18} />} hint={totalSets ? undefined : 'Not specified'} />
        <StatTile label="Duration" value={data.duration ? formatStat(data.duration) : '–'} unit={data.duration ? 'min' : undefined} icon={<Clock size={18} />} hint={data.duration ? undefined : 'Not specified'} />
        <StatTile label="Burn" value={data.caloriesBurned ? formatStat(data.caloriesBurned) : '–'} unit={data.caloriesBurned ? 'kcal' : undefined} icon={<Flame size={18} />} tone={data.caloriesBurned ? 'accent' : 'neutral'} hint={data.caloriesBurned ? undefined : 'Not specified'} />
      </StatGrid>

      <Section title="Exercises" description={exercises.length ? 'In order, with the prescribed sets, reps and load.' : undefined} action={
        <Button variant="secondary" onClick={() => navigate(`/workouts/logs?log=1&from=${data._id}`, { viewTransition: true })} icon={<Dumbbell size={18} />}>
          Log this workout
        </Button>
      }>
        {exercises.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Activity size={26} />}
            title="No exercises listed"
            message={isOwn ? 'Add the movements so this workout can be logged and followed.' : 'The author has not listed the movements yet.'}
            action={isOwn ? { label: 'Add exercises', onClick: () => setEditOpen(true), icon: <Edit size={18} /> } : undefined}
          />
        ) : (
          <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface-1 shadow-1">
            {exercises.map((ex, i) => (
              <li key={ex._id ?? `${ex.name}-${i}`} className="flex gap-3 p-4">
                <span className="type-stat inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm text-text-2" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-md font-semibold text-text-1">
                    <span className="sr-only">Exercise {i + 1}: </span>
                    {ex.name}
                  </p>
                  <Prescription ex={ex} />
                  {ex.notes ? <p className="text-sm text-text-2">{ex.notes}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        title={
          <span id="comments" ref={(el) => { commentsRef.current = el; }} className="scroll-mt-24 inline-flex items-center gap-2">
            Comments
            <span className="type-stat text-text-3">{formatStat(comments.length)}</span>
          </span>
        }
      >
        <form
          ref={composerRef}
          className="flex items-end gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            addComment.mutate();
          }}
        >
          <Input
            label="Add a comment"
            hideLabel
            placeholder="Ask about the session or share how it went"
            autoComplete="off"
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={addComment.isPending} disabled={!comment.trim()} icon={<Send size={18} />} aria-label="Post comment">
            <span className="hidden sm:inline">Post</span>
          </Button>
        </form>

        {comments.length === 0 ? (
          <EmptyState size="sm" icon={<MessageCircle size={26} />} title="No comments yet" message="Start the conversation: ask a question or share how the session went." />
        ) : (
          <ul className="space-y-2">
            {comments.map((c) => {
              const who = typeof c.user === 'object' && c.user ? c.user : undefined;
              const name = who?.fullName || who?.username || 'Vybe member';
              return (
                <li key={c._id} className="card flex gap-3 p-4">
                  <Avatar src={who?.avatar} name={name} alt="" size="sm" className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {who ? (
                        <Link
                          to={`/u/${who._id}`}
                          viewTransition
                          className="relative text-sm font-semibold text-text-1 before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-text-1">{name}</span>
                      )}
                      <time className="text-xs text-text-3" dateTime={c.createdAt}>
                        {safeDate(c.createdAt)}
                      </time>
                    </div>
                    <p className="prose-measure mt-0.5 break-words text-sm text-text-1">{c.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <p className="sr-only">
        {plural((data.likes ?? []).length, 'like')}, {plural(comments.length, 'comment')}
      </p>

      <WorkoutModal open={editOpen} editing={data} onClose={() => setEditOpen(false)} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete workout?"
        message={`“${data.title}” will be removed from your library. Sessions you have already logged are kept.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
      {reportModal}
    </div>
  );
}

/** Read view for a shared workout plan: the schedule, week by week. */
function PlanDetail({ plan }: { plan: WorkoutPlan }) {
  const cover = plan.image?.uri ? mediaUrl(plan.image.uri) : '';
  const byWeek = new Map<number, NonNullable<WorkoutPlan['workouts']>>();
  for (const entry of plan.workouts ?? []) {
    if (!entry.workout) continue;
    const list = byWeek.get(entry.week) ?? [];
    list.push(entry);
    byWeek.set(entry.week, list);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  const author = plan.createdBy?.fullName || plan.createdBy?.username;
  return (
    <>
      <PageHeader title={plan.title} back="/workouts" />
      <div className="space-y-4">
        {cover ? <img src={cover} alt="" className="aspect-[16/9] w-full rounded-lg object-cover" /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {plan.level ? <Badge>{plan.level}</Badge> : null}
          {plan.durationWeeks ? <Badge tone="neutral">{plan.durationWeeks} weeks</Badge> : null}
          {plan.goal ? <Badge tone="neutral">{plan.goal}</Badge> : null}
          {author ? <span className="text-xs text-text-2">Plan by {author}</span> : null}
        </div>
        {plan.description ? <p className="text-sm text-text-2">{plan.description}</p> : null}
        {weeks.length === 0 ? (
          <EmptyState icon={<Dumbbell size={26} />} title="No sessions yet" message="This plan has no workouts scheduled." />
        ) : (
          weeks.map((week) => (
            <Card key={week} className="p-0">
              <h2 className="type-heading px-4 pt-4 text-sm text-text-1">Week {week}</h2>
              <ul className="divide-y divide-line">
                {(byWeek.get(week) ?? [])
                  .slice()
                  .sort((a, b) => a.day - b.day || (a.order ?? 0) - (b.order ?? 0))
                  .map((entry) => (
                    <li key={`${entry.week}-${entry.day}-${entry.workout?._id}`}>
                      <Link
                        to={`/workouts/${entry.workout?._id}`}
                        viewTransition
                        className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-text-1">{entry.workout?.title}</span>
                          <span className="block text-xs text-text-2">
                            Day {entry.day}
                            {entry.workout?.duration ? ` · ${entry.workout.duration} min` : ''}
                            {entry.workout?.category ? ` · ${entry.workout.category}` : ''}
                          </span>
                        </span>
                        <Activity size={16} className="shrink-0 text-text-3" />
                      </Link>
                    </li>
                  ))}
              </ul>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
