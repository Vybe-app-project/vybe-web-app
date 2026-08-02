import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  Spinner,
  Tabs,
  cx,
  useToast,
} from '../components/ui';
import {
  Award,
  Calendar,
  Check,
  Clock,
  Filter,
  Star,
  Trophy,
} from '../components/icons';

/* ------------------------------------------------------------------ types */

type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
type Category =
  | 'workout'
  | 'nutrition'
  | 'social'
  | 'streak'
  | 'milestone'
  | 'special'
  | 'seasonal';

export type Achievement = {
  _id: string;
  name: string;
  title: string;
  description: string;
  category: Category;
  type?: 'single' | 'progressive' | 'recurring' | 'hidden';
  icon: string;
  iconColor?: string;
  rarity: Rarity;
  criteria: {
    type: string;
    value: number;
    timeframe?: string;
  };
  rewards?: {
    points?: number;
    coins?: number;
    experience?: number;
    badges?: string[];
    unlocks?: string[];
  };
  isSeasonal?: boolean;
  season?: { startDate?: string; endDate?: string };
  stats?: { totalEarned?: number; totalUsers?: number; completionRate?: number };
  display?: { showProgress?: boolean; showPercentage?: boolean; order?: number };
  /* Present only on GET /achievements/user */
  isEarned?: boolean;
  earnedAt?: string | null;
  progress?: number;
  required?: number;
  progressPercentage?: number;
  canClaim?: boolean;
};

type AchievementListResponse = {
  success: boolean;
  achievements: Achievement[];
  pagination?: { page: number; limit: number; total: number; pages: number };
};

type AchievementProgress = {
  current: number;
  required: number;
  percentage: number;
  canEarn: boolean;
};

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const CATEGORIES: Category[] = [
  'workout',
  'nutrition',
  'social',
  'streak',
  'milestone',
  'special',
  'seasonal',
];

/** Visual treatment per rarity tier — mirrors the server's rarityColor virtual. */
const RARITY_STYLE: Record<
  Rarity,
  { ring: string; text: string; chip: string; glow: string; label: string }
> = {
  common: {
    ring: 'border-slate-500/40',
    text: 'text-slate-300',
    chip: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    glow: '',
    label: 'Common',
  },
  uncommon: {
    ring: 'border-emerald-500/40',
    text: 'text-emerald-300',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    glow: 'shadow-[0_0_18px_-6px_rgba(16,185,129,0.6)]',
    label: 'Uncommon',
  },
  rare: {
    ring: 'border-sky-500/50',
    text: 'text-sky-300',
    chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    glow: 'shadow-[0_0_20px_-6px_rgba(56,189,248,0.65)]',
    label: 'Rare',
  },
  epic: {
    ring: 'border-purple-500/50',
    text: 'text-purple-300',
    chip: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    glow: 'shadow-[0_0_24px_-6px_rgba(168,85,247,0.7)]',
    label: 'Epic',
  },
  legendary: {
    ring: 'border-amber-400/60',
    text: 'text-amber-300',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    glow: 'shadow-[0_0_28px_-6px_rgba(251,191,36,0.8)]',
    label: 'Legendary',
  },
};

const RARITY_ORDER: Record<Rarity, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

const CATEGORY_LABEL: Record<Category, string> = {
  workout: 'Training',
  nutrition: 'Nutrition',
  social: 'Community',
  streak: 'Consistency',
  milestone: 'Milestones',
  special: 'Special',
  seasonal: 'Seasonal',
};

const rarityOf = (a: Achievement): Rarity =>
  RARITIES.includes(a.rarity) ? a.rarity : 'common';

const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy') : '';
};

const tzOffset = () => new Date().getTimezoneOffset() * -1;

/* --------------------------------------------------------------- sub views */

function ProgressBar({ percent, rarity }: { percent: number; rarity: Rarity }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-500',
          rarity === 'legendary'
            ? 'bg-amber-400'
            : rarity === 'epic'
              ? 'bg-purple-400'
              : rarity === 'rare'
                ? 'bg-sky-400'
                : rarity === 'uncommon'
                  ? 'bg-emerald-400'
                  : 'bg-slate-400',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function AchievementCard({
  achievement,
  onClaim,
  claiming,
  onOpen,
}: {
  achievement: Achievement;
  onClaim: () => void;
  claiming: boolean;
  onOpen: () => void;
}) {
  const rarity = rarityOf(achievement);
  const style = RARITY_STYLE[rarity];
  const earned = Boolean(achievement.isEarned);
  const required = achievement.required ?? achievement.criteria?.value ?? 1;
  const current = achievement.progress ?? 0;
  const percent =
    achievement.progressPercentage ??
    (required > 0 ? Math.min((current / required) * 100, 100) : 0);
  const claimable = Boolean(achievement.canClaim) && !earned;

  return (
    <Card
      className={cx(
        'flex h-full flex-col gap-3 border p-4 transition',
        style.ring,
        earned ? style.glow : 'opacity-95',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cx(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-xl',
            style.ring,
            earned ? '' : 'grayscale',
          )}
          style={{
            backgroundColor: `${achievement.iconColor || '#667eea'}22`,
          }}
          aria-hidden="true"
        >
          {achievement.icon || '🏅'}
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            className="block w-full truncate text-left text-sm font-bold hover:underline"
          >
            {achievement.title}
          </button>
          <p className="line-clamp-2 text-xs leading-relaxed text-[var(--color-muted)]">
            {achievement.description}
          </p>
        </div>
        {earned ? (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
            title="Earned"
          >
            <Check size={13} />
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cx(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            style.chip,
          )}
        >
          <Star size={11} /> {style.label}
        </span>
        {achievement.isSeasonal ? (
          <Badge tone="warning">
            <Calendar size={11} /> Seasonal
          </Badge>
        ) : null}
        {achievement.rewards?.points ? (
          <Badge tone="brand">+{achievement.rewards.points} pts</Badge>
        ) : null}
        {achievement.rewards?.experience ? (
          <Badge tone="info">+{achievement.rewards.experience} XP</Badge>
        ) : null}
      </div>

      {earned ? (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300">
          <Trophy size={12} /> Earned{' '}
          {fmtDate(achievement.earnedAt) || 'recently'}
        </p>
      ) : (
        <div className="space-y-1">
          <ProgressBar percent={percent} rarity={rarity} />
          <p className="text-[11px] text-[var(--color-muted)]">
            {Math.round(current)} / {Math.round(required)} {achievement.criteria?.type} ·{' '}
            {Math.round(percent)}%
          </p>
        </div>
      )}

      <div className="mt-auto pt-1">
        {claimable ? (
          <Button variant="primary" block loading={claiming} onClick={onClaim}>
            <Award size={15} /> Claim reward
          </Button>
        ) : (
          <Button variant="ghost" block onClick={onOpen}>
            Details
          </Button>
        )}
      </div>
    </Card>
  );
}

function DetailModal({
  achievement,
  onClose,
}: {
  achievement: Achievement | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['achievements', 'progress', achievement?._id],
    queryFn: async (): Promise<AchievementProgress> => {
      const { data } = await api.get<{ success: boolean; progress: AchievementProgress }>(
        `/achievements/${achievement?._id}/progress`,
        { params: { timezoneOffsetMinutes: tzOffset() } },
      );
      return data.progress;
    },
    enabled: !!achievement,
  });

  const rarity = achievement ? rarityOf(achievement) : 'common';
  const style = RARITY_STYLE[rarity];

  return (
    <Modal open={!!achievement} onClose={onClose} title={achievement?.title || 'Achievement'}>
      {achievement ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div
              className={cx(
                'flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl',
                style.ring,
              )}
              style={{ backgroundColor: `${achievement.iconColor || '#667eea'}22` }}
              aria-hidden="true"
            >
              {achievement.icon || '🏅'}
            </div>
            <div className="min-w-0">
              <p className={cx('text-sm font-bold', style.text)}>{style.label}</p>
              <p className="text-xs text-[var(--color-muted)] capitalize">
                {CATEGORY_LABEL[achievement.category] ?? achievement.category}
              </p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-[var(--color-muted)]">
            {achievement.description}
          </p>

          {isLoading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : isError ? (
            <ErrorState error={error} title="Progress unavailable" retry={() => refetch()} />
          ) : data ? (
            <div className="space-y-2 rounded-xl border border-[var(--color-line)] p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">Progress</span>
                <span>
                  {Math.round(data.current)} / {Math.round(data.required)}{' '}
                  {achievement.criteria?.type}
                </span>
              </div>
              <ProgressBar percent={data.percentage} rarity={rarity} />
              <p className="text-xs text-[var(--color-muted)]">
                {data.canEarn
                  ? 'Criteria met — this one is ready to claim.'
                  : `${Math.round(data.percentage)}% of the way there.`}
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[var(--color-surface-2)] p-3 text-center">
              <p className="text-xs text-[var(--color-muted)]">Points</p>
              <p className="text-lg font-bold">{achievement.rewards?.points ?? 0}</p>
            </div>
            <div className="rounded-xl bg-[var(--color-surface-2)] p-3 text-center">
              <p className="text-xs text-[var(--color-muted)]">Coins</p>
              <p className="text-lg font-bold">{achievement.rewards?.coins ?? 0}</p>
            </div>
            <div className="rounded-xl bg-[var(--color-surface-2)] p-3 text-center">
              <p className="text-xs text-[var(--color-muted)]">XP</p>
              <p className="text-lg font-bold">{achievement.rewards?.experience ?? 0}</p>
            </div>
          </div>

          {achievement.isSeasonal && achievement.season ? (
            <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <Clock size={12} /> Season runs {fmtDate(achievement.season.startDate)} –{' '}
              {fmtDate(achievement.season.endDate)}
            </p>
          ) : null}

          {typeof achievement.stats?.totalEarned === 'number' ? (
            <p className="text-xs text-[var(--color-muted)]">
              Earned by {achievement.stats.totalEarned} athlete
              {achievement.stats.totalEarned === 1 ? '' : 's'}.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="space-y-3 p-4">
          <div className="flex gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

type TabKey = 'mine' | 'all' | 'seasonal';

export default function Achievements() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);

  const [tab, setTab] = useState<TabKey>('mine');
  const [category, setCategory] = useState<'' | Category>('');
  const [rarity, setRarity] = useState<'' | Rarity>('');
  const [detail, setDetail] = useState<Achievement | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  /* Personalised list: earned flags, progress and claimability. */
  const userAchievements = useQuery({
    queryKey: ['achievements', 'user', category, rarity],
    queryFn: async (): Promise<Achievement[]> => {
      const { data } = await api.get<AchievementListResponse>('/achievements/user', {
        params: {
          timezoneOffsetMinutes: tzOffset(),
          ...(category ? { category } : {}),
          ...(rarity ? { rarity } : {}),
        },
      });
      return data.achievements ?? [];
    },
    enabled: tab === 'mine',
  });

  /* Catalogue view — narrowed server-side when a single facet is selected. */
  const catalogue = useQuery({
    queryKey: ['achievements', 'catalogue', category, rarity],
    queryFn: async (): Promise<Achievement[]> => {
      const path = category
        ? `/achievements/category/${category}`
        : rarity
          ? `/achievements/rarity/${rarity}`
          : '/achievements';
      const { data } = await api.get<AchievementListResponse>(path, {
        params: { limit: 100, page: 1 },
      });
      const list = data.achievements ?? [];
      // When both facets are set, the second one is applied client-side.
      return category && rarity ? list.filter((a) => a.rarity === rarity) : list;
    },
    enabled: tab === 'all',
  });

  const seasonal = useQuery({
    queryKey: ['achievements', 'seasonal'],
    queryFn: async (): Promise<Achievement[]> => {
      const { data } = await api.get<AchievementListResponse>('/achievements/seasonal', {
        params: { limit: 50 },
      });
      return data.achievements ?? [];
    },
    enabled: tab === 'seasonal',
  });

  const claim = useMutation({
    mutationFn: async (achievement: Achievement) => {
      setClaimingId(achievement._id);
      const { data } = await api.post<{
        success: boolean;
        message: string;
        rewards: { points: number; coins: number; experience: number };
      }>(`/achievements/${achievement._id}/claim`, null, {
        params: { timezoneOffsetMinutes: tzOffset() },
      });
      return data.rewards;
    },
    onSuccess: (rewards) => {
      const parts = [
        rewards?.points ? `${rewards.points} pts` : '',
        rewards?.coins ? `${rewards.coins} coins` : '',
        rewards?.experience ? `${rewards.experience} XP` : '',
      ].filter(Boolean);
      toast.success(parts.length ? `Claimed — ${parts.join(' · ')}` : 'Achievement claimed');
      qc.invalidateQueries({ queryKey: ['achievements'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not claim achievement')),
    onSettled: () => setClaimingId(null),
  });

  const active = (() => {
    if (tab === 'mine') return userAchievements;
    if (tab === 'all') return catalogue;
    return seasonal;
  })();

  const items = useMemo(() => {
    let list = active.data ?? [];
    if (tab === 'seasonal') {
      if (category) list = list.filter((a) => a.category === category);
      if (rarity) list = list.filter((a) => a.rarity === rarity);
    }
    return list;
  }, [active.data, tab, category, rarity]);

  const grouped = useMemo(() => {
    const buckets = new Map<Category, Achievement[]>();
    for (const a of items) {
      const key = (CATEGORIES.includes(a.category) ? a.category : 'special') as Category;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(a);
      else buckets.set(key, [a]);
    }
    for (const bucket of buckets.values()) {
      bucket.sort((x, y) => {
        const earnedDelta = Number(Boolean(y.canClaim)) - Number(Boolean(x.canClaim));
        if (earnedDelta !== 0) return earnedDelta;
        return RARITY_ORDER[rarityOf(y)] - RARITY_ORDER[rarityOf(x)] === 0
          ? x.title.localeCompare(y.title)
          : RARITY_ORDER[rarityOf(x)] - RARITY_ORDER[rarityOf(y)];
      });
    }
    return CATEGORIES.filter((c) => buckets.has(c)).map(
      (c) => [c, buckets.get(c) as Achievement[]] as const,
    );
  }, [items]);

  const earnedCount = items.filter((a) => a.isEarned).length;
  const claimableCount = items.filter((a) => a.canClaim && !a.isEarned).length;
  const totalPoints = items.reduce(
    (sum, a) => (a.isEarned ? sum + (a.rewards?.points ?? 0) : sum),
    0,
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      <header>
        <h1 className="text-2xl font-bold">Achievements</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {me?.fullName || me?.username
            ? `Every badge you have chased, ${me.fullName || me.username}.`
            : 'Every badge you have chased — and the ones still in reach.'}
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3">
          <p className="text-xs text-[var(--color-muted)]">Earned</p>
          <p className="text-xl font-bold">
            {active.isLoading ? '—' : `${earnedCount}/${items.length}`}
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-[var(--color-muted)]">Ready to claim</p>
          <p
            className={cx(
              'text-xl font-bold',
              claimableCount > 0 ? 'text-amber-300' : '',
            )}
          >
            {active.isLoading ? '—' : claimableCount}
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-[var(--color-muted)]">Points banked</p>
          <p className="text-xl font-bold">{active.isLoading ? '—' : totalPoints}</p>
        </Card>
      </div>

      <Tabs
        fill
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          { key: 'mine', label: 'My progress', icon: <Trophy size={15} /> },
          { key: 'all', label: 'All badges', icon: <Award size={15} /> },
          { key: 'seasonal', label: 'Seasonal', icon: <Calendar size={15} /> },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Filter size={13} /> Filter
        </span>
        <select
          className="input-base w-40 capitalize"
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value as '' | Category)}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          className="input-base w-40 capitalize"
          aria-label="Filter by rarity"
          value={rarity}
          onChange={(e) => setRarity(e.target.value as '' | Rarity)}
        >
          <option value="">All rarities</option>
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {RARITY_STYLE[r].label}
            </option>
          ))}
        </select>
        {active.isFetching && !active.isLoading ? <Spinner size={14} /> : null}
      </div>

      {active.isLoading ? (
        <GridSkeleton />
      ) : active.isError ? (
        <ErrorState
          error={active.error}
          title="Could not load achievements"
          retry={() => active.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Award size={24} />}
          title={
            tab === 'seasonal'
              ? 'No seasonal badges running'
              : category || rarity
                ? 'No achievements match those filters'
                : 'No achievements available yet'
          }
          message={
            category || rarity
              ? 'Try widening the category or rarity filter.'
              : 'Log workouts, meals and streaks — badges unlock as you go.'
          }
          action={
            category || rarity ? (
              <Button
                variant="primary"
                onClick={() => {
                  setCategory('');
                  setRarity('');
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([cat, list]) => (
            <section key={cat} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{CATEGORY_LABEL[cat]}</h2>
                <span className="text-xs text-[var(--color-muted)]">
                  {list.filter((a) => a.isEarned).length}/{list.length} earned
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((achievement) => (
                  <AchievementCard
                    key={achievement._id}
                    achievement={achievement}
                    claiming={claimingId === achievement._id && claim.isPending}
                    onClaim={() => claim.mutate(achievement)}
                    onOpen={() => setDetail(achievement)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <DetailModal achievement={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
