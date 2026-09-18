import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Progress,
  Ring,
  Section,
  Select,
  Skeleton,
  Spinner,
  StatGrid,
  StatTile,
  Tabs,
  cx,
  formatStat,
  humanize,
  usePulse,
  useToast,
} from '../components/ui';
import {
  Award,
  CalendarDays,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Dumbbell,
  Flame,
  Medal,
  Plate,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
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

type ClaimRewards = { points?: number; coins?: number; experience?: number };

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

/**
 * Visual treatment per rarity tier, expressed only in semantic tokens.
 * Common is quiet, uncommon is the brand mint, rare is sky, epic is the
 * lilac viz colour (text stays `text-1` so it holds contrast in light mode),
 * legendary is gold. Ember is NOT used here — it is reserved for effort
 * (streaks and things ready to claim), per the design direction.
 */
const RARITY_STYLE: Record<
  Rarity,
  {
    label: string;
    tile: string;
    chip: string;
    bar: 'brand' | 'protein' | 'alt' | 'carbs';
    ring: 'brand' | 'protein' | 'alt' | 'carbs';
  }
> = {
  common: {
    label: 'Common',
    tile: 'bg-surface-2 text-text-2',
    chip: 'bg-surface-2 text-text-2 border border-line',
    bar: 'brand',
    ring: 'brand',
  },
  uncommon: {
    label: 'Uncommon',
    tile: 'bg-brand-soft text-brand-text',
    chip: 'bg-brand-soft text-brand-text',
    bar: 'brand',
    ring: 'brand',
  },
  rare: {
    label: 'Rare',
    tile: 'bg-info-soft text-info-text',
    chip: 'bg-info-soft text-info-text',
    bar: 'protein',
    ring: 'protein',
  },
  epic: {
    label: 'Epic',
    tile: 'bg-viz-alt/20 text-text-1 [&_svg]:text-viz-alt',
    chip: 'bg-viz-alt/20 text-text-1',
    bar: 'alt',
    ring: 'alt',
  },
  legendary: {
    label: 'Legendary',
    tile: 'bg-warning-soft text-warning-text',
    chip: 'bg-warning-soft text-warning-text',
    bar: 'carbs',
    ring: 'carbs',
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

/** One stroke icon per category — replaces the platform-dependent emoji. */
const CATEGORY_ICON: Record<Category, (props: { size?: number; filled?: boolean }) => ReactNode> = {
  workout: (p) => <Dumbbell {...p} />,
  nutrition: (p) => <Plate {...p} />,
  social: (p) => <Users {...p} />,
  streak: (p) => <Flame {...p} />,
  milestone: (p) => <Target {...p} />,
  special: (p) => <Sparkles {...p} />,
  seasonal: (p) => <CalendarDays {...p} />,
};

const rarityOf = (a: Achievement): Rarity =>
  RARITIES.includes(a.rarity) ? a.rarity : 'common';

const categoryOf = (a: Achievement): Category =>
  CATEGORIES.includes(a.category) ? a.category : 'special';

const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy') : '';
};

const tzOffset = () => new Date().getTimezoneOffset() * -1;

/** "12 / 20 workouts" — the criteria key is an enum, so humanise it. */
const criteriaLabel = (a: Achievement) => humanize(a.criteria?.type).toLowerCase();

const rewardSummary = (r?: ClaimRewards | null) =>
  [
    r?.points ? `${formatStat(r.points)} pts` : '',
    r?.coins ? `${formatStat(r.coins)} coins` : '',
    r?.experience ? `${formatStat(r.experience)} XP` : '',
  ].filter(Boolean);

/* --------------------------------------------------------------- sub views */

function RarityChip({ rarity, size = 'md' }: { rarity: Rarity; size?: 'sm' | 'md' }) {
  const style = RARITY_STYLE[rarity];
  const strong = rarity === 'epic' || rarity === 'legendary';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-xs font-semibold',
        size === 'sm' ? 'h-5 px-1.5 text-2xs' : 'h-6 px-2 text-2xs',
        style.chip,
      )}
    >
      <Star size={12} filled={strong} />
      {style.label}
    </span>
  );
}

function BadgeTile({
  achievement,
  size = 'md',
  className,
  earned,
}: {
  achievement: Achievement;
  size?: 'md' | 'lg';
  className?: string;
  earned?: boolean;
}) {
  const rarity = rarityOf(achievement);
  const Icon = CATEGORY_ICON[categoryOf(achievement)];
  return (
    <div
      className={cx(
        'flex shrink-0 items-center justify-center rounded-md',
        size === 'lg' ? 'h-16 w-16' : 'h-12 w-12',
        RARITY_STYLE[rarity].tile,
        earned === false && 'opacity-70 saturate-50',
        className,
      )}
      aria-hidden="true"
    >
      {Icon({ size: size === 'lg' ? 30 : 22 })}
    </div>
  );
}

function AchievementCard({
  achievement,
  onClaim,
  claiming,
  celebrate,
  onOpen,
}: {
  achievement: Achievement;
  onClaim: () => void;
  claiming: boolean;
  /** Flips to true once right after a successful claim to play the spring. */
  celebrate: boolean;
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
  const { className: pulseClass, pulse } = usePulse();

  useEffect(() => {
    if (celebrate) pulse();
  }, [celebrate, pulse]);

  return (
    <Card
      interactive
      padded={false}
      className={cx(
        'relative flex h-full flex-col gap-3 p-4',
        claimable && 'border-accent/40',
        earned && 'border-brand/30',
      )}
    >
      {/* Whole-card target; controls below sit above it. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${achievement.title}: details`}
        className="absolute inset-0 z-[1] rounded-[inherit]"
      />

      <div className="flex items-start gap-3">
        <BadgeTile achievement={achievement} earned={earned || claimable} className={pulseClass} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-md font-semibold text-text-1">{achievement.title}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-text-2">
            {achievement.description}
          </p>
        </div>
        {earned ? (
          <span
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text"
            aria-label="Earned"
            role="img"
          >
            <Check size={16} />
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <RarityChip rarity={rarity} />
        {achievement.isSeasonal ? (
          <Badge tone="warning">
            <CalendarDays size={12} /> Seasonal
          </Badge>
        ) : null}
        {achievement.rewards?.points ? (
          <Badge tone="brand" className="tabular">+{formatStat(achievement.rewards.points)} pts</Badge>
        ) : null}
        {achievement.rewards?.experience ? (
          <Badge tone="info" className="tabular">+{formatStat(achievement.rewards.experience)} XP</Badge>
        ) : null}
      </div>

      {earned ? (
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-text">
          <Trophy size={14} /> Earned {fmtDate(achievement.earnedAt) || 'recently'}
        </p>
      ) : (
        <div className="space-y-1.5">
          <Progress
            value={percent}
            size="sm"
            tone={claimable ? 'accent' : style.bar}
            label={`${achievement.title} progress`}
          />
          <p className="flex items-baseline justify-between text-xs text-text-2">
            <span className="tabular">
              {formatStat(current)} / {formatStat(required)} {criteriaLabel(achievement)}
            </span>
            <span className={cx('tabular font-semibold', claimable ? 'text-accent-text' : 'text-text-1')}>
              {Math.round(percent)}%
            </span>
          </p>
        </div>
      )}

      <div className="mt-auto pt-1">
        {claimable ? (
          <Button
            variant="primary"
            block
            loading={claiming}
            onClick={onClaim}
            icon={<Award size={18} />}
            className="relative z-[2]"
          >
            Claim reward
          </Button>
        ) : (
          <span className="inline-flex h-6 items-center gap-1 text-xs font-semibold text-text-2">
            Details <ChevronRight size={14} />
          </span>
        )}
      </div>
    </Card>
  );
}

function RewardTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-surface-2 p-3 text-center">
      <p className="type-label text-text-2">{label}</p>
      <p className="type-stat mt-1 text-xl text-text-1">{formatStat(value)}</p>
    </div>
  );
}

function DetailModal({
  achievement,
  onClose,
  onClaim,
  claiming,
}: {
  achievement: Achievement | null;
  onClose: () => void;
  onClaim: (a: Achievement) => void;
  claiming: boolean;
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
  const earned = Boolean(achievement?.isEarned);
  const claimable = Boolean(achievement && !earned && (achievement.canClaim || data?.canEarn));
  const percent = data?.percentage ?? achievement?.progressPercentage ?? 0;

  return (
    <Modal
      open={!!achievement}
      onClose={onClose}
      title={achievement?.title || 'Achievement'}
      description={achievement ? CATEGORY_LABEL[categoryOf(achievement)] : undefined}
      footer={
        achievement ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {claimable ? (
              <Button
                variant="primary"
                loading={claiming}
                onClick={() => onClaim(achievement)}
                icon={<Award size={18} />}
              >
                Claim reward
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {achievement ? (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <BadgeTile achievement={achievement} size="lg" earned={earned || claimable} />
            <div className="min-w-0 space-y-1.5">
              <RarityChip rarity={rarity} />
              <p className="text-sm leading-relaxed text-text-2">{achievement.description}</p>
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-28 w-full rounded-md" />
          ) : isError ? (
            <ErrorState error={error} title="Progress unavailable" retry={() => refetch()} />
          ) : (
            <div className="flex items-center gap-4 rounded-md bg-surface-2 p-4">
              <Ring
                value={earned ? 100 : percent}
                size={88}
                color={claimable ? 'accent' : style.ring}
                label="Progress"
              >
                {earned ? <CheckCircle size={28} className="text-brand" /> : <span className="text-xl">{Math.round(percent)}%</span>}
              </Ring>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="type-label text-text-2">Progress</p>
                {earned ? (
                  <>
                    <p className="text-md font-semibold text-text-1">Earned {fmtDate(achievement.earnedAt) || 'recently'}</p>
                    <p className="text-xs text-text-2">This badge is in your collection.</p>
                  </>
                ) : data ? (
                  <>
                    <p className="type-stat text-xl text-text-1">
                      {formatStat(data.current)}
                      <span className="text-text-3"> / {formatStat(data.required)}</span>
                      <span className="ml-1.5 align-baseline text-xs font-semibold tracking-normal text-text-2 [font-variation-settings:'wdth'_100]">
                        {criteriaLabel(achievement)}
                      </span>
                    </p>
                    <p className={cx('text-xs', data.canEarn ? 'font-semibold text-accent-text' : 'text-text-2')}>
                      {data.canEarn
                        ? 'Criteria met. Claim it to bank the reward.'
                        : `${formatStat(Math.max(0, data.required - data.current))} ${criteriaLabel(achievement)} to go.`}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-text-2">Progress is tracked once you log activity.</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <RewardTile label="Points" value={achievement.rewards?.points ?? 0} />
            <RewardTile label="Coins" value={achievement.rewards?.coins ?? 0} />
            <RewardTile label="XP" value={achievement.rewards?.experience ?? 0} />
          </div>

          <ul className="space-y-1.5 text-xs text-text-2">
            {achievement.isSeasonal && achievement.season ? (
              <li className="inline-flex items-center gap-1.5">
                <Clock size={14} /> Season runs {fmtDate(achievement.season.startDate)} to{' '}
                {fmtDate(achievement.season.endDate)}
              </li>
            ) : null}
            {typeof achievement.stats?.totalEarned === 'number' ? (
              <li className="flex items-center gap-1.5">
                <Users size={14} />
                <span className="tabular">
                  Earned by {formatStat(achievement.stats.totalEarned)} athlete
                  {achievement.stats.totalEarned === 1 ? '' : 's'}
                  {typeof achievement.stats.completionRate === 'number'
                    ? ` (${Math.round(achievement.stats.completionRate)}% of Vybe)`
                    : ''}
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading achievements">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="space-y-3">
          <div className="flex gap-3">
            <Skeleton className="h-12 w-12 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
          <Skeleton className="h-6 w-24 rounded-xs" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="h-11 w-full rounded-sm" />
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
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);

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
        rewards: ClaimRewards;
      }>(`/achievements/${achievement._id}/claim`, null, {
        params: { timezoneOffsetMinutes: tzOffset() },
      });
      return { achievement, rewards: data.rewards };
    },
    onSuccess: ({ achievement, rewards }) => {
      const parts = rewardSummary(rewards);
      toast.success(
        parts.length ? `${achievement.title} claimed: ${parts.join(', ')}` : `${achievement.title} claimed`,
      );
      setCelebrateId(achievement._id);
      // Reflect the earned state immediately so the card springs in place.
      qc.setQueriesData<Achievement[]>({ queryKey: ['achievements'] }, (list) =>
        Array.isArray(list)
          ? list.map((a) =>
              a._id === achievement._id
                ? { ...a, isEarned: true, canClaim: false, earnedAt: new Date().toISOString() }
                : a,
            )
          : list,
      );
      setDetail((d) => (d && d._id === achievement._id ? { ...d, isEarned: true, canClaim: false } : d));
      qc.invalidateQueries({ queryKey: ['achievements'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not claim that badge. Try again.')),
    onSettled: () => setClaimingId(null),
  });

  useEffect(() => {
    if (!celebrateId) return;
    const id = setTimeout(() => setCelebrateId(null), 600);
    return () => clearTimeout(id);
  }, [celebrateId]);

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
      const key = categoryOf(a);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(a);
      else buckets.set(key, [a]);
    }
    for (const bucket of buckets.values()) {
      bucket.sort((x, y) => {
        const claimDelta = Number(Boolean(y.canClaim && !y.isEarned)) - Number(Boolean(x.canClaim && !x.isEarned));
        if (claimDelta !== 0) return claimDelta;
        const rarityDelta = RARITY_ORDER[rarityOf(x)] - RARITY_ORDER[rarityOf(y)];
        return rarityDelta !== 0 ? rarityDelta : x.title.localeCompare(y.title);
      });
    }
    return CATEGORIES.filter((c) => buckets.has(c)).map(
      (c) => [c, buckets.get(c) as Achievement[]] as const,
    );
  }, [items]);

  const earnedCount = items.filter((a) => a.isEarned).length;
  const claimableItems = items.filter((a) => a.canClaim && !a.isEarned);
  const claimableCount = claimableItems.length;
  const totalPoints = items.reduce(
    (sum, a) => (a.isEarned ? sum + (a.rewards?.points ?? 0) : sum),
    0,
  );
  const pendingPoints = claimableItems.reduce((sum, a) => sum + (a.rewards?.points ?? 0), 0);
  const streakEarned = items.filter((a) => a.isEarned && categoryOf(a) === 'streak').length;
  const streakTotal = items.filter((a) => categoryOf(a) === 'streak').length;

  const claimAll = async () => {
    if (!claimableItems.length || claimingAll) return;
    setClaimingAll(true);
    let claimed = 0;
    const totals: Required<ClaimRewards> = { points: 0, coins: 0, experience: 0 };
    for (const a of claimableItems) {
      try {
        const { rewards } = await claim.mutateAsync(a);
        claimed += 1;
        totals.points += rewards?.points ?? 0;
        totals.coins += rewards?.coins ?? 0;
        totals.experience += rewards?.experience ?? 0;
      } catch {
        // Per-item errors already toast; keep going so one failure does not block the rest.
      }
    }
    setClaimingAll(false);
    if (claimed > 1) {
      const parts = rewardSummary(totals);
      toast.success(`${claimed} badges claimed${parts.length ? `: ${parts.join(', ')}` : ''}`);
    }
  };

  const filtersActive = Boolean(category || rarity);
  const firstName = (me?.fullName || me?.username || '').trim().split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Achievements"
        subtitle={
          firstName
            ? `Every badge you have chased, ${firstName}, and the ones still in reach.`
            : 'Every badge you have chased, and the ones still in reach.'
        }
      />

      <StatGrid columns={4}>
        <StatTile
          label="Earned"
          value={earnedCount}
          unit={`of ${items.length}`}
          icon={<Trophy size={20} />}
          tone="brand"
          loading={active.isLoading}
          hint={items.length ? `${Math.round((earnedCount / items.length) * 100)}% of this set` : undefined}
        />
        <StatTile
          label="Ready to claim"
          value={claimableCount}
          icon={<Sparkles size={20} />}
          tone={claimableCount > 0 ? 'accent' : 'neutral'}
          loading={active.isLoading}
          hint={claimableCount > 0 ? `${formatStat(pendingPoints)} pts waiting` : 'Nothing pending'}
        />
        <StatTile
          label="Points banked"
          value={formatStat(totalPoints)}
          unit="pts"
          icon={<Medal size={20} />}
          loading={active.isLoading}
        />
        <StatTile
          label="Streak badges"
          value={streakEarned}
          unit={streakTotal ? `of ${streakTotal}` : undefined}
          icon={<Flame size={20} />}
          tone={streakEarned > 0 ? 'accent' : 'neutral'}
          loading={active.isLoading}
          hint={streakTotal ? 'Consistency pays' : 'None in this set'}
        />
      </StatGrid>

      {claimableCount > 0 && tab === 'mine' ? (
        <Callout
          tone="brand"
          icon={<Sparkles size={20} className="text-accent" />}
          title={claimableCount === 1 ? 'One badge is ready to claim' : `${claimableCount} badges are ready to claim`}
          action={
            <Button
              variant="primary"
              loading={claimingAll}
              onClick={() => void claimAll()}
              icon={<Award size={16} />}
            >
              {claimableCount === 1 ? 'Claim' : 'Claim all'}
            </Button>
          }
        >
          {pendingPoints > 0 ? `${formatStat(pendingPoints)} pts are waiting for you.` : 'Bank the rewards before the season moves on.'}
        </Callout>
      ) : null}

      <Tabs
        aria-label="Achievement views"
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          { key: 'mine', label: 'My progress', icon: <Trophy size={16} /> },
          { key: 'all', label: 'All badges', icon: <Award size={16} /> },
          { key: 'seasonal', label: 'Seasonal', icon: <CalendarDays size={16} /> },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Category"
          containerClassName="w-full sm:w-52"
          value={category}
          onChange={(v) => setCategory(v as '' | Category)}
          options={[
            { value: '', label: 'All categories' },
            ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
          ]}
        />
        <Select
          label="Rarity"
          containerClassName="w-full sm:w-44"
          value={rarity}
          onChange={(v) => setRarity(v as '' | Rarity)}
          options={[
            { value: '', label: 'All rarities' },
            ...RARITIES.map((r) => ({ value: r, label: RARITY_STYLE[r].label })),
          ]}
        />
        {filtersActive ? (
          <Button
            variant="ghost"
            onClick={() => {
              setCategory('');
              setRarity('');
            }}
          >
            Clear filters
          </Button>
        ) : null}
        {active.isFetching && !active.isLoading ? (
          <span className="inline-flex h-11 items-center" aria-live="polite" aria-label="Refreshing">
            <Spinner size={16} />
          </span>
        ) : null}
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
          variant={filtersActive ? 'no-results' : 'first-run'}
          title={
            tab === 'seasonal'
              ? 'No seasonal badges running'
              : filtersActive
                ? 'No badges match those filters'
                : 'No badges yet'
          }
          message={
            tab === 'seasonal' && !filtersActive
              ? 'Seasonal badges appear here while a season is live.'
              : filtersActive
                ? 'Widen the category or rarity filter to see more.'
                : 'Log workouts, meals and streaks and badges unlock as you go.'
          }
          action={
            filtersActive
              ? {
                  label: 'Clear filters',
                  onClick: () => {
                    setCategory('');
                    setRarity('');
                  },
                }
              : tab === 'seasonal'
                ? { label: 'See all badges', onClick: () => setTab('all'), variant: 'secondary' }
                : { label: 'Log a workout', to: '/workouts?log=1', icon: <Dumbbell size={18} /> }
          }
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(([cat, list]) => {
            const earnedHere = list.filter((a) => a.isEarned).length;
            return (
              <Section
                key={cat}
                title={
                  <span className="inline-flex items-center gap-2">
                    <span className={cx(cat === 'streak' ? 'text-accent' : 'text-brand')}>
                      {CATEGORY_ICON[cat]({ size: 20 })}
                    </span>
                    {CATEGORY_LABEL[cat]}
                  </span>
                }
                action={
                  tab === 'mine' ? (
                    <span className="tabular text-xs font-semibold text-text-2">
                      {earnedHere}/{list.length} earned
                    </span>
                  ) : (
                    <span className="tabular text-xs font-semibold text-text-2">
                      {list.length} {list.length === 1 ? 'badge' : 'badges'}
                    </span>
                  )
                }
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((achievement) => (
                    <AchievementCard
                      key={achievement._id}
                      achievement={achievement}
                      claiming={claimingId === achievement._id && claim.isPending}
                      celebrate={celebrateId === achievement._id}
                      onClaim={() => claim.mutate(achievement)}
                      onOpen={() => setDetail(achievement)}
                    />
                  ))}
                </div>
              </Section>
            );
          })}
        </div>
      )}

      <DetailModal
        achievement={detail}
        onClose={() => setDetail(null)}
        claiming={!!detail && claimingId === detail._id && claim.isPending}
        onClaim={(a) => claim.mutate(a)}
      />
    </div>
  );
}
