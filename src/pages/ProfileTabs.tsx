import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { compactNumber as compactStat, timeAgo, type Post } from '../lib/hooks';
import {
  Badge,
  Card,
  CardMedia,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonCard,
  cx,
  humanize,
} from './ui';
import { Bookmark, Dumbbell, Flame, Heart, Plate, Timer, Utensils, Image as ImageIcon } from './icons';
import PostCard from './PostCard';

export type ProfileTabKey = 'posts' | 'workouts' | 'meals' | 'saved';

export const PROFILE_TABS: { key: ProfileTabKey; label: string; icon: ReactNode; ownOnly?: boolean }[] = [
  { key: 'posts', label: 'Posts', icon: <ImageIcon size={18} /> },
  { key: 'workouts', label: 'Workouts', icon: <Dumbbell size={18} /> },
  { key: 'meals', label: 'Meals', icon: <Utensils size={18} /> },
  // Bookmarks are private: only the signed-in user's own profile lists them.
  { key: 'saved', label: 'Saved', icon: <Bookmark size={18} />, ownOnly: true },
];

export const isProfileTab = (v: string | null | undefined): v is ProfileTabKey =>
  v === 'posts' || v === 'workouts' || v === 'meals' || v === 'saved';

/** Tabs another visitor may open on someone's profile. */
export const PUBLIC_PROFILE_TABS = PROFILE_TABS.filter((t) => !t.ownOnly);

/** Shape of `GET /workouts/my` items (SocialWorkout). */
export type WorkoutItem = {
  _id: string;
  title?: string;
  category?: string;
  level?: string;
  duration?: number;
  caloriesBurned?: number;
  createdAt?: string;
  likes?: string[];
  /** Search results send a count instead of the id list. */
  likeCount?: number;
  image?: { uri?: string } | string | null;
  exercises?: unknown[];
};

/** Shape of `GET /meals/recent` and `GET /meals` items (Meal model). */
export type MealItem = {
  _id: string;
  food_name?: string;
  image_url?: string;
  meal_type?: string;
  serving_size?: string;
  nutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number };
  timestamp?: string;
  createdAt?: string;
  publishedAt?: string;
  user?: { _id: string } | string;
};

type PanelProps = {
  userId: string;
  /** Viewing your own profile: empty states offer in-app actions. */
  isOwn?: boolean;
  /** First name used in empty-state copy for other people's profiles. */
  name?: string;
};

const firstName = (name?: string) => (name || 'This athlete').trim().split(/\s+/)[0];

/** Inline metric: icon + value, separated by spacing rather than middle dots. */
function Metric({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium text-text-2', className)}>
      <span className="text-text-3" aria-hidden="true">
        {icon}
      </span>
      <span className="tabular">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ posts */

export function ProfilePosts({ userId, isOwn = false, name }: PanelProps) {
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
      <div className="space-y-4" aria-busy="true" aria-label="Loading posts">
        <SkeletonCard />
        <SkeletonCard media={false} />
      </div>
    );

  if (isError)
    return (
      <ErrorState
        error={error}
        title="Posts unavailable"
        message={errMsg(error, 'This profile may be private, or the network dropped.')}
        onRetry={() => refetch()}
      />
    );

  if (!data?.length)
    return isOwn ? (
      <EmptyState
        title="No posts yet"
        message="Share a session, a PR or a meal and it shows up here for people who follow you."
        action={{ label: 'Create a post', to: '/?compose=1' }}
      />
    ) : (
      <EmptyState
        variant="no-results"
        icon={<ImageIcon size={26} />}
        title="No posts yet"
        message={`${firstName(name)} hasn’t shared anything yet.`}
      />
    );

  return (
    <div className="space-y-4">
      {data.map((post) => (
        <PostCard key={post._id} post={post} invalidate={[['user-posts', userId], ['feed']]} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ saved */

/**
 * The signed-in user's bookmarks (GET /posts/bookmarks). PostCard's save button
 * invalidates ['bookmarks'], so a card removed here disappears on refetch and
 * a post saved anywhere shows up on the next visit.
 */
export function ProfileSaved() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: async () => {
      const { data } = await api.get('/posts/bookmarks');
      return (data.bookmarks || data.posts || []) as Post[];
    },
  });

  if (isLoading)
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading saved posts">
        <SkeletonCard />
        <SkeletonCard media={false} />
      </div>
    );

  if (isError)
    return (
      <ErrorState
        error={error}
        title="Saved posts unavailable"
        message={errMsg(error, 'Your saved posts did not load.')}
        onRetry={() => refetch()}
      />
    );

  if (!data?.length)
    return (
      <EmptyState
        icon={<Bookmark size={26} />}
        title="Nothing saved yet"
        message="Tap the bookmark on any post to keep it here for later. Only you can see this list."
        action={{ label: 'Back to your feed', to: '/' }}
      />
    );

  return (
    <div className="space-y-4" aria-label="Saved posts">
      {data.map((post) => (
        <PostCard key={post._id} post={post} invalidate={[['bookmarks'], ['feed']]} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ workouts */

function workoutImage(w: WorkoutItem): string {
  if (!w.image) return '';
  if (typeof w.image === 'string') return w.image;
  return w.image.uri || '';
}

export function WorkoutTile({ workout }: { workout: WorkoutItem }) {
  const img = workoutImage(workout);
  const title = workout.title || 'Workout';
  const exerciseCount = Array.isArray(workout.exercises) ? workout.exercises.length : 0;
  return (
    <Card to={`/workouts/${workout._id}`} linkLabel={`Open ${title}`} padded={false} className="flex gap-3 p-3">
      <CardMedia className="h-16 w-16 shrink-0">
        {img ? (
          <img src={mediaUrl(img)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-text-3">
            <Dumbbell size={22} />
          </span>
        )}
      </CardMedia>
      <div className="min-w-0 flex-1">
        <p className="truncate text-md font-semibold text-text-1">{title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {workout.category ? <Badge tone="brand">{humanize(workout.category)}</Badge> : null}
          {workout.level ? <Badge>{humanize(workout.level)}</Badge> : null}
          {!workout.category && !workout.level ? <Badge>General</Badge> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {workout.duration ? <Metric icon={<Timer size={14} />}>{workout.duration} min</Metric> : null}
          {workout.caloriesBurned ? (
            <Metric icon={<Flame size={14} />}>{compactStat(workout.caloriesBurned)} kcal</Metric>
          ) : null}
          {exerciseCount ? (
            <Metric icon={<Dumbbell size={14} />}>
              {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
            </Metric>
          ) : null}
          {workout.likes?.length || workout.likeCount ? (
            <Metric icon={<Heart size={14} />}>{compactStat(workout.likes?.length ?? workout.likeCount ?? 0)}</Metric>
          ) : null}
          {workout.createdAt ? (
            <time dateTime={workout.createdAt} className="ml-auto text-xs text-text-3">
              {timeAgo(workout.createdAt)}
            </time>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function TileSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex gap-3 p-3">
          <Skeleton className="h-16 w-16 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProfileWorkouts({ userId, isOwn = false, name }: PanelProps) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['user-workouts', userId, isOwn],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await api.get('/workouts/my', {
        params: { page: 1, limit: 20, ...(isOwn ? {} : { otherUserId: userId }) },
      });
      return (data.data || []) as WorkoutItem[];
    },
  });

  if (isLoading) return <TileSkeleton />;

  if (isError)
    return (
      <ErrorState
        error={error}
        title="Workouts unavailable"
        message={errMsg(error, 'The workout list did not load.')}
        onRetry={() => refetch()}
      />
    );

  if (!data?.length)
    return isOwn ? (
      <EmptyState
        title="No workouts yet"
        message="Build your first workout, or log a session you just finished and it lands here."
        action={{ label: 'New workout', to: '/workouts?log=1', icon: <Dumbbell size={18} /> }}
        secondaryAction={{ label: 'Browse the library', to: '/workouts' }}
      />
    ) : (
      <EmptyState
        variant="no-results"
        icon={<Dumbbell size={26} />}
        title="No workouts yet"
        message={`${firstName(name)} hasn’t shared any workouts.`}
      />
    );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((w) => (
        <WorkoutTile key={w._id} workout={w} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ meals */

export function MealTile({ meal }: { meal: MealItem }) {
  const title = meal.food_name || 'Meal';
  const n = meal.nutrition || {};
  const when = meal.publishedAt || meal.timestamp || meal.createdAt;
  const hasNutrition = [n.calories, n.protein, n.carbs, n.fat].some((v) => typeof v === 'number' && v > 0);
  return (
    <Card to={`/meals/${meal._id}`} linkLabel={`Open ${title}`} padded={false} className="flex gap-3 p-3">
      <CardMedia className="h-16 w-16 shrink-0">
        {meal.image_url ? (
          <img src={mediaUrl(meal.image_url)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-text-3">
            <Plate size={22} />
          </span>
        )}
      </CardMedia>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-md font-semibold text-text-1">{title}</p>
          {meal.meal_type ? <Badge className="shrink-0">{humanize(meal.meal_type)}</Badge> : null}
        </div>
        {hasNutrition ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {n.calories ? (
              <Metric icon={<span className="block h-2 w-2 rounded-full bg-viz-kcal" />}>{Math.round(n.calories)} kcal</Metric>
            ) : null}
            {n.protein ? (
              <Metric icon={<span className="block h-2 w-2 rounded-full bg-viz-protein" />}>{Math.round(n.protein)} g protein</Metric>
            ) : null}
            {n.carbs ? (
              <Metric icon={<span className="block h-2 w-2 rounded-full bg-viz-carbs" />}>{Math.round(n.carbs)} g carbs</Metric>
            ) : null}
            {n.fat ? (
              <Metric icon={<span className="block h-2 w-2 rounded-full bg-viz-fat" />}>{Math.round(n.fat)} g fat</Metric>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 text-xs text-text-3">Nutrition not recorded</p>
        )}
        <div className="mt-1.5 flex items-center gap-x-3 text-xs text-text-3">
          {meal.serving_size ? <span className="truncate">{meal.serving_size}</span> : null}
          {when ? (
            <time dateTime={when} className="ml-auto shrink-0">
              {timeAgo(when)}
            </time>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

const ownerId = (m: MealItem) => (typeof m.user === 'string' ? m.user : m.user?._id) || '';

export function ProfileMeals({ userId, isOwn = false, name }: PanelProps) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['user-meals', userId, isOwn],
    enabled: !!userId,
    queryFn: async () => {
      // Own meals come from the personal log (a bare array); other people's
      // public meals come from the shared feed envelope and are filtered here.
      if (isOwn) {
        const { data } = await api.get('/meals/recent');
        const list = Array.isArray(data) ? data : data?.meals || data?.data || [];
        return list as MealItem[];
      }
      const { data } = await api.get('/meals', { params: { page: 1, limit: 50 } });
      const list: MealItem[] = Array.isArray(data) ? data : data?.meals || data?.data || [];
      return list.filter((m) => String(ownerId(m)) === String(userId));
    },
  });

  if (isLoading) return <TileSkeleton />;

  if (isError)
    return (
      <ErrorState
        error={error}
        title="Meals unavailable"
        message={errMsg(error, 'The meal list did not load.')}
        onRetry={() => refetch()}
      />
    );

  if (!data?.length)
    return isOwn ? (
      <EmptyState
        title="No meals yet"
        message="Log what you eat and your nutrition history builds up here, macros included."
        action={{ label: 'Log a meal', to: '/meals?log=1', icon: <Utensils size={18} /> }}
        secondaryAction={{ label: 'Meal templates', to: '/meals/templates' }}
      />
    ) : (
      <EmptyState
        variant="no-results"
        icon={<Plate size={26} />}
        title="No meals yet"
        message={`${firstName(name)} hasn’t shared any meals.`}
      />
    );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((m) => (
        <MealTile key={m._id} meal={m} />
      ))}
    </div>
  );
}
