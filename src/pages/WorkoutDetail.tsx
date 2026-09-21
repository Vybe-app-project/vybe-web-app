import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { secondsParts } from '../lib/duration';
import { timeAgo } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  Section,
  Skeleton,
  SkeletonRow,
  SkeletonText,
  cx,
  formatStat,
  humanize,
  type MenuItem,
  useToast,
} from './ui';
import { Activity, ChevronRight, Clock, Copy, Dumbbell, Edit, Flag, Flame, Layers, MessageCircle, Play, Send, ShareUp, Trash } from './icons';
import { RouteSheet } from '../components/RouteSheet';
import { LikeButton, MetaList, categoryTone } from './workouts/cards';
import { shareWorkout, type SocialWorkout, type WorkoutAuthor, type WorkoutExercise, type WorkoutPlan } from './workouts/model';
import { AddToPlanModal } from './workouts/planPickers';
import { TRAIN, useSheetClose, useSheetNav } from './workouts/sheet';
import { useReportModal } from './Report';

type WorkoutComment = {
  _id: string;
  text: string;
  createdAt: string;
  user?: WorkoutAuthor | string;
};

type WorkoutDetailData = Omit<SocialWorkout, 'comments'> & { comments?: WorkoutComment[] };

/** Compact relative time ("2m", "16h") with the full date on hover, matching the feed. */
function When({ value, prefix }: { value?: string; prefix?: string }) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return (
    <time dateTime={value} title={d.toLocaleString()}>
      {prefix ? `${prefix} ` : ''}
      {timeAgo(value)}
    </time>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${formatStat(n)} ${n === 1 ? one : many}`;

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading workout">
      <Card padded={false} className="overflow-hidden">
        <Skeleton className="aspect-[16/9] w-full rounded-none md:aspect-auto md:h-72 lg:h-80" />
        <div className="space-y-3 p-4 sm:p-5">
          <SkeletonText lines={2} />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-xs" />
            <Skeleton className="h-6 w-24 rounded-xs" />
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} padded={false} className="p-4">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-3 h-8 w-2/3" />
          </Card>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} padded={false} className="px-4">
            <SkeletonRow />
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Exercise prescription as labelled facts, not a dotted string. Durations are seconds. */
function Prescription({ ex }: { ex: WorkoutExercise }) {
  const facts: Array<[string, string]> = [];
  if (ex.sets) facts.push([formatStat(ex.sets), ex.sets === 1 ? 'set' : 'sets']);
  if (ex.reps) facts.push([formatStat(ex.reps), ex.reps === 1 ? 'rep' : 'reps']);
  if (ex.weight) facts.push([formatStat(ex.weight), 'kg']);
  if (ex.duration) facts.push(...secondsParts(ex.duration));
  if (ex.distance) facts.push([formatStat(ex.distance), 'km']);
  if (ex.rest) facts.push(...secondsParts(ex.rest).map(([v, u], i, all) => [v, i === all.length - 1 ? `${u} rest` : u] as [string, string]));
  if (!facts.length) return <p className="text-xs text-text-3">No prescription</p>;
  return (
    <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {facts.map(([value, unit], i) => (
        <li key={`${unit}-${i}`} className="flex items-baseline gap-1">
          <span className="type-stat text-md text-text-1">{value}</span>
          <span className="text-xs font-medium text-text-2">{unit}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * /workouts/:workoutId — one library workout as a sheet over the page that
 * opened it (a page on phones, or when the URL is loaded cold). Editing is
 * its own route, /workouts/:workoutId/edit; "Log this workout" seeds a new
 * session at /workouts/history/new?from=<id>.
 */
export default function WorkoutDetail() {
  const { workoutId = '' } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { open, state: sheetState } = useSheetNav();
  const close = useSheetClose(TRAIN.hub);
  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addToPlan, setAddToPlan] = useState(false);
  const [pendingComment, setPendingComment] = useState<WorkoutComment | null>(null);
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

  const removeComment = useMutation({
    mutationFn: async (c: WorkoutComment) => {
      await api.delete(`/workouts/interaction/${workoutId}/comment/${c._id}`);
      return c._id;
    },
    onMutate: async (c) => {
      // Optimistic removal; the snapshot restores the row if the server says no.
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<WorkoutDetailData>(queryKey);
      if (previous) {
        const remaining = (previous.comments ?? []) as WorkoutComment[];
        qc.setQueryData<WorkoutDetailData>(queryKey, { ...previous, comments: remaining.filter((x) => x._id !== c._id) });
      }
      return { previous };
    },
    onSuccess: () => toast.success('Comment deleted'),
    onError: (e, _c, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error(errMsg(e, 'Could not delete this comment'));
    },
    onSettled: () => {
      setPendingComment(null);
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['workouts'] });
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
      navigate(TRAIN.hub, { replace: true, viewTransition: true });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete workout')),
  });

  const title = data?.title ?? 'Workout';

  const menu: MenuItem[] = data
    ? [
        ...(isOwn ? [{ label: 'Edit', icon: <Edit size={18} />, onSelect: () => open(TRAIN.editWorkout(data._id)) }] : []),
        { label: 'Add to plan', description: 'Schedule it into one of your plans', icon: <Layers size={18} />, onSelect: () => setAddToPlan(true) },
        { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void shareWorkout(data, toast, 'share') },
        { label: 'Copy link', icon: <Copy size={18} />, onSelect: () => void shareWorkout(data, toast, 'copy') },
        ...(!isOwn
          ? [{ label: 'Report', icon: <Flag size={18} />, divider: true, onSelect: () => report({ targetType: 'workout', targetId: data._id, targetLabel: 'workout' }) }]
          : []),
        ...(isOwn ? [{ label: 'Delete', icon: <Trash size={18} />, danger: true, divider: true, onSelect: () => setConfirmDelete(true) }] : []),
      ]
    : [];

  if (isLoading) {
    return (
      <RouteSheet title="Workout" onClose={close}>
        <DetailSkeleton />
      </RouteSheet>
    );
  }

  if (isError || !data) {
    if (plan.isLoading) {
      return (
        <RouteSheet title="Workout plan" onClose={close}>
          <DetailSkeleton />
        </RouteSheet>
      );
    }
    // Canonical plan pages live under /workouts/plans/:planId; older share
    // links used the workout path, so send them on.
    if (plan.data) return <Navigate to={`/workouts/plans/${plan.data._id}`} replace />;
    return (
      <RouteSheet title="Workout" onClose={close}>
        <ErrorState
          error={error}
          title="Workout not found"
          message="It may have been deleted or made private."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => void refetch()}>
                Try again
              </Button>
              <Button variant="secondary" onClick={close}>
                Back to workouts
              </Button>
            </div>
          }
        />
      </RouteSheet>
    );
  }

  const cover = data.image?.uri ? mediaUrl(data.image.uri) : '';
  const comments = [...(data.comments ?? [])].reverse();
  const exercises = data.exercises ?? [];
  const totalSets = exercises.reduce((n, e) => n + (Number(e.sets) || 0), 0);
  const author = data.createdBy;

  return (
    <RouteSheet title={title} onClose={close}>
    <div className="space-y-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={categoryTone(data.category)}>{humanize(data.category)}</Badge>
          {data.level ? <Badge>{humanize(data.level)}</Badge> : null}
          {data.isPremade ? <Badge tone="info">Premade</Badge> : null}
          {isOwn && data.isPublic === false ? <Badge>Private</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          <LikeButton liked={liked} count={(data.likes ?? []).length} disabled={like.isPending} onToggle={() => like.mutate()} />
          <Menu items={menu} label={`More options for ${title}`} />
        </div>
      </div>

      <Card padded={false} className="overflow-hidden">
        {cover ? (
          <div className="relative aspect-[16/9] w-full bg-surface-2 md:aspect-auto md:h-64">
            <img src={cover} alt="" className="h-full w-full object-cover" />
          </div>
        ) : null}
        <div className="space-y-4 p-4 sm:p-5">
          <MetaList
            items={[
              { icon: <Activity size={14} />, label: plural(exercises.length, 'exercise') },
              totalSets > 0 && { icon: <Dumbbell size={14} />, label: plural(totalSets, 'set') },
              !!data.duration && { icon: <Clock size={14} />, label: `${formatStat(data.duration)} min` },
              !!data.caloriesBurned && { icon: <Flame size={14} />, label: `${formatStat(data.caloriesBurned)} kcal` },
            ]}
          />

          {data.description ? <p className="prose-measure text-base text-text-1">{data.description}</p> : null}

          {(data.hashtags ?? []).length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Hashtags">
              {(data.hashtags ?? []).map((tag) => (
                <li key={tag}>
                  <Chip to={`/search?q=${encodeURIComponent(`#${tag}`)}&type=workouts`}>#{tag}</Chip>
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
            {data.createdAt ? (
              <p className="text-xs text-text-3">
                <When value={data.createdAt} prefix="Added" />
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Section title="Exercises" description={exercises.length ? 'In order, with the prescribed sets, reps and load.' : undefined} action={
        <Button variant="primary" onClick={() => open(TRAIN.newSession({ from: data._id }))} icon={<Play size={18} />}>
          Log this workout
        </Button>
      }>
        {exercises.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Activity size={26} />}
            title="No exercises listed"
            message={isOwn ? 'Add the movements so this workout can be logged and followed.' : 'The author has not listed the movements yet.'}
            action={isOwn ? { label: 'Add exercises', onClick: () => open(TRAIN.editWorkout(data._id)), icon: <Edit size={18} />, variant: 'secondary' } : undefined}
          />
        ) : (
          <ol className="divide-y divide-line overflow-hidden rounded-md bg-surface-2">
            {exercises.map((ex, i) => (
              // A row chosen from the library carries its slug, so the whole row opens that exercise's page.
              <li key={ex._id ?? `${ex.name}-${i}`} className={cx('relative flex gap-3 p-4', ex.exerciseId && 'pressable')}>
                {ex.exerciseId ? (
                  <Link
                    to={`/exercises/${ex.exerciseId}`}
                    state={sheetState}
                    viewTransition
                    aria-label={`About ${ex.name}`}
                    className="absolute inset-0 z-[1] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                  />
                ) : null}
                <span className="type-stat inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-1 text-sm text-text-2" aria-hidden="true">
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
                {ex.exerciseId ? (
                  <span aria-hidden="true" className="relative z-[2] inline-flex shrink-0 items-center text-text-3">
                    <ChevronRight size={20} />
                  </span>
                ) : null}
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
          <Button type="submit" variant="secondary" loading={addComment.isPending} disabled={!comment.trim()} icon={<Send size={18} />} aria-label="Post comment">
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
              const authorId = who?._id ?? (typeof c.user === 'string' ? c.user : undefined);
              // Your own comments, and every comment on your workout, can be removed.
              const canDelete = Boolean(user && (isOwn || (authorId && authorId === user._id)));
              return (
                <li key={c._id}>
                  <Card padded={false} className="flex gap-3 p-4">
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
                      <span className="text-xs text-text-3">
                        <When value={c.createdAt} />
                      </span>
                    </div>
                    <p className="prose-measure mt-0.5 break-words text-sm text-text-1">{c.text}</p>
                  </div>
                  {canDelete ? (
                    <IconButton
                      label={`Delete comment by ${name}`}
                      variant="ghost"
                      size={40}
                      className="-mr-2 -mt-1.5 shrink-0 text-text-2 hover:text-danger"
                      disabled={removeComment.isPending}
                      onClick={() => setPendingComment(c)}
                    >
                      <Trash size={18} />
                    </IconButton>
                  ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <p className="sr-only">
        {plural((data.likes ?? []).length, 'like')}, {plural(comments.length, 'comment')}
      </p>

      <AddToPlanModal workout={addToPlan ? data : null} onClose={() => setAddToPlan(false)} />
      <ConfirmDialog
        open={Boolean(pendingComment)}
        title="Delete comment?"
        message="The comment is removed for everyone. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={removeComment.isPending}
        onCancel={() => setPendingComment(null)}
        onConfirm={() => pendingComment && removeComment.mutate(pendingComment)}
      />
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
    </RouteSheet>
  );
}
