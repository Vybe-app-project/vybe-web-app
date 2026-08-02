import { useQuery } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { compactNumber, timeAgo, type Post } from '../lib/hooks';
import { Button, Card, EmptyState, ErrorState, Skeleton } from './ui';
import PostCard, { PostCardSkeleton } from './PostCard';

export type ProfileTabKey = 'posts' | 'workouts' | 'meals';

export const PROFILE_TABS: { key: ProfileTabKey; label: string }[] = [
  { key: 'posts', label: 'Posts' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'meals', label: 'Meals' },
];

type WorkoutItem = {
  _id: string;
  title?: string;
  category?: string;
  level?: string;
  duration?: number;
  caloriesBurned?: number;
  createdAt?: string;
  likes?: string[];
  coverImage?: string;
};

type MealItem = {
  _id: string;
  name?: string;
  title?: string;
  image?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  createdAt?: string;
  publishedAt?: string;
};

/* ------------------------------------------------------------------ */

export function ProfilePosts({ userId }: { userId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['user-posts', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await api.get(`/posts/user/${userId}`, {
        params: { page: 1, limit: 20 },
      });
      return (data.posts || []) as Post[];
    },
  });

  if (isLoading)
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <PostCardSkeleton key={i} />
        ))}
      </div>
    );

  if (isError)
    return (
      <ErrorState
        title="Posts unavailable"
        message={errMsg(error, 'This profile may be private, or the network failed.')}
        action={
          <Button variant="primary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );

  if (!data?.length)
    return <EmptyState title="No posts yet" message="Posts shared publicly will show up here." />;

  return (
    <div className="space-y-4">
      {data.map((post) => (
        <PostCard key={post._id} post={post} invalidate={[['user-posts', userId], ['feed']]} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ProfileWorkouts({ userId, isOwn }: { userId: string; isOwn: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['user-workouts', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await api.get('/workouts/my', {
        params: { page: 1, limit: 20, ...(isOwn ? {} : { otherUserId: userId }) },
      });
      return (data.data || []) as WorkoutItem[];
    },
  });

  if (isLoading)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    );

  if (isError)
    return (
      <ErrorState
        title="Workouts unavailable"
        message={errMsg(error, 'Please try again in a moment.')}
        action={
          <Button variant="primary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );

  if (!data?.length)
    return (
      <EmptyState
        title="No workouts yet"
        message={
          isOwn
            ? 'Log a workout in the Vybe app and it will appear here.'
            : 'This athlete has not shared any workouts.'
        }
      />
    );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((w) => (
        <Card key={w._id} className="p-4">
          <div className="flex items-start gap-3">
            {w.coverImage && (
              <img
                src={mediaUrl(w.coverImage)}
                alt=""
                className="h-14 w-14 shrink-0 rounded-xl object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{w.title || 'Workout'}</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                {[w.category, w.level].filter(Boolean).join(' · ') || 'General'}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--color-muted)]">
            {!!w.duration && <span>{w.duration} min</span>}
            {!!w.caloriesBurned && <span>{compactNumber(w.caloriesBurned)} kcal</span>}
            {!!w.likes?.length && <span>{compactNumber(w.likes.length)} likes</span>}
            {w.createdAt && <span className="ml-auto">{timeAgo(w.createdAt)}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ProfileMeals({ userId, isOwn }: { userId: string; isOwn: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['user-meals', userId, isOwn],
    enabled: !!userId,
    queryFn: async () => {
      // Own meals come from the personal log; public meals from the shared list.
      const url = isOwn ? '/meals/recent' : '/meals';
      const { data } = await api.get(url, { params: { page: 1, limit: 20 } });
      const list = data.meals || data.data || [];
      return (Array.isArray(list) ? list : []) as MealItem[];
    },
  });

  if (isLoading)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );

  if (isError)
    return (
      <ErrorState
        title="Meals unavailable"
        message={errMsg(error, 'Please try again in a moment.')}
        action={
          <Button variant="primary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );

  const meals = isOwn
    ? data || []
    : (data || []).filter((m: any) => String(m.user?._id || m.user) === String(userId));

  if (!meals.length)
    return (
      <EmptyState
        title="No meals yet"
        message={
          isOwn
            ? 'Log a meal in the Vybe app to build your nutrition history.'
            : 'This athlete has not shared any meals.'
        }
      />
    );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {meals.map((m) => (
        <Card key={m._id} className="flex items-center gap-3 p-3">
          {m.image ? (
            <img
              src={mediaUrl(m.image)}
              alt=""
              className="h-14 w-14 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[var(--color-surface-2)] text-lg">
              🍽
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{m.name || m.title || 'Meal'}</p>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              {[
                m.calories != null && `${Math.round(m.calories)} kcal`,
                m.protein != null && `${Math.round(m.protein)}g protein`,
              ]
                .filter(Boolean)
                .join(' · ') || 'Nutrition not recorded'}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              {timeAgo(m.publishedAt || m.createdAt)}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}
