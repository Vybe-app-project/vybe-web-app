import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Menu,
  PageHeader,
  Section,
  Skeleton,
  StatTile,
  Textarea,
  VIZ,
  cx,
  formatStat,
  usePulse,
  useToast,
} from './ui';
import type { MenuItem } from './ui';
import { Utensils, Heart, Clock, Trash, Flag, ShareUp, Link as LinkIcon, Send, BadgeCheck } from './icons';
import { MacroLine, mealTypeLabel, plural, type Meal } from './Meals';
import { useReportModal } from './Report';

type CommentAuthor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
  isIdentityVerified?: boolean;
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
  { key: 'calories', label: 'Calories', unit: 'kcal', color: VIZ.kcal },
  { key: 'protein', label: 'Protein', unit: 'g', color: VIZ.protein },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: VIZ.carbs },
  { key: 'fat', label: 'Fat', unit: 'g', color: VIZ.fat },
] as const;

const MICROS = [
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'sugar', label: 'Sugar', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
] as const;

function MacroDot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
}

function DetailSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading meal">
      <PageHeader title="Meal" />
      <div className="card overflow-hidden">
        <Skeleton className="aspect-[16/9] w-full max-h-72 rounded-none" />
        <div className="space-y-4 p-4 sm:p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export default function MealDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const pulse = usePulse();
  const { report, reportModal } = useReportModal();
  const [text, setText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

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
          likes: liked ? (previous.likes ?? []).filter((v) => String(v) !== user._id) : [...(previous.likes ?? []), user._id],
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
      if (!value) throw new Error('Write a comment first');
      const { data } = await api.post(`/meals/${id}/comments`, { text: value });
      return data as { comment: MealComment };
    },
    onSuccess: (res) => {
      setText('');
      qc.setQueryData<CommentsResponse>(commentsKey, (old) =>
        old ? { ...old, comments: [res.comment, ...old.comments], total: old.total + 1 } : { comments: [res.comment], total: 1, page: 1, hasNextPage: false },
      );
      qc.invalidateQueries({ queryKey: commentsKey });
      toast.success('Comment posted');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not post comment')),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/meals/${id}`);
    },
    onSuccess: () => {
      toast.success('Meal deleted');
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
      navigate('/meals', { replace: true, viewTransition: true });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete meal')),
    onSettled: () => setConfirmDelete(false),
  });

  const share = async () => {
    if (!meal) return;
    const url = `${location.origin}/meals/${meal._id}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${meal.food_name} on Vybe`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      toast.error('Could not share this meal');
    }
  };

  const copyLink = async () => {
    if (!meal) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/meals/${meal._id}`);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  if (mealQuery.isLoading) return <DetailSkeleton />;

  if (mealQuery.isError || !meal) {
    const status = (mealQuery.error as { response?: { status?: number } } | null)?.response?.status;
    const missing = status === 404;
    return (
      <div className="space-y-8">
        <PageHeader title="Meal" />
        <Card padded={false}>
          <ErrorState
            title={missing ? 'This meal is gone' : 'Couldn’t load this meal'}
            message={missing ? 'It may have been deleted, or the link is wrong.' : errMsg(mealQuery.error, 'Try again in a moment.')}
            onRetry={missing ? undefined : () => mealQuery.refetch()}
            action={
              missing ? (
                <ButtonLink to="/meals" variant="primary">
                  Back to meals
                </ButtonLink>
              ) : undefined
            }
          />
        </Card>
      </div>
    );
  }

  const author = typeof meal.user === 'object' && meal.user ? meal.user : undefined;
  const ownerId = typeof meal.user === 'object' && meal.user ? meal.user._id : typeof meal.user === 'string' ? meal.user : undefined;
  const isOwner = Boolean(user && ownerId && String(ownerId) === user._id);
  const ts = meal.timestamp ? parseISO(meal.timestamp) : null;
  const when = ts && isValid(ts) ? ts : null;
  const comments = commentsQuery.data?.comments ?? [];
  const commentCount = commentsQuery.data?.total ?? comments.length;
  const likeCount = (meal.likes ?? []).length;
  const hasMicros = MICROS.some((m) => (meal.nutrition?.[m.key] ?? 0) > 0);

  const menuItems: MenuItem[] = [
    { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void share() },
    { label: 'Copy link', icon: <LinkIcon size={18} />, onSelect: () => void copyLink() },
    ...(isOwner
      ? [{ label: 'Delete meal', icon: <Trash size={18} />, danger: true, divider: true, onSelect: () => setConfirmDelete(true) } as MenuItem]
      : [{ label: 'Report meal', icon: <Flag size={18} />, danger: true, divider: true, onSelect: () => report({ targetType: 'meal', targetId: meal._id, targetLabel: meal.food_name }) } as MenuItem]),
  ];
  const menu = <Menu label="Meal options" items={menuItems} />;

  const subtitle = when
    ? `${mealTypeLabel(meal.meal_type)} on ${format(when, 'EEEE d MMMM')} at ${format(when, 'p')}`
    : mealTypeLabel(meal.meal_type);

  return (
    <div className="space-y-8">
      <PageHeader title={meal.food_name} subtitle={subtitle} actions={menu} mobileActions={menu} />

      <Card padded={false} className="overflow-hidden">
        {meal.image_url ? (
          <img src={mediaUrl(meal.image_url)} alt={meal.food_name} className="aspect-[16/9] max-h-[420px] w-full bg-surface-2 object-cover" />
        ) : (
          <div className="flex aspect-[16/9] max-h-56 w-full items-center justify-center bg-surface-2 text-text-3">
            <Utensils size={48} />
          </div>
        )}

        <div className="space-y-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-2">
            <Badge tone="brand">{mealTypeLabel(meal.meal_type)}</Badge>
            {when ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={14} />
                <time dateTime={meal.timestamp}>{format(when, 'p')}</time>
              </span>
            ) : null}
            {meal.serving_size ? <span>{meal.serving_size}</span> : null}
            <button
              type="button"
              className={cx(
                'ml-auto inline-flex h-11 items-center gap-2 rounded-sm px-3 text-sm font-semibold transition-colors dur-1',
                liked ? 'text-accent-text' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
              )}
              aria-pressed={liked}
              aria-label={liked ? `Unlike. ${likeCount} ${plural(likeCount, 'like')}` : `Like. ${likeCount} ${plural(likeCount, 'like')}`}
              onClick={() => {
                pulse.pulse();
                like.mutate();
              }}
              disabled={like.isPending}
            >
              <Heart size={20} filled={liked} className={cx(pulse.className, liked && 'text-accent')} />
              <span className="tabular">{formatStat(likeCount)}</span>
            </button>
          </div>

          {author ? (
            <Link
              to={`/u/${author._id}`}
              viewTransition
              className="inline-flex min-h-11 items-center gap-3 rounded-sm pr-2 hover:bg-surface-2"
            >
              <Avatar src={author.avatar} name={author.fullName || author.username} alt="" size="md" />
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-semibold text-text-1">
                  <span className="truncate">{author.fullName || author.username || 'Vybe member'}</span>
                  {(author as CommentAuthor).isIdentityVerified ? <BadgeCheck size={16} className="shrink-0 text-brand" aria-label="Verified" role="img" /> : null}
                </span>
                {author.username ? <span className="block truncate text-xs text-text-2">@{author.username}</span> : null}
              </span>
            </Link>
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MACROS.map((m) => (
              <StatTile
                key={m.key}
                label={m.label}
                value={formatStat(Math.round(Number(meal.nutrition?.[m.key] ?? 0)))}
                unit={m.unit}
                icon={<MacroDot color={m.color} />}
                className="bg-surface-2 shadow-none"
              />
            ))}
          </div>

          {hasMicros ? (
            <dl className="grid grid-cols-3 gap-3 rounded-md border border-line p-3 text-sm">
              {MICROS.map((m) => (
                <div key={m.key} className="min-w-0">
                  <dt className="type-label text-text-2">{m.label}</dt>
                  <dd className="tabular mt-0.5 font-semibold text-text-1">
                    {formatStat(Math.round(meal.nutrition?.[m.key] ?? 0))}
                    <span className="ml-1 text-xs font-medium text-text-2">{m.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </Card>

      <Section title="Comments" description={`${formatStat(commentCount)} ${plural(commentCount, 'comment')}`}>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addComment.mutate();
          }}
        >
          <Textarea
            label="Add a comment"
            hideLabel
            placeholder="Add a comment…"
            rows={1}
            autoGrow
            maxRows={5}
            value={text}
            containerClassName="flex-1"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (text.trim()) addComment.mutate();
              }
            }}
          />
          <Button type="submit" variant="primary" icon={<Send size={18} />} loading={addComment.isPending} disabled={!text.trim()}>
            Post
          </Button>
        </form>

        {commentsQuery.isLoading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading comments">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : commentsQuery.isError ? (
          <ErrorState title="Couldn’t load comments" error={commentsQuery.error} onRetry={() => commentsQuery.refetch()} />
        ) : comments.length === 0 ? (
          <EmptyState size="sm" title="No comments yet" message="Be the first to say something about this meal." />
        ) : (
          <ul className="divide-y divide-line">
            {comments.map((c) => {
              const cAuthor = typeof c.user === 'object' && c.user ? c.user : undefined;
              const name = cAuthor?.fullName || cAuthor?.username || 'Vybe member';
              return (
                <li key={c._id} className="flex gap-3 py-3">
                  {cAuthor ? (
                    <Link to={`/u/${cAuthor._id}`} viewTransition className="-m-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full" aria-label={name}>
                      <Avatar src={cAuthor.avatar} name={name} alt="" size="sm" />
                    </Link>
                  ) : (
                    <Avatar name={name} alt="" size="sm" className="shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-text-1">{name}</span>
                      <time dateTime={c.createdAt} className="text-xs text-text-3">
                        {relative(c.createdAt)}
                      </time>
                    </div>
                    <p className="prose-measure mt-0.5 whitespace-pre-wrap break-words text-sm text-text-1">{c.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {reportModal}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this meal?"
        message={`“${meal.food_name}” will be removed from your log and today’s totals.`}
        confirmLabel="Delete meal"
        destructive
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
