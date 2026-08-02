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
  cx,
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
    likes?: unknown[];
    comments?: unknown[];
  }>;
  [k: string]: any;
};

const AXIS = { stroke: '#64748b', fontSize: 11 } as const;
const GRID = '#1e293b';
const PIE_COLORS = ['#7c5cff', '#22d3ee', '#f472b6', '#f59e0b', '#34d399', '#60a5fa'];

const TOOLTIP_STYLE = {
  background: '#0b0f1a',
  border: '1px solid #1e293b',
  borderRadius: 12,
  fontSize: 12,
  color: '#e2e8f0',
} as const;

/* ----------------------------------------------------------- utilities */

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function fmtCount(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString();
}

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

function KpiCard({
  label,
  value,
  icon,
  tone,
  hint,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  tone: string;
  hint?: string;
}) {
  return (
    <Card className="border-slate-800 bg-slate-950/60">
      <div className="flex items-start gap-3">
        <div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tone)}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            {label}
          </p>
          <p className="mt-1 text-2xl leading-none font-bold text-slate-50 tabular-nums">
            {fmtCount(value)}
          </p>
          {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
        </div>
      </div>
    </Card>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty: boolean;
}) {
  return (
    <Card className="border-slate-800 bg-slate-950/60">
      <CardHeader title={title} subtitle={subtitle} />
      {empty ? (
        <EmptyState
          icon={<BarChartIcon size={22} />}
          title="No data yet"
          message="This metric is not being reported by the API for the current window."
          className="py-10"
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

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="border-slate-800 bg-slate-950/60">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <Skeleton className="mt-3 h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="border-slate-800 bg-slate-950/60">
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
    if (d7 !== null) rows.push({ name: 'Active 7d', value: d7 });
    if (d30 !== null) rows.push({ name: 'Active 30d', value: d30 });
    if (total !== null) rows.push({ name: 'Total users', value: total });
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
      <ErrorState
        error={analytics.error}
        retry={() => void analytics.refetch()}
        title="Could not load analytics"
      />
    );
  }

  const retention =
    num(a.userCount) && num(a.active30d)
      ? `${Math.round(((a.active30d as number) / (a.userCount as number)) * 100)}% of all users`
      : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-50">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Platform-wide totals and engagement, refreshed from the analytics endpoints.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Users"
          value={num(a.userCount)}
          icon={<Users size={20} />}
          tone="bg-violet-500/12 text-violet-300"
        />
        <KpiCard
          label="Posts"
          value={num(a.postCount)}
          icon={<FileText size={20} />}
          tone="bg-cyan-500/12 text-cyan-300"
        />
        <KpiCard
          label="Workouts"
          value={num(a.workoutCount)}
          icon={<Dumbbell size={20} />}
          tone="bg-emerald-500/12 text-emerald-300"
        />
        <KpiCard
          label="Meals"
          value={num(a.mealCount)}
          icon={<Utensils size={20} />}
          tone="bg-amber-500/12 text-amber-300"
        />
        <KpiCard
          label="Gyms"
          value={num(a.gymCount)}
          icon={<MapPin size={20} />}
          tone="bg-pink-500/12 text-pink-300"
        />
        <KpiCard
          label="Active 7d"
          value={num(a.active7d)}
          icon={<Activity size={20} />}
          tone="bg-sky-500/12 text-sky-300"
        />
        <KpiCard
          label="Active 30d"
          value={num(a.active30d)}
          icon={<TrendingUp size={20} />}
          tone="bg-indigo-500/12 text-indigo-300"
          hint={retention}
        />
        <KpiCard
          label="Posts / user"
          value={
            num(a.userCount) && (a.userCount as number) > 0 && num(a.postCount)
              ? Math.round(((a.postCount as number) / (a.userCount as number)) * 100) / 100
              : null
          }
          icon={<BarChartIcon size={20} />}
          tone="bg-slate-500/12 text-slate-300"
        />
      </div>

      {/* Time series */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="User growth"
          subtitle="New accounts over time"
          empty={userGrowth.length === 0}
        >
          <AreaChart data={userGrowth} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#7c5cff" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: '#334155' }} />
            <Area
              type="monotone"
              dataKey="value"
              name="Users"
              stroke="#7c5cff"
              strokeWidth={2}
              fill="url(#gUsers)"
            />
          </AreaChart>
        </ChartCard>

        <ChartCard
          title="Posts over time"
          subtitle="Content published per period"
          empty={postGrowth.length === 0}
        >
          <AreaChart data={postGrowth} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="gPosts" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: '#334155' }} />
            <Area
              type="monotone"
              dataKey="value"
              name="Posts"
              stroke="#22d3ee"
              strokeWidth={2}
              fill="url(#gPosts)"
            />
          </AreaChart>
        </ChartCard>
      </div>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Content mix"
          subtitle="Share of records by type"
          empty={contentMix.length === 0}
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
            >
              {contentMix.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ChartCard>

        <ChartCard
          title="Engagement"
          subtitle="Recently active accounts vs. total"
          empty={engagement.length === 0}
        >
          <BarChart data={engagement} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#1e293b55' }} />
            <Bar dataKey="value" name="Accounts" radius={[6, 6, 0, 0]}>
              {engagement.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>
      </div>

      {/* Secondary analytics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-800 bg-slate-950/60">
          <CardHeader title="Most active authors" subtitle="By published post count" />
          {more.isLoading ? (
            <div className="space-y-3">
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
              className="py-8"
            />
          ) : topAuthors.length === 0 ? (
            <EmptyState icon={<Users size={22} />} title="No authors yet" className="py-10" />
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {topAuthors.map((u, i) => (
                <li key={`${u.email ?? u.name}-${i}`} className="flex items-center gap-3 py-2.5">
                  <span className="w-5 shrink-0 text-center font-mono text-xs text-slate-600">
                    {i + 1}
                  </span>
                  <Avatar src={u.avatar} name={u.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-100">{u.name}</p>
                    {u.email ? (
                      <p className="truncate text-[11px] text-slate-500">{u.email}</p>
                    ) : null}
                  </div>
                  <Badge tone="info">{u.postCount.toLocaleString()} posts</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-slate-800 bg-slate-950/60">
          <CardHeader title="Trending posts" subtitle="Highest engagement in the last 7 days" />
          {more.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : more.isError ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {errMsg(more.error, 'Trending posts are unavailable.')}
            </p>
          ) : trending.length === 0 ? (
            <EmptyState icon={<FileText size={22} />} title="Nothing trending" className="py-10" />
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {trending.map((p, i) => {
                const author =
                  p.author?.name || p.author?.fullName || p.author?.username || 'Unknown author';
                const likes = Array.isArray(p.likes) ? p.likes.length : null;
                const comments = Array.isArray(p.comments) ? p.comments.length : null;
                return (
                  <li key={p._id ?? i} className="flex items-start gap-3 py-2.5">
                    <Avatar src={p.author?.avatar} name={author} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-200">
                        {p.content?.trim() || <span className="text-slate-500">Media post</span>}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {author}
                        {p.category ? ` · ${p.category}` : ''}
                        {p.createdAt
                          ? ` · ${format(new Date(p.createdAt), 'MMM d, yyyy')}`
                          : ''}
                      </p>
                    </div>
                    {likes !== null || comments !== null ? (
                      <div className="shrink-0 text-right font-mono text-[11px] text-slate-500">
                        {likes !== null ? <div>{likes} likes</div> : null}
                        {comments !== null ? <div>{comments} comments</div> : null}
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
