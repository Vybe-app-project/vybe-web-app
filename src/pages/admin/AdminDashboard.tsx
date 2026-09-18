import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { adminApi, errMsg } from '../../lib/api';
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonTile,
  StatGrid,
  StatTile,
  VIZ,
  chartTheme,
  formatStat,
  plural,
} from '../../components/ui';
import {
  Users,
  FileText,
  Dumbbell,
  Utensils,
  MapPin,
  Activity,
  TrendingUp,
  BarChart as BarChartIcon,
} from '../../components/icons';
import { AdminPageHeader } from './AdminLayout';

/* --------------------------------------------------------------- types */

type Analytics = {
  userCount?: number;
  postCount?: number;
  workoutCount?: number;
  mealCount?: number;
  gymCount?: number;
  active7d?: number;
  active30d?: number;
  userGrowth?: Array<Record<string, any>>;
  postGrowth?: Array<Record<string, any>>;
  [k: string]: any;
};

type MoreAnalytics = {
  activeUsers?: Array<{
    user?: { name?: string; email?: string; avatar?: string };
    postCount?: number;
  }>;
  trendingPosts?: Array<{
    _id?: string;
    content?: string;
    category?: string;
    createdAt?: string;
    author?: { name?: string; fullName?: string; username?: string; avatar?: string };
    /** Counters from the engagement-ranked aggregation; arrays are the legacy shape. */
    likeCount?: number;
    commentCount?: number;
    engagement?: number;
    likes?: unknown[];
    comments?: unknown[];
  }>;
  [k: string]: any;
};

/**
 * Categorical set for the console, taken from the shared chart theme. The
 * console accent is amber, so the sand (`carbs`) hue is skipped to keep the
 * four content types distinguishable.
 */
const ADMIN_SERIES: string[] = [VIZ.brand, VIZ.protein, VIZ.alt, VIZ.fat];
const seriesAt = (i: number) => ADMIN_SERIES[i % ADMIN_SERIES.length];

/* ----------------------------------------------------------- utilities */

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const fmtCount = (v: number | null): string => (v === null ? '—' : v.toLocaleString());

/** Series come back in a few shapes across API versions; normalise defensively. */
function toSeries(raw: unknown, valueKeys: string[]): Array<{ label: string; value: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row: any) => {
      if (!row || typeof row !== 'object') return null;
      const rawLabel =
        row.date ?? row.day ?? row.label ?? row.month ?? row.period ??
        (row._id && typeof row._id === 'object'
          ? [row._id.year, row._id.month, row._id.day].filter(Boolean).join('-')
          : row._id);
      if (rawLabel == null) return null;
      let label = String(rawLabel);
      if (/^\d{4}-\d{2}-\d{2}/.test(label)) {
        try { label = format(parseISO(label), 'MMM d'); } catch { /* keep raw */ }
      }
      let value: number | null = null;
      for (const key of valueKeys) {
        const n = num(row[key]);
        if (n !== null) { value = n; break; }
      }
      if (value === null) return null;
      return { label, value };
    })
    .filter((d): d is { label: string; value: number } => d !== null);
}

/* -------------------------------------------------------------- pieces */

function ChartCard({
  title,
  subtitle,
  children,
  empty,
  emptyTitle = 'No data for this window',
  emptyMessage = 'This fills in as activity is recorded.',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader title={title} subtitle={subtitle} />
      {empty ? (
        <EmptyState
          variant="no-results"
          icon={<BarChartIcon size={24} />}
          title={emptyTitle}
          message={emptyMessage}
          size="sm"
        />
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {children as any}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function GrowthChart({
  data,
  name,
  color,
  gradientId,
}: {
  data: Array<{ label: string; value: number }>;
  name: string;
  color: string;
  gradientId: string;
}) {
  return (
    <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={chartTheme.areaFill.start} />
          <stop offset="100%" stopColor={color} stopOpacity={chartTheme.areaFill.end} />
        </linearGradient>
      </defs>
      <CartesianGrid {...chartTheme.cartesianGrid} strokeDasharray="3 3" />
      <XAxis dataKey="label" {...chartTheme.axisProps} />
      <YAxis {...chartTheme.axisProps} allowDecimals={false} width={44} tickFormatter={(v: number) => formatStat(v, { compact: true })} />
      <Tooltip {...chartTheme.tooltip} cursor={{ stroke: chartTheme.tooltip.cursor.stroke }} />
      <Area
        type="monotone"
        dataKey="value"
        name={name}
        stroke={color}
        strokeWidth={2}
        fill={`url(#${gradientId})`}
        animationDuration={chartTheme.animationDuration}
      />
    </AreaChart>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3 w-72" />
      </div>
      <StatGrid>
        {Array.from({ length: 8 }).map((_, i) => <SkeletonTile key={i} />)}
      </StatGrid>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-4 h-56 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function AdminDashboard() {
  const analytics = useQuery<Analytics>({
    queryKey: ['admin', 'analytics'],
    queryFn: async () => (await adminApi.get('/admin/analytics')).data ?? {},
    staleTime: 60_000,
  });

  const more = useQuery<MoreAnalytics>({
    queryKey: ['admin', 'more-analytics'],
    queryFn: async () => (await adminApi.get('/admin/more-analytics')).data ?? {},
    staleTime: 60_000,
  });

  const a = analytics.data ?? {};

  const userGrowth = useMemo(
    () => toSeries(a.userGrowth ?? a.usersOverTime ?? a.userSignups, ['count', 'users', 'value', 'total']),
    [a],
  );
  const postGrowth = useMemo(
    () => toSeries(a.postGrowth ?? a.postsOverTime ?? a.posts, ['count', 'posts', 'value', 'total']),
    [a],
  );

  /** Content mix is always derivable from the top-level counters. */
  const contentMix = useMemo(
    () =>
      [
        { name: 'Posts', value: num(a.postCount) },
        { name: 'Workouts', value: num(a.workoutCount) },
        { name: 'Meals', value: num(a.mealCount) },
        { name: 'Gyms', value: num(a.gymCount) },
      ].filter((d): d is { name: string; value: number } => d.value !== null && d.value > 0),
    [a],
  );

  const engagement = useMemo(() => {
    const total = num(a.userCount);
    const d7 = num(a.active7d);
    const d30 = num(a.active30d);
    const rows: Array<{ name: string; value: number }> = [];
    if (d7 !== null) rows.push({ name: 'Active 7 days', value: d7 });
    if (d30 !== null) rows.push({ name: 'Active 30 days', value: d30 });
    if (total !== null) rows.push({ name: 'All users', value: total });
    return rows;
  }, [a]);

  const topAuthors = useMemo(
    () =>
      (more.data?.activeUsers ?? [])
        .filter((r) => r && num(r.postCount) !== null)
        .map((r) => ({
          name: r.user?.name || r.user?.email || 'Unknown',
          email: r.user?.email,
          avatar: r.user?.avatar,
          postCount: r.postCount as number,
        })),
    [more.data],
  );

  const trending = more.data?.trendingPosts ?? [];

  if (analytics.isLoading) return <DashboardSkeleton />;
  if (analytics.isError) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Dashboard" />
        <Card>
          <ErrorState
            error={analytics.error}
            retry={() => void analytics.refetch()}
            title="Could not load analytics"
          />
        </Card>
      </div>
    );
  }

  const userCount = num(a.userCount);
  const active30 = num(a.active30d);
  const postCount = num(a.postCount);
  const retention =
    userCount && active30 ? `${Math.round((active30 / userCount) * 100)}% of all users` : undefined;
  const postsPerUser =
    userCount && userCount > 0 && postCount !== null ? Math.round((postCount / userCount) * 100) / 100 : null;
  const growthSpark = (s: Array<{ value: number }>) => (s.length > 1 ? s.slice(-12).map((d) => d.value) : undefined);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Dashboard"
        subtitle="Platform-wide totals and engagement from the analytics endpoints. Counts refresh every minute."
      />

      <StatGrid>
        <StatTile label="Users" value={fmtCount(userCount)} icon={<Users size={20} />} spark={growthSpark(userGrowth)} tone="brand" />
        <StatTile label="Posts" value={fmtCount(postCount)} icon={<FileText size={20} />} spark={growthSpark(postGrowth)} />
        <StatTile label="Workouts" value={fmtCount(num(a.workoutCount))} icon={<Dumbbell size={20} />} />
        <StatTile label="Meals" value={fmtCount(num(a.mealCount))} icon={<Utensils size={20} />} />
        <StatTile label="Gyms" value={fmtCount(num(a.gymCount))} icon={<MapPin size={20} />} />
        <StatTile label="Active, 7 days" value={fmtCount(num(a.active7d))} icon={<Activity size={20} />} />
        <StatTile label="Active, 30 days" value={fmtCount(active30)} icon={<TrendingUp size={20} />} hint={retention} />
        <StatTile
          label="Posts per user"
          value={postsPerUser === null ? '—' : formatStat(postsPerUser)}
          icon={<BarChartIcon size={20} />}
        />
      </StatGrid>

      {/* Time series */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <ChartCard
          title="User growth"
          subtitle="New accounts per day, last 30 days"
          empty={userGrowth.length === 0}
          emptyTitle="No sign-ups in the last 30 days"
          emptyMessage="New accounts appear here per day as members register."
        >
          <GrowthChart data={userGrowth} name="Users" color={seriesAt(0)} gradientId="admin-users-fill" />
        </ChartCard>
        <ChartCard
          title="Posts over time"
          subtitle="Posts published per day, last 30 days"
          empty={postGrowth.length === 0}
          emptyTitle="No posts in the last 30 days"
          emptyMessage="Published posts appear here per day as members share them."
        >
          <GrowthChart data={postGrowth} name="Posts" color={seriesAt(1)} gradientId="admin-posts-fill" />
        </ChartCard>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <ChartCard
          title="Content mix"
          subtitle="Share of records by type"
          empty={contentMix.length === 0}
          emptyTitle="Nothing to compare yet"
          emptyMessage="The mix appears once posts, workouts, meals or gyms exist."
        >
          <PieChart>
            <Pie
              data={contentMix}
              dataKey="value"
              nameKey="name"
              innerRadius={54}
              outerRadius={86}
              paddingAngle={3}
              stroke="none"
              animationDuration={chartTheme.animationDuration}
            >
              {contentMix.map((_, i) => (
                <Cell key={i} fill={seriesAt(i)} />
              ))}
            </Pie>
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: chartTheme.fontSize, color: chartTheme.text }}
            />
            <Tooltip {...chartTheme.tooltip} />
          </PieChart>
        </ChartCard>

        <ChartCard
          title="Engagement"
          subtitle="Members who signed in recently against the total"
          empty={engagement.length === 0}
          emptyTitle="No activity recorded yet"
          emptyMessage="Counts update as members sign in."
        >
          <BarChart data={engagement} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...chartTheme.cartesianGrid} strokeDasharray="3 3" />
            <XAxis dataKey="name" {...chartTheme.axisProps} />
            <YAxis {...chartTheme.axisProps} allowDecimals={false} width={44} tickFormatter={(v: number) => formatStat(v, { compact: true })} />
            <Tooltip {...chartTheme.tooltip} cursor={{ fill: chartTheme.tooltip.cursor.fill, opacity: chartTheme.tooltip.cursor.opacity }} />
            <Bar dataKey="value" name="Accounts" radius={[6, 6, 0, 0]} animationDuration={chartTheme.animationDuration}>
              {engagement.map((_, i) => (
                <Cell key={i} fill={seriesAt(i)} />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>
      </div>

      {/* Secondary analytics */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Most active authors" subtitle="By published post count" />
          {more.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ) : more.isError ? (
            <ErrorState
              error={more.error}
              retry={() => void more.refetch()}
              title="Could not load author stats"
              className="py-6"
            />
          ) : topAuthors.length === 0 ? (
            <EmptyState
              variant="no-results"
              icon={<Users size={24} />}
              title="No authors yet"
              message="Members appear here once they publish a post."
              size="sm"
            />
          ) : (
            <ol className="divide-y divide-line">
              {topAuthors.map((u, i) => (
                <li key={`${u.email ?? u.name}-${i}`} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="tabular w-5 shrink-0 text-center text-xs font-semibold text-text-3">
                    {i + 1}
                  </span>
                  <Avatar src={u.avatar} name={u.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-1">{u.name}</p>
                    {u.email ? <p className="truncate text-xs text-text-2">{u.email}</p> : null}
                  </div>
                  <Badge tone="info">
                    <span className="tabular">{plural(u.postCount, 'post')}</span>
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Trending posts" subtitle="Most likes and comments in the last 7 days" />
          {more.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : more.isError ? (
            <ErrorState
              error={more.error}
              retry={() => void more.refetch()}
              title="Trending posts are unavailable"
              message={errMsg(more.error, 'Try again in a moment.')}
              className="py-6"
            />
          ) : trending.length === 0 ? (
            <EmptyState
              variant="no-results"
              icon={<FileText size={24} />}
              title="Nothing trending this week"
              message="Posts with the most likes and comments over the last 7 days show up here."
              size="sm"
            />
          ) : (
            <ul className="divide-y divide-line">
              {trending.map((p, i) => {
                const handle = p.author?.username ? `@${p.author.username}` : undefined;
                const author = p.author?.fullName || p.author?.name || handle || 'Unknown author';
                const likes =
                  typeof p.likeCount === 'number' ? p.likeCount : Array.isArray(p.likes) ? p.likes.length : null;
                const comments =
                  typeof p.commentCount === 'number'
                    ? p.commentCount
                    : Array.isArray(p.comments) ? p.comments.length : null;
                return (
                  <li key={p._id ?? i} className="flex min-w-0 items-start gap-3 py-2.5">
                    <Avatar src={p.author?.avatar} name={author} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text-1">
                        {p.content?.trim() || <span className="text-text-3">Media post</span>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-text-2">
                        {author}
                        {handle && handle !== author ? ` ${handle}` : ''}
                        {p.category ? `, ${p.category}` : ''}
                        {p.createdAt ? ` — ${format(new Date(p.createdAt), 'MMM d, yyyy')}` : ''}
                      </p>
                    </div>
                    {likes !== null || comments !== null ? (
                      <div className="tabular w-24 shrink-0 text-right text-xs text-text-2">
                        {likes !== null ? <div>{plural(likes, 'like')}</div> : null}
                        {comments !== null ? <div>{plural(comments, 'comment')}</div> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
