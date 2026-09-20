import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { featureEnabled, useCapabilities } from '../lib/capabilities';
import {
  CATEGORIES,
  RARITIES,
  awardState,
  categoryOf,
  criteriaExplainer,
  criteriaUnit,
  filterOptionsFrom,
  isNewAward,
  isVisible,
  rarityOf,
  showClaim,
  summarize,
  withMemberFields,
  type Achievement,
  type AchievementListResponse,
  type Category,
  type Rarity,
  isRetired,
} from '../lib/achievements';
import { useMyAchievements } from '../lib/useMyAchievements';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Ring,
  Select,
  Skeleton,
  Spinner,
  StatGrid,
  StatTile,
  Tabs,
  cx,
  formatStat,
  useToast,
} from '../components/ui';
import {
  Award,
  CalendarDays,
  CheckCircle,
  Clock,
  Dumbbell,
  Medal,
  Sparkles,
  Target,
  Trophy,
  Users,
} from '../components/icons';
import {
  AchievementGrid,
  BadgeTile,
  CATEGORY_LABEL,
  RARITY_STYLE,
  RarityChip,
  detailsButtonId,
  earnedLine,
  fmtDate,
} from './AchievementCard';

export type { Achievement } from '../lib/achievements';

/* ------------------------------------------------------------------ types */

type AchievementProgress = {
  current: number;
  required: number;
  percentage: number;
  canEarn: boolean;
};

type ClaimRewards = { points?: number; coins?: number; experience?: number };

/** utils/localDate.js expects Date#getTimezoneOffset's sign (UTC minus local). */
const tzOffset = () => new Date().getTimezoneOffset();

const rewardSummary = (r?: ClaimRewards | null) =>
  [
    r?.points ? `${formatStat(r.points)} pts` : '',
    r?.coins ? `${formatStat(r.coins)} coins` : '',
    r?.experience ? `${formatStat(r.experience)} XP` : '',
  ].filter(Boolean);

const isNotFound = (error: unknown) =>
  (error as { response?: { status?: number } } | undefined)?.response?.status === 404;

/**
 * errMsg prefers the API's own sentence, and on a 5xx that sentence never
 * names the action ("Something went wrong on our side."). For a failure whose
 * only other trace is a notice quietly coming back, the action goes first.
 */
const withReason = (lead: string, error: unknown) => {
  const reason = errMsg(error, 'Try again.');
  return `${lead} ${/[.!?]$/.test(reason) ? reason : `${reason}.`}`;
};

/* ------------------------------------------------------------------- focus */

/*
 * "Got it" and "Claim reward" unmount themselves on success. Focus is handed
 * to a stable element first, so a keyboard or screen-reader user keeps their
 * place instead of restarting from "Skip to content".
 */

/** Wraps the view tabs; the selected tab is where focus lands after the notice goes. */
const VIEWS_ID = 'achievement-views';
/** The detail dialog's footer Close: what remains once its Claim control has gone. */
const DETAIL_CLOSE_ID = 'achievement-detail-close';

const focusViews = () =>
  document.querySelector<HTMLElement>(`#${VIEWS_ID} [role="tab"][aria-selected="true"]`)?.focus();

/* --------------------------------------------------------------- sub views */

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
  claimAllowed,
  autoAward,
  onClose,
  onClaim,
  claiming,
}: {
  achievement: Achievement | null;
  claimAllowed: boolean;
  autoAward: boolean;
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
  const met = Boolean(achievement && !earned && (achievement.canClaim || data?.canEarn));
  const claimable = claimAllowed && met;
  const percent = data?.percentage ?? achievement?.progressPercentage ?? 0;
  const criteriaType = achievement?.criteria?.type;
  const explainer = criteriaExplainer(criteriaType);
  const coins = achievement?.rewards?.coins ?? 0;
  // Auto-award never grants coins (only the claim route does), so the tile stays honest.
  const showCoins = !autoAward && coins > 0;
  const remaining = data ? Math.max(0, data.required - data.current) : 0;

  return (
    <Modal
      open={!!achievement}
      onClose={onClose}
      title={achievement?.title || 'Achievement'}
      description={achievement ? CATEGORY_LABEL[categoryOf(achievement)] : undefined}
      footer={
        achievement ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button id={DETAIL_CLOSE_ID} variant="secondary" onClick={onClose}>
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
            <BadgeTile achievement={achievement} size="lg" earned={earned || met} />
            <div className="min-w-0 space-y-1.5">
              <RarityChip rarity={rarity} />
              <p className="text-sm leading-relaxed text-text-2">{achievement.description}</p>
              {explainer ? <p className="text-xs leading-5 text-text-2">{explainer}</p> : null}
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
                color={met ? 'accent' : style.ring}
                label="Progress"
              >
                {earned ? <CheckCircle size={28} className="text-brand" /> : <span className="text-xl">{Math.round(percent)}%</span>}
              </Ring>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="type-label text-text-2">Progress</p>
                {earned ? (
                  <>
                    <p className="text-md font-semibold text-text-1">{earnedLine(achievement)}</p>
                    <p className="text-xs text-text-2">
                      {isRetired(achievement)
                        ? 'This badge has been retired from the catalogue. Yours stays in your collection.'
                        : awardState(achievement).kind === 'awarded'
                          ? 'Awarded for a record you already had. This badge is in your collection.'
                          : 'This badge is in your collection.'}
                    </p>
                  </>
                ) : data ? (
                  <>
                    <p className="type-stat text-xl text-text-1">
                      {formatStat(Math.min(data.current, data.required))}
                      <span className="text-text-3"> / {formatStat(data.required)}</span>
                      <span className="ml-1.5 align-baseline text-xs font-semibold tracking-normal text-text-2 [font-variation-settings:'wdth'_100]">
                        {criteriaUnit(criteriaType, data.required)}
                      </span>
                    </p>
                    <p className={cx('text-xs', data.canEarn ? 'font-semibold text-accent-text' : 'text-text-2')}>
                      {data.canEarn
                        ? autoAward
                          ? 'Criteria met. Your award arrives on its own.'
                          : claimAllowed
                            ? 'Criteria met. Claim it to bank the reward.'
                            : 'Criteria met.'
                        : `${formatStat(remaining)} ${criteriaUnit(criteriaType, remaining)} to go.`}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-text-2">Progress is tracked once you log activity.</p>
                )}
              </div>
            </div>
          )}

          <div className={cx('grid gap-2', showCoins ? 'grid-cols-3' : 'grid-cols-2')}>
            <RewardTile label="Points" value={achievement.rewards?.points ?? 0} />
            {showCoins ? <RewardTile label="Coins" value={coins} /> : null}
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

  /*
   * Under auto-award the server grants badges the moment a trigger fires and
   * the Claim route is retired from the UI. Claim is offered only once the
   * capabilities answer has arrived AND says the flag is off, so it never
   * flashes for a frame on production.
   */
  const capabilities = useCapabilities();
  const autoAward = featureEnabled(capabilities.data?.features, 'achievementAutoAward');
  const claimAllowed = capabilities.isSuccess && !autoAward;

  const [tab, setTab] = useState<TabKey>('mine');
  const [category, setCategory] = useState<'' | Category>('');
  const [rarity, setRarity] = useState<'' | Rarity>('');
  const [detail, setDetail] = useState<Achievement | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);

  /*
   * The member's whole set, unfiltered and always loaded: the summary tiles
   * read from it on every tab, and the catalogue tab merges its earned and
   * award flags in. Deriving the tiles from the visible list made "All
   * badges" show Earned 0 and Points banked 0 the moment you switched tabs.
   */
  const summaryQuery = useMyAchievements();

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
      const now = new Date().toISOString();
      qc.setQueriesData<Achievement[]>({ queryKey: ['achievements'] }, (list) =>
        Array.isArray(list)
          ? list.map((a) =>
              a._id === achievement._id
                ? { ...a, isEarned: true, canClaim: false, earnedAt: now, awardedBy: 'claim', ackedAt: now }
                : a,
            )
          : list,
      );
      setDetail((d) => (d && d._id === achievement._id ? { ...d, isEarned: true, canClaim: false, awardedBy: 'claim' } : d));
      qc.invalidateQueries({ queryKey: ['achievements'] });
      // The Claim control is about to go: in the dialog its footer keeps Close,
      // on the grid the card keeps its details target.
      const target = detail && detail._id === achievement._id ? DETAIL_CLOSE_ID : detailsButtonId(achievement._id);
      document.getElementById(target)?.focus();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not claim that badge. Try again.')),
    onSettled: () => setClaimingId(null),
  });

  /*
   * Mark new awards as seen so another device does not replay the notice.
   * A 404 means the row is not (or no longer) earned and stays silent. Any
   * other failure is said out loud: the notice is removed optimistically and
   * comes back on refetch, and without a message that click looks ignored.
   * `announce` is true from the "Got it" control, whose success is otherwise
   * only a notice vanishing; opening a detail acks quietly.
   */
  const ack = useMutation({
    mutationFn: async ({ ids }: { ids: string[]; announce: boolean }) => {
      const results = await Promise.allSettled(ids.map((id) => api.post(`/achievements/${id}/ack`)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected' && !isNotFound(r.reason));
      if (failed) throw failed.reason;
    },
    onMutate: ({ ids }) => {
      const now = new Date().toISOString();
      qc.setQueriesData<Achievement[]>({ queryKey: ['achievements', 'user'] }, (list) =>
        Array.isArray(list) ? list.map((a) => (ids.includes(a._id) && !a.ackedAt ? { ...a, ackedAt: now } : a)) : list,
      );
    },
    onSuccess: (_result, { announce }) => {
      if (announce) toast.success('Marked as seen');
    },
    onError: (e) => toast.error(withReason('Could not mark those awards as seen.', e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['achievements', 'user'] }),
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
    if (tab !== 'mine' && summaryQuery.data) {
      // The catalogue endpoints carry no per-member flags; borrow them.
      const mine = new Map(summaryQuery.data.map((a) => [a._id, a]));
      list = list.map((a) => withMemberFields(a, mine.get(a._id)));
    }
    // Retired definitions stay out of the way unless already earned.
    return list.filter(isVisible);
  }, [active.data, tab, category, rarity, summaryQuery.data]);

  /* Summary tiles: the member's real totals, whatever tab or filter is showing. */
  const summary = useMemo(() => (summaryQuery.data ?? []).filter(isVisible), [summaryQuery.data]);
  const stats = useMemo(() => summarize(summary), [summary]);
  const summaryLoading = summaryQuery.isLoading || capabilities.isLoading;
  /*
   * Two facts the tiles must not assert without knowing them: the member's
   * totals (the summary list failed) and which award flow this server runs
   * (the capabilities query got no answer). Loading is a skeleton; a failure
   * is a dash, never a zero that reads as "you hold nothing".
   */
  const summaryUnknown = summaryQuery.isError;
  const flagUnknown = !capabilities.isSuccess && !capabilities.isLoading;
  const awardsLabel = flagUnknown ? 'Awards' : autoAward ? 'New awards' : 'Ready to claim';
  const earnedCount = stats.earned;
  const claimableItems = useMemo(() => summary.filter((a) => showClaim(a, claimAllowed)), [summary, claimAllowed]);
  const claimableCount = claimableItems.length;
  const newRows = useMemo(() => summary.filter(isNewAward), [summary]);
  const totalPoints = stats.points;
  const pendingPoints = stats.pendingPoints;

  /* Filters offer only what the API returned; a stale option would always yield an empty grid. */
  const options = useMemo(() => filterOptionsFrom(summary), [summary]);
  const categoryOptions = summary.length ? options.categories : CATEGORIES;
  const rarityOptions = summary.length ? options.rarities : RARITIES;

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

  const openDetail = (a: Achievement) => {
    setDetail(a);
    // Opening a new award counts as seeing it.
    if (isNewAward(a)) ack.mutate({ ids: [a._id], announce: false });
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
        {summaryUnknown ? (
          <>
            <StatTile label="Earned" value="—" icon={<Trophy size={20} />} tone="brand" />
            <StatTile label={awardsLabel} value="—" icon={<Sparkles size={20} />} />
            <StatTile label="Points banked" value="—" icon={<Medal size={20} />} />
            <StatTile label="Milestones" value="—" icon={<Target size={20} />} />
          </>
        ) : (
          <>
            <StatTile
              label="Earned"
              value={earnedCount}
              unit={`of ${summary.length}`}
              icon={<Trophy size={20} />}
              tone="brand"
              loading={summaryLoading}
              hint={summary.length ? `${Math.round((earnedCount / summary.length) * 100)}% of all badges` : undefined}
            />
            {flagUnknown ? (
              <StatTile
                label={awardsLabel}
                value="—"
                icon={<Sparkles size={20} />}
                loading={summaryLoading}
                hint="Could not check server settings"
              />
            ) : autoAward ? (
              <StatTile
                label={awardsLabel}
                value={stats.newAwards}
                icon={<Sparkles size={20} />}
                tone={stats.newAwards > 0 ? 'accent' : 'neutral'}
                loading={summaryLoading}
                hint={stats.newAwards > 0 ? 'Since you last looked' : 'Awards arrive on their own'}
              />
            ) : (
              <StatTile
                label={awardsLabel}
                value={claimableCount}
                icon={<Sparkles size={20} />}
                tone={claimableCount > 0 ? 'accent' : 'neutral'}
                loading={summaryLoading}
                hint={claimableCount > 0 ? `${formatStat(pendingPoints)} pts waiting` : 'Nothing pending'}
              />
            )}
            <StatTile
              label="Points banked"
              value={formatStat(totalPoints)}
              unit="pts"
              icon={<Medal size={20} />}
              loading={summaryLoading}
            />
            {stats.weeksKept ? (
              <StatTile
                label="Weeks kept"
                value={Math.min(stats.weeksKept.progress, stats.weeksKept.required)}
                unit={`of ${stats.weeksKept.required}`}
                icon={<CalendarDays size={20} />}
                tone={stats.weeksKept.progress > 0 ? 'accent' : 'neutral'}
                loading={summaryLoading}
                hint="Weekly Rhythm"
              />
            ) : (
              <StatTile
                label="Milestones"
                value={stats.milestones.earned}
                unit={stats.milestones.total ? `of ${stats.milestones.total}` : undefined}
                icon={<Target size={20} />}
                tone={stats.milestones.earned > 0 ? 'brand' : 'neutral'}
                loading={summaryLoading}
                hint={stats.milestones.total ? 'Long-run targets' : 'None yet'}
              />
            )}
          </>
        )}
      </StatGrid>

      {/*
        * On "My progress" the grid has its own list, so a failed summary is
        * explained here next to the dashes; when that list failed too, the
        * grid's own error state already says it once. The other tabs say it
        * in place of the grid (below), since their rows borrow the member
        * fields from the summary.
        */}
      {summaryUnknown && tab === 'mine' && !active.isError ? (
        <Callout
          tone="warning"
          title="Your progress could not be loaded"
          action={
            <Button variant="secondary" loading={summaryQuery.isFetching} onClick={() => void summaryQuery.refetch()}>
              Try again
            </Button>
          }
        >
          Totals and earned marks stay hidden until it loads.
        </Callout>
      ) : null}

      {autoAward && newRows.length > 0 ? (
        <Callout
          tone="brand"
          icon={<Sparkles size={20} className="text-brand" />}
          title={newRows.length === 1 ? `New award: ${newRows[0].title}` : `${newRows.length} new awards`}
          action={
            <Button
              variant="secondary"
              loading={ack.isPending}
              onClick={() => {
                // The notice leaves as soon as the optimistic update lands, so focus moves first.
                focusViews();
                ack.mutate({ ids: newRows.map((a) => a._id), announce: true });
              }}
            >
              Got it
            </Button>
          }
        >
          Awards arrive on their own the moment your record crosses the line.
        </Callout>
      ) : null}

      {claimAllowed && claimableCount > 0 && tab === 'mine' ? (
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

      <div id={VIEWS_ID}>
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
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Category"
          containerClassName="w-full sm:w-52"
          value={category}
          onChange={(v) => setCategory(v as '' | Category)}
          options={[
            { value: '', label: 'All categories' },
            ...categoryOptions.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
          ]}
        />
        <Select
          label="Rarity"
          containerClassName="w-full sm:w-44"
          value={rarity}
          onChange={(v) => setRarity(v as '' | Rarity)}
          options={[
            { value: '', label: 'All rarities' },
            ...rarityOptions.map((r) => ({ value: r, label: RARITY_STYLE[r].label })),
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
      ) : summaryUnknown && tab !== 'mine' ? (
        <ErrorState
          error={summaryQuery.error}
          title="Your progress could not be loaded"
          message="Each badge shows your progress on it, so the list waits until that loads."
          retry={() => summaryQuery.refetch()}
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
                : 'Log workouts and posts and awards arrive as you go.'
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
        <AchievementGrid
          items={items}
          claimAllowed={claimAllowed}
          claimingId={claim.isPending ? claimingId : null}
          celebrateId={celebrateId}
          onClaim={(a) => claim.mutate(a)}
          onOpen={openDetail}
          showEarnedCounts={tab === 'mine'}
        />
      )}

      <DetailModal
        achievement={detail}
        claimAllowed={claimAllowed}
        autoAward={autoAward}
        onClose={() => setDetail(null)}
        claiming={!!detail && claimingId === detail._id && claim.isPending}
        onClaim={(a) => claim.mutate(a)}
      />
    </div>
  );
}
