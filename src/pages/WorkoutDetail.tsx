import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
} from './ui';
import { useToast } from './ui';
import { Dumbbell, Heart, Clock, Activity, ChevronLeft } from './icons';
import type { SocialWorkout, WorkoutAuthor } from './Workouts';

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

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function WorkoutDetail() {
  const { workoutId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [comment, setComment] = useState('');

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

  const liked = Boolean(user && (data?.likes ?? []).some((id) => String(id) === user._id));

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
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const text = comment.trim();
      if (!text) throw new Error('Comment text is required');
      const { data } = await api.post(`/workouts/interaction/${workoutId}/comment`, { text });
      return data as { comment: WorkoutComment };
    },
    onSuccess: (res) => {
      setComment('');
      qc.setQueryData<WorkoutDetailData>(queryKey, (old) =>
        old ? { ...old, comments: [...(old.comments ?? []), res.comment] } : old,
      );
      qc.invalidateQueries({ queryKey });
      toast.success('Comment added');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add comment')),
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !data)
    return (
      <div className="mx-auto w-full max-w-3xl p-4">
        <ErrorState message={errMsg(error, 'Workout not found')} onRetry={() => refetch()} />
      </div>
    );

  const cover = data.image?.uri ? mediaUrl(data.image.uri) : '';
  const comments = [...(data.comments ?? [])].reverse();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4">
      <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
        <ChevronLeft size={16} /> Back
      </button>

      <Card className="overflow-hidden">
        {cover ? (
          <img src={cover} alt={data.title} className="h-56 w-full object-cover" />
        ) : (
          <div className="flex h-40 w-full items-center justify-center bg-[var(--color-surface-2)]">
            <Dumbbell size={40} />
          </div>
        )}
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-bold">{data.title}</h1>
            <button
              type="button"
              className="btn btn-ghost"
              aria-pressed={liked}
              onClick={() => like.mutate()}
              disabled={like.isPending}
            >
              <Heart size={16} /> {(data.likes ?? []).length}
            </button>
          </div>

          {data.description && <p className="text-[var(--color-muted)]">{data.description}</p>}

          <div className="flex flex-wrap gap-2">
            <Badge>{data.category}</Badge>
            {data.level && <Badge>{data.level}</Badge>}
            {data.isPremade && <Badge>premade</Badge>}
            {(data.hashtags ?? []).map((tag) => (
              <Badge key={tag}>#{tag}</Badge>
            ))}
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-[var(--color-muted)]">
            <span className="inline-flex items-center gap-1">
              <Activity size={14} /> {data.exercises?.length ?? 0} exercises
            </span>
            {data.duration ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={14} /> {data.duration} min
              </span>
            ) : null}
            {data.caloriesBurned ? (
              <span className="inline-flex items-center gap-1">
                <Dumbbell size={14} /> {data.caloriesBurned} cal
              </span>
            ) : null}
          </div>

          {data.createdBy && (
            <Link
              to={`/u/${data.createdBy.username ?? ''}`}
              className="inline-flex items-center gap-2 pt-1"
            >
              <Avatar
                src={mediaUrl(data.createdBy.avatar)}
                alt={data.createdBy.username ?? ''}
                size={28}
              />
              <span className="text-sm">
                {data.createdBy.fullName || `@${data.createdBy.username ?? 'unknown'}`}
              </span>
            </Link>
          )}
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Exercises</h2>
        {(data.exercises ?? []).length === 0 ? (
          <EmptyState
            icon={<Activity size={24} />}
            title="No exercises"
            description="This workout has no exercises listed."
          />
        ) : (
          <ol className="space-y-2">
            {(data.exercises ?? []).map((ex, i) => (
              <li key={ex._id ?? `${ex.name}-${i}`} className="card flex items-center gap-3 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-sm font-semibold">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{ex.name}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {[
                      ex.sets ? `${ex.sets} sets` : null,
                      ex.reps ? `${ex.reps} reps` : null,
                      ex.weight ? `${ex.weight} kg` : null,
                      ex.duration ? `${ex.duration} min` : null,
                      ex.rest ? `${ex.rest}s rest` : null,
                      ex.distance ? `${ex.distance} km` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No details'}
                  </p>
                  {ex.notes && <p className="mt-1 text-xs text-[var(--color-muted)]">{ex.notes}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Comments ({comments.length})</h2>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addComment.mutate();
          }}
        >
          <Input
            placeholder="Add a comment…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={addComment.isPending}>
            Post
          </Button>
        </form>

        {comments.length === 0 ? (
          <EmptyState title="No comments yet" description="Be the first to leave a comment." />
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => {
              const author = typeof c.user === 'object' && c.user ? c.user : undefined;
              return (
                <li key={c._id} className="card flex gap-3 p-3">
                  <Avatar src={mediaUrl(author?.avatar)} alt={author?.username ?? ''} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">
                        {author?.fullName || author?.username || 'User'}
                      </span>
                      <span className="text-xs text-[var(--color-muted)]">
                        {safeDate(c.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm break-words">{c.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
