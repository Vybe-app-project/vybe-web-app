import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
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
  useToast,
} from './ui';
import { Utensils, Heart, Clock, ChevronLeft } from './icons';
import type { Meal } from './Meals';

type CommentAuthor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
};

type MealComment = {
  _id: string;
  text: string;
  createdAt: string;
  likes?: string[];
  user?: CommentAuthor | string;
};

type CommentsResponse = {
  comments: MealComment[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

const relative = (value?: string) => {
  if (!value) return '';
  const d = parseISO(value);
  return isValid(d) ? formatDistanceToNow(d, { addSuffix: true }) : '';
};

const MACROS = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
] as const;

export default function MealDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [text, setText] = useState('');

  const mealKey = ['meal', id];
  const commentsKey = ['meal', id, 'comments'];

  const mealQuery = useQuery({
    queryKey: mealKey,
    queryFn: async (): Promise<Meal> => {
      const { data } = await api.get<Meal>(`/meals/${id}`);
      return data;
    },
    enabled: Boolean(id),
  });

  const commentsQuery = useQuery({
    queryKey: commentsKey,
    queryFn: async (): Promise<CommentsResponse> => {
      const { data } = await api.get<CommentsResponse>(`/meals/${id}/comments`, {
        params: { page: 1, limit: 100 },
      });
      return data;
    },
    enabled: Boolean(id),
  });

  const meal = mealQuery.data;
  const liked = Boolean(user && (meal?.likes ?? []).some((v) => String(v) === user._id));

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.put(`/meals/like/${id}`);
      return data as { isLiked: boolean; likesCount: number };
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: mealKey });
      const previous = qc.getQueryData<Meal>(mealKey);
      if (previous && user) {
        qc.setQueryData<Meal>(mealKey, {
          ...previous,
          likes: liked
            ? (previous.likes ?? []).filter((v) => String(v) !== user._id)
            : [...(previous.likes ?? []), user._id],
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(mealKey, ctx.previous);
      toast.error(errMsg(e, 'Could not update like'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: mealKey }),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const value = text.trim();
      if (!value) throw new Error('Comment text is required');
      const { data } = await api.post(`/meals/${id}/comments`, { text: value });
      return data as { comment: MealComment };
    },
    onSuccess: (res) => {
      setText('');
      qc.setQueryData<CommentsResponse>(commentsKey, (old) =>
        old
          ? { ...old, comments: [res.comment, ...old.comments], total: old.total + 1 }
          : { comments: [res.comment], total: 1, page: 1, hasNextPage: false },
      );
      qc.invalidateQueries({ queryKey: commentsKey });
      toast.success('Comment added');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add comment')),
  });

  if (mealQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (mealQuery.isError || !meal) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4">
        <ErrorState
          message={errMsg(mealQuery.error, 'Meal not found')}
          onRetry={() => mealQuery.refetch()}
        />
      </div>
    );
  }

  const author = typeof meal.user === 'object' && meal.user ? meal.user : undefined;
  const ts = meal.timestamp ? parseISO(meal.timestamp) : null;
  const comments = commentsQuery.data?.comments ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4">
      <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
        <ChevronLeft size={16} /> Back
      </button>

      <Card className="overflow-hidden">
        {meal.image_url ? (
          <img
            src={mediaUrl(meal.image_url)}
            alt={meal.food_name}
            className="h-64 w-full object-cover"
          />
        ) : (
          <div className="flex h-40 w-full items-center justify-center bg-[var(--color-surface-2)]">
            <Utensils size={40} />
          </div>
        )}

        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{meal.food_name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                {meal.meal_type && <Badge>{meal.meal_type}</Badge>}
                {ts && isValid(ts) && (
                  <span className="inline-flex items-center gap-1">
                    <Clock size={12} /> {format(ts, 'EEE, d MMM yyyy · HH:mm')}
                  </span>
                )}
                {meal.serving_size && <span>{meal.serving_size}</span>}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              aria-pressed={liked}
              onClick={() => like.mutate()}
              disabled={like.isPending}
            >
              <Heart size={16} /> {(meal.likes ?? []).length}
            </button>
          </div>

          {author && (
            <div className="flex items-center gap-2">
              <Avatar src={mediaUrl(author.avatar)} alt={author.username ?? ''} size={28} />
              <span className="text-sm">
                {author.fullName || `@${author.username ?? 'unknown'}`}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MACROS.map((m) => (
              <div key={m.key} className="rounded-xl bg-[var(--color-surface-2)] p-3 text-center">
                <p className="text-lg font-bold">
                  {Math.round(Number(meal.nutrition?.[m.key] ?? 0))}
                </p>
                <p className="text-[11px] text-[var(--color-muted)]">
                  {m.label} ({m.unit})
                </p>
              </div>
            ))}
          </div>

          {(meal.nutrition?.fiber || meal.nutrition?.sugar || meal.nutrition?.sodium) && (
            <p className="text-xs text-[var(--color-muted)]">
              Fiber {Math.round(meal.nutrition?.fiber ?? 0)}g · Sugar{' '}
              {Math.round(meal.nutrition?.sugar ?? 0)}g · Sodium{' '}
              {Math.round(meal.nutrition?.sodium ?? 0)}mg
            </p>
          )}
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Comments ({commentsQuery.data?.total ?? comments.length})
        </h2>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addComment.mutate();
          }}
        >
          <Input
            placeholder="Add a comment…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={addComment.isPending}>
            Post
          </Button>
        </form>

        {commentsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : commentsQuery.isError ? (
          <ErrorState
            message={errMsg(commentsQuery.error, 'Could not load comments')}
            onRetry={() => commentsQuery.refetch()}
          />
        ) : comments.length === 0 ? (
          <EmptyState title="No comments yet" description="Start the conversation." />
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => {
              const cAuthor = typeof c.user === 'object' && c.user ? c.user : undefined;
              return (
                <li key={c._id} className="card flex gap-3 p-3">
                  <Avatar src={mediaUrl(cAuthor?.avatar)} alt={cAuthor?.username ?? ''} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">
                        {cAuthor?.fullName || cAuthor?.username || 'User'}
                      </span>
                      <span className="text-xs text-[var(--color-muted)]">
                        {relative(c.createdAt)}
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
