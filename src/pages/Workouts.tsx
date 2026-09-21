import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatSeconds } from '../lib/duration';
import { useHomeGym } from '../lib/homeGym';
import { displayWeight, useUnits, weightUnit } from '../lib/units';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardGrid,
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Menu,
  PageHeader,
  SearchField,
  SegmentedControl,
  Skeleton,
  SkeletonCard,
  StatStrip,
  cx,
  formatStat,
  hasMetric,
  humanize,
  useToast,
  type MenuItem,
  type StatStripItem,
} from './ui';
import { ArrowRight, Clock, Copy, Edit, Flag, Globe, Layers, Play, Plus, ShareUp, Trash } from './icons';
import { useReportModal } from './Report';
import { MetaList, categoryTone, exerciseCount } from './workouts/cards';
import {
  fetchCommunityPlans,
  fetchExplorePage,
  fetchMyPlans,
  fetchMyWorkoutsPage,
  fetchPremade,
  fetchPremadePlans,
  sharePlan,
  shareWorkout,
  type SocialWorkout,
  type WorkoutPage,
  type WorkoutPlan,
} from './workouts/model';
import { AddToPlanModal, AddWorkoutPicker } from './workouts/planPickers';
import { LOGS_KEY, fetchLogs, lastDoneByTitle, parseLogDate, relativeDay, sortLogs, topSet, weekTotals, weeksKept, type WorkoutLog } from './workouts/sessions';
import { TRAIN, useSheetNav } from './workouts/sheet';

/**
 * The Train hub. The shell header carries the page's one primary control,
 * "Start a session", with "New workout" beside it as a text button. Below:
 * the week as a StatStrip (or one line while there is nothing to count), then
 * ONE control row — the library as Mine · Plans · Explore · Premade and a
 * filter field — and the cards. Explore and Premade switch between single
 * workouts and programs with a chip pair inside the pane. Detail and editor
 * routes open as sheets over this page on desktop (src/pages/workouts/*);
 * the schedule pickers stay modals.
 *
 * Production has no gyms and most members have no history yet, so nothing
 * here renders a zero: a strip cell without a datum shows its fallback, a
 * card with no sessions behind it shows no session line, and a member whose
 * library is empty lands on Premade.
 */

// Legacy type and helper re-exports: FirstWeekCard and the detail pages import these from here.
export type { PlanEntry, SocialWorkout, WorkoutAuthor, WorkoutExercise, WorkoutPlan } from './workouts/model';
export { CATEGORY_OPTIONS, LEVEL_OPTIONS, fetchMyPlans, fetchPremade, sharePlan, shareWorkout } from './workouts/model';
export { LikeButton, MetaList } from './workouts/cards';
export { AddToPlanModal, AddWorkoutPicker } from './workouts/planPickers';

const TABS = [
  { key: 'mine', label: 'Mine' },
  { key: 'plans', label: 'Plans' },
  { key: 'explore', label: 'Explore' },
  { key: 'premade', label: 'Premade' },
] as const;

type TabKey = (typeof TABS)[number]['key'];
const isTabKey = (v: string | null): v is TabKey => TABS.some((t) => t.key === v);

/** Explore and Premade each hold two catalogues: single workouts and multi-week programs. A chip pair inside the pane switches between them. */
type KindKey = 'workouts' | 'programs';
const KINDS: ReadonlyArray<{ key: KindKey; label: string }> = [
  { key: 'workouts', label: 'Workouts' },
  { key: 'programs', label: 'Programs' },
];
const isKindKey = (v: string | null): v is KindKey => KINDS.some((k) => k.key === v);

/* ------------------------------------------------------------ small bits */

function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <CardGrid min="20rem" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} media={false} />
      ))}
    </CardGrid>
  );
}

/** Whole-card link that carries the sheet background, so the detail opens over this page on desktop. */
function CardLink({ to, label, state }: { to: string; label: string; state: unknown }) {
  return <Link to={to} state={state} viewTransition aria-label={label} className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" />;
}

const firstName = (a?: { fullName?: string; username?: string } | null) => (a?.fullName?.trim().split(/\s+/)[0] || a?.username || '').trim();

/* -------------------------------------------------------------- the week */

/**
 * The week as StatStrip cells: sessions, minutes and weight lifted, plus the
 * weeks kept from two upwards. A week with no session yet borrows last week's
 * numbers (labelled as such) rather than showing a row of prompts; a cell
 * whose own number is missing shows its fallback, never a zero. An empty
 * array means there is nothing to count yet and the caller draws one line.
 */
function weekItems(logs: readonly WorkoutLog[], system: 'metric' | 'imperial', now = new Date()): StatStripItem[] {
  const { week, lastWeek } = weekTotals(logs, now);
  const shown = week.sessions > 0 ? { t: week, when: 'this week' } : lastWeek.sessions > 0 ? { t: lastWeek, when: 'last week' } : null;
  if (!shown) return [];
  const { t, when } = shown;
  const items: StatStripItem[] = [
    { label: `${t.sessions === 1 ? 'session' : 'sessions'} ${when}`, value: t.sessions, to: TRAIN.history },
    { label: `minutes ${when}`, value: t.minutes, fallback: 'Not timed', to: TRAIN.history },
    { label: `${weightUnit(system)} lifted ${when}`, value: Math.round(displayWeight(t.volumeKg, system)), fallback: 'No weights', to: TRAIN.history },
  ];
  const kept = weeksKept(logs, now);
  if (kept > 1) items.push({ label: 'weeks kept', value: kept, to: TRAIN.history });
  return items;
}

/**
 * One line in the strip's place when there is no week to count: the first
 * session has not happened, or the last one is more than two weeks back. The
 * header already holds "Start a session", so this says only what is true and
 * offers the one action the header cannot: repeating the last session. Same
 * height as the strip, so the block never shifts whichever way the data goes.
 */
function WeekLine({ last, state }: { last: WorkoutLog | null; state: unknown }) {
  const lastDate = last ? parseLogDate(last.date) : null;
  return (
    <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="t-body text-text-2">
        {last && lastDate
          ? `No session in the last two weeks. The last one was ${last.name || 'a workout'}, ${relativeDay(lastDate).toLowerCase()}.`
          : 'No sessions yet. Sessions, minutes and weight lifted fill in here from the first one.'}
      </p>
      {last ? (
        <Link to={TRAIN.newSession({ repeat: last._id })} state={state} viewTransition className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-text-1 hover:underline">
          Log it again <ArrowRight size={14} aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- workout card */

type SessionLine = { who: { name: string; avatar?: string; self: boolean } | null; text: string } | null;

/**
 * "You, yesterday — bench press 82.5 kg × 5" from your own logs; "Maya shared
 * it yesterday" from the author; failing both, "No one at {gym} has shared
 * this one yet" — only when the viewer has a gym to scope it to (`who` is
 * null: no avatar to draw). Nothing invented.
 */
function sessionLine(workout: SocialWorkout, lastDone: WorkoutLog | undefined, viewer: { name: string; avatar?: string } | null, system: 'metric' | 'imperial', isOwn: boolean, gym: string | null): SessionLine {
  const when = lastDone ? parseLogDate(lastDone.date) : null;
  if (lastDone && when) {
    const top = topSet(lastDone);
    const fact = top
      ? top.weightKg
        ? `${top.name.toLowerCase()} ${formatStat(displayWeight(top.weightKg, system))} ${weightUnit(system)}${top.reps ? ` × ${formatStat(top.reps)}` : ''}`
        : top.seconds
          ? `${top.name.toLowerCase()} ${formatSeconds(top.seconds)}`
          : top.reps
            ? `${top.name.toLowerCase()} ${top.sets ? `${formatStat(top.sets)} × ` : ''}${formatStat(top.reps)}`
            : null
      : null;
    return { who: { name: viewer?.name ?? 'You', avatar: viewer?.avatar, self: true }, text: `You, ${relativeDay(when).toLowerCase()}${fact ? ` — ${fact}` : ''}` };
  }
  if (!isOwn && workout.createdBy && workout.createdAt) {
    const d = parseLogDate(workout.createdAt);
    const name = firstName(workout.createdBy);
    if (d && name) return { who: { name: workout.createdBy.fullName || workout.createdBy.username || name, avatar: workout.createdBy.avatar, self: false }, text: `${name} shared it ${relativeDay(d).toLowerCase()}` };
  }
  if (!isOwn && gym) return { who: null, text: `No one at ${gym} has shared this one yet` };
  return null;
}

function WorkoutCard({
  workout,
  ownerView,
  lastDone,
  gym,
  onDelete,
  onReport,
  onAddToPlan,
}: {
  workout: SocialWorkout;
  ownerView: boolean;
  lastDone?: WorkoutLog;
  /** The viewer's gym name, for the card's gym-scoped line; null when there is none. */
  gym: string | null;
  onDelete?: (w: SocialWorkout) => void;
  onReport?: (w: SocialWorkout) => void;
  onAddToPlan?: (w: SocialWorkout) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const system = useUnits((s) => s.system);
  const { state, open } = useSheetNav();
  const isOwn = ownerView || Boolean(user && workout.createdBy && workout.createdBy._id === user._id);
  const href = TRAIN.workout(workout._id);
  const count = workout.exercises?.length ?? 0;
  const line = sessionLine(workout, lastDone, user ? { name: user.fullName || user.username, avatar: user.avatar } : null, system, isOwn, gym);
  const lastDate = lastDone ? parseLogDate(lastDone.date) : null;
  const recent = lastDate ? Date.now() - lastDate.getTime() < 7 * 86_400_000 : false;

  const menu: MenuItem[] = [
    ...(isOwn ? [{ label: 'Edit', icon: <Edit size={18} />, onSelect: () => open(TRAIN.editWorkout(workout._id)) }] : []),
    ...(onAddToPlan ? [{ label: 'Add to plan', description: 'Schedule it into one of your plans', icon: <Layers size={18} />, onSelect: () => onAddToPlan(workout) }] : []),
    { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void shareWorkout(workout, toast, 'share') },
    { label: 'Copy link', icon: <Copy size={18} />, onSelect: () => void shareWorkout(workout, toast, 'copy') },
    ...(!isOwn && onReport ? [{ label: 'Report', icon: <Flag size={18} />, onSelect: () => onReport(workout), divider: true }] : []),
    ...(isOwn && onDelete ? [{ label: 'Delete', icon: <Trash size={18} />, onSelect: () => onDelete(workout), danger: true, divider: true }] : []),
  ];

  return (
    <Card container className="relative flex flex-col gap-3">
      <CardLink to={href} label={`Open ${workout.title}`} state={state} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="type-heading line-clamp-2 text-lg text-text-1">{workout.title}</h3>
          <p className="tabular mt-0.5 truncate text-xs text-text-2">
            {exerciseCount(count)}
            {workout.duration ? ` · ${formatStat(workout.duration)} min` : ''}
          </p>
        </div>
        <Menu items={menu} label={`More options for ${workout.title}`} className="relative z-[2] -mr-2 -mt-1.5 shrink-0" />
      </div>
      <div className="relative z-[2] -mt-1 flex flex-wrap items-center gap-1.5">
        <Badge tone={categoryTone(workout.category)}>{humanize(workout.category)}</Badge>
        {workout.isPremade ? <Badge tone="info">Premade</Badge> : null}
        {isOwn && workout.isPublic === false ? <Badge>Private</Badge> : null}
      </div>

      {line ? (
        line.who ? (
          <p className="flex items-center gap-2.5 rounded-md bg-surface-2 px-3 py-2.5 text-sm text-text-1">
            <Avatar src={line.who.avatar} name={line.who.name} alt="" size="xs" seed={line.who.self ? user?._id : workout.createdBy?._id} />
            <span className="min-w-0 truncate">{line.text}</span>
          </p>
        ) : (
          <p className="truncate text-sm text-text-2">{line.text}</p>
        )
      ) : workout.description ? (
        <p className="line-clamp-2 text-sm text-text-2">{workout.description}</p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <span className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold text-text-2">
          <i aria-hidden="true" className={cx('h-2 w-2 shrink-0 rounded-full', recent ? 'bg-text-1' : 'bg-text-3')} />
          <span className="truncate">{lastDate ? relativeDay(lastDate) : 'Not logged yet'}</span>
        </span>
        {/* A workout trained this week keeps the blue: the one action this card is for. Never the ink fill. */}
        <ButtonLink to={TRAIN.newSession({ from: workout._id })} state={state} variant={recent ? 'primary' : 'secondary'} size="sm" icon={<Play size={14} />} className="relative z-[2] shrink-0">
          {lastDone || !workout.isPremade ? 'Start' : 'Try it'}
        </ButtonLink>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ plans */

export function planMenu(
  plan: WorkoutPlan,
  { isOwn, toast, onEdit, onAddWorkout, onDelete }: { isOwn: boolean; toast: ReturnType<typeof useToast>; onEdit?: (p: WorkoutPlan) => void; onAddWorkout?: (p: WorkoutPlan) => void; onDelete?: (p: WorkoutPlan) => void },
): MenuItem[] {
  return [
    ...(isOwn && onEdit ? [{ label: 'Edit', icon: <Edit size={18} />, onSelect: () => onEdit(plan) }] : []),
    ...(isOwn && onAddWorkout ? [{ label: 'Add workout', description: 'Schedule a session into a week and day', icon: <Plus size={18} />, onSelect: () => onAddWorkout(plan) }] : []),
    { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void sharePlan(plan, toast, 'share') },
    { label: 'Copy link', icon: <Copy size={18} />, onSelect: () => void sharePlan(plan, toast, 'copy') },
    ...(isOwn && onDelete ? [{ label: 'Delete', icon: <Trash size={18} />, onSelect: () => onDelete(plan), danger: true, divider: true }] : []),
  ];
}

export function PlanCard({ plan, ownerView = false, onAddWorkout, onDelete }: { plan: WorkoutPlan; ownerView?: boolean; onAddWorkout?: (p: WorkoutPlan) => void; onDelete?: (p: WorkoutPlan) => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const { state, open } = useSheetNav();
  const isOwn = ownerView || Boolean(user && plan.createdBy && plan.createdBy._id === user._id);
  const included = (plan.workouts ?? []).filter((w) => w.workout);
  const href = `/workouts/plans/${plan._id}`;
  const menu = planMenu(plan, { isOwn, toast, onEdit: (p) => open(TRAIN.editPlan(p._id)), onAddWorkout, onDelete });

  return (
    <Card container className="relative flex flex-col gap-3">
      <CardLink to={href} label={`Open ${plan.title}`} state={state} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="type-heading truncate text-lg text-text-1">
            {/* Explicit link: the session list below sits above the card overlay and would otherwise swallow most taps. */}
            <Link to={href} state={state} viewTransition className="relative z-[2] rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {plan.title}
            </Link>
          </h3>
          {plan.goal ? <p className="mt-0.5 text-sm text-text-2">{plan.goal}</p> : null}
          {plan.createdBy && !isOwn ? (
            <Link
              to={`/u/${plan.createdBy._id}`}
              viewTransition
              className="relative z-[2] mt-1 inline-flex min-h-6 items-center gap-1.5 text-xs font-medium text-text-2 before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] hover:text-text-1"
            >
              <Avatar src={plan.createdBy.avatar} name={plan.createdBy.fullName || plan.createdBy.username} alt="" size="xs" />
              <span className="truncate">{plan.createdBy.fullName || `@${plan.createdBy.username ?? 'unknown'}`}</span>
            </Link>
          ) : null}
        </div>
        <div className="relative z-[2] flex shrink-0 items-center gap-1.5">
          {plan.isPremade ? <Badge tone="info">Premade</Badge> : plan.level ? <Badge>{humanize(plan.level)}</Badge> : null}
          <Menu items={menu} label={`More options for ${plan.title}`} className="-mr-2 -mt-1.5" />
        </div>
      </div>
      {plan.description ? <p className="line-clamp-2 text-sm text-text-2">{plan.description}</p> : null}
      <MetaList
        items={[
          !!plan.durationWeeks && { icon: <Clock size={14} />, label: `${plan.durationWeeks} ${plan.durationWeeks === 1 ? 'week' : 'weeks'}` },
          { icon: <Layers size={14} />, label: `${included.length} ${included.length === 1 ? 'workout' : 'workouts'}` },
          isOwn && !plan.isPremade && { icon: <Globe size={14} />, label: plan.isPublic === false ? 'Private' : 'Public' },
        ]}
      />
      {included.length > 0 ? (
        <>
          <ol className="relative z-[2] divide-y divide-line rounded-md bg-surface-2">
            {included.slice(0, 5).map((entry, i) => (
              <li key={`${entry.week}-${entry.day}-${entry.workout?._id ?? i}`}>
                <Link to={TRAIN.workout(entry.workout!._id)} state={state} viewTransition className="flex min-h-11 items-center gap-3 px-3 py-1.5 text-sm text-text-1 transition-colors dur-1 hover:bg-surface-3">
                  <span className="type-label w-20 shrink-0 tabular text-text-3">
                    Week {entry.week}, day {entry.day}
                  </span>
                  <span className="truncate">{entry.workout?.title}</span>
                </Link>
              </li>
            ))}
            {included.length > 5 ? <li className="px-3 py-2 text-xs text-text-3">and {included.length - 5} more</li> : null}
          </ol>
          <Link to={href} state={state} viewTransition aria-label={`View schedule for ${plan.title}`} className="relative z-[2] inline-flex min-h-9 items-center gap-1 self-start text-sm font-medium text-brand-text hover:underline">
            View schedule <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </>
      ) : isOwn && onAddWorkout ? (
        <div className="relative z-[2] flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-4 text-center">
          <p className="text-xs text-text-3">Nothing scheduled yet</p>
          <Button type="button" variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => onAddWorkout(plan)}>
            Add workout
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-3 text-center text-xs text-text-3">Nothing scheduled yet</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function Workouts() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const kindParam = params.get('kind');
  const kind: KindKey = isKindKey(kindParam) ? kindParam : 'workouts';
  const [addingTo, setAddingTo] = useState<WorkoutPlan | null>(null);
  const [addToPlan, setAddToPlan] = useState<SocialWorkout | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SocialWorkout | null>(null);
  const [pendingPlanDelete, setPendingPlanDelete] = useState<WorkoutPlan | null>(null);
  const [search, setSearch] = useState('');
  const { report, reportModal } = useReportModal();
  const { state: sheetState, open } = useSheetNav();
  const system = useUnits((s) => s.system);
  // The viewer's gym scopes the cards' "no one at {gym} has shared this one yet" line; with no gym the line is omitted.
  const homeGym = useHomeGym();
  const gymName = homeGym.gym?.name ?? null;

  const qc = useQueryClient();
  const toast = useToast();

  const nextPage = (last: WorkoutPage) => (last.pagination && last.pagination.page < last.pagination.pages ? last.pagination.page + 1 : undefined);

  // The library and the log are both read up front: Mine decides the landing tab, the log feeds the band, the strip and every card's session line.
  const mine = useInfiniteQuery({ queryKey: ['workouts', 'mine', 'paged'], queryFn: ({ pageParam }) => fetchMyWorkoutsPage(pageParam as number), initialPageParam: 1, getNextPageParam: nextPage });
  const logsQuery = useQuery({ queryKey: LOGS_KEY, queryFn: fetchLogs });
  const logs = useMemo(() => sortLogs(logsQuery.data?.workouts ?? []), [logsQuery.data]);
  const mineItems = useMemo(() => mine.data?.pages.flatMap((p) => p.items) ?? [], [mine.data]);
  const mineTotal = mine.data?.pages[0]?.pagination?.total ?? mineItems.length;

  // Land on Premade when Mine is empty; an explicit ?tab= always wins.
  const tab: TabKey = isTabKey(tabParam) ? tabParam : mine.isSuccess && mineItems.length === 0 ? 'premade' : 'mine';
  const showsPrograms = (tab === 'explore' || tab === 'premade') && kind === 'programs';

  const setTab = (next: TabKey) => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set('tab', next);
        n.delete('kind');
        return n;
      },
      { replace: true },
    );
  };

  const setKind = (next: KindKey) => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next === 'workouts') n.delete('kind');
        else n.set('kind', next);
        return n;
      },
      { replace: true },
    );
  };

  // Older deep links: /workouts?log=1 opened the new-workout form; ?tab=plans&new=1 the new-plan form. Both are routes now.
  const wantsLog = params.get('log') === '1';
  const wantsPlan = params.get('new') === '1';
  useEffect(() => {
    if (wantsLog) open(TRAIN.newWorkout, { replace: true });
    else if (wantsPlan) open(TRAIN.newPlan, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLog, wantsPlan]);

  const explore = useInfiniteQuery({
    queryKey: ['workouts', 'explore', 'paged'],
    queryFn: ({ pageParam }) => fetchExplorePage(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: tab === 'explore' && !showsPrograms,
  });
  const plans = useQuery({ queryKey: ['workouts', 'plans'], queryFn: fetchMyPlans, enabled: tab === 'plans' });
  const premade = useQuery({ queryKey: ['workouts', 'premade'], queryFn: fetchPremade, enabled: tab === 'premade' && !showsPrograms });
  const premadePlans = useQuery({ queryKey: ['workouts', 'premade-plans'], queryFn: fetchPremadePlans, enabled: tab === 'premade' && showsPrograms });
  const communityPlans = useQuery({ queryKey: ['workouts', 'community-plans'], queryFn: fetchCommunityPlans, enabled: tab === 'explore' && showsPrograms });

  const exploreItems = useMemo(() => explore.data?.pages.flatMap((p) => p.items) ?? [], [explore.data]);
  const exploreTotal = explore.data?.pages[0]?.pagination?.total ?? exploreItems.length;

  const remove = useMutation({
    mutationFn: async (workout: SocialWorkout) => {
      await api.delete(`/workouts/${workout._id}`);
      return workout._id;
    },
    onSuccess: (id) => {
      toast.success('Workout deleted');
      qc.setQueryData<{ pages: WorkoutPage[]; pageParams: unknown[] }>(['workouts', 'mine', 'paged'], (old) => (old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((w) => w._id !== id) })) } : old));
      qc.invalidateQueries({ queryKey: ['workouts'] });
      setPendingDelete(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete workout')),
  });

  const removePlan = useMutation({
    mutationFn: async (plan: WorkoutPlan) => {
      await api.delete(`/workouts/plan/${plan._id}`);
      return plan._id;
    },
    onSuccess: (id) => {
      toast.success('Plan deleted');
      qc.setQueryData<WorkoutPlan[]>(['workouts', 'plans'], (old) => (old ?? []).filter((p) => p._id !== id));
      qc.removeQueries({ queryKey: ['workout-plan', id] });
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      setPendingPlanDelete(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete plan')),
  });

  type Pane = {
    loading: boolean;
    error: unknown;
    refetch: () => unknown;
    items: (SocialWorkout | WorkoutPlan)[];
    plans: boolean;
    hasMore?: boolean;
    fetchMore?: () => unknown;
    fetchingMore?: boolean;
    total?: number;
  };

  const pane: Pane = (() => {
    if (tab === 'mine') {
      return { loading: mine.isLoading, error: mine.isError ? mine.error : null, refetch: mine.refetch, items: mineItems, plans: false, hasMore: mine.hasNextPage, fetchMore: mine.fetchNextPage, fetchingMore: mine.isFetchingNextPage, total: mineTotal };
    }
    if (tab === 'plans') {
      return { loading: plans.isLoading, error: plans.isError ? plans.error : null, refetch: plans.refetch, items: plans.data ?? [], plans: true };
    }
    if (tab === 'explore') {
      if (showsPrograms) {
        return { loading: communityPlans.isLoading, error: communityPlans.isError ? communityPlans.error : null, refetch: communityPlans.refetch, items: communityPlans.data ?? [], plans: true };
      }
      return { loading: explore.isLoading, error: explore.isError ? explore.error : null, refetch: explore.refetch, items: exploreItems, plans: false, hasMore: explore.hasNextPage, fetchMore: explore.fetchNextPage, fetchingMore: explore.isFetchingNextPage, total: exploreTotal };
    }
    if (showsPrograms) {
      return { loading: premadePlans.isLoading, error: premadePlans.isError ? premadePlans.error : null, refetch: premadePlans.refetch, items: premadePlans.data ?? [], plans: true };
    }
    return { loading: premade.isLoading, error: premade.isError ? premade.error : null, refetch: premade.refetch, items: premade.data ?? [], plans: false };
  })();

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = pane.items;
    if (!query) return list;
    return list.filter((item) => {
      const hay = [item.title, item.description, (item as SocialWorkout).category, (item as WorkoutPlan).goal, item.level, ...(item.hashtags ?? [])].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(query);
    });
  }, [pane.items, query]);

  const counts: Partial<Record<TabKey, number>> = {
    mine: mine.data ? mineTotal : undefined,
    plans: plans.data?.length,
    explore: tab === 'explore' && showsPrograms ? communityPlans.data?.length : explore.data ? exploreTotal : undefined,
    premade: tab === 'premade' && showsPrograms ? premadePlans.data?.length : premade.data?.length,
  };

  const lastDone = useMemo(() => lastDoneByTitle(logs), [logs]);
  const strip = useMemo(() => weekItems(logs, system), [logs, system]);
  // The library decides the landing tab. Until it answers, no tab is drawn as
  // chosen, so the thumb never slides from Mine to Premade on a cold load.
  const landing = !isTabKey(tabParam) && mine.isPending;
  const creating = tab === 'plans' ? { label: 'New plan', to: TRAIN.newPlan } : { label: 'New workout', to: TRAIN.newWorkout };

  const newWorkoutAction = { label: 'New workout', to: TRAIN.newWorkout, state: sheetState, icon: <Plus size={18} />, variant: 'secondary' as const };
  const newPlanAction = { label: 'New plan', to: TRAIN.newPlan, state: sheetState, icon: <Plus size={18} />, variant: 'secondary' as const };
  const browsePremade = { label: 'Browse premade', to: TRAIN.tab('premade'), variant: 'quiet' as const };

  const emptyCopy: Record<TabKey, { title: string; message: string; action: typeof newWorkoutAction | typeof newPlanAction; secondary?: typeof browsePremade }> = {
    mine: {
      title: 'No workouts of your own yet',
      message: 'Build one, or start from a premade and make it yours. It lives here, ready to log, share or add to a plan.',
      action: newWorkoutAction,
      secondary: browsePremade,
    },
    plans: {
      title: 'No plans yet',
      message: 'Group your workouts into a multi-week programme and follow it week by week.',
      action: newPlanAction,
    },
    explore: showsPrograms
      ? { title: 'No shared programs yet', message: 'Public plans from other members show up here. Share one of yours to get things going.', action: newPlanAction }
      : { title: 'Nothing shared yet', message: 'Public workouts from other members show up here. Share one of yours to get things going.', action: newWorkoutAction },
    premade: showsPrograms
      ? { title: 'No premade programs yet', message: 'Vybe’s curated programs are not published yet. Build your own plan in the meantime.', action: newPlanAction }
      : { title: 'No premade workouts yet', message: 'Vybe’s ready-made sessions are not published yet. Build your own in the meantime.', action: newWorkoutAction },
  };

  const filterLabel = pane.plans ? 'plans' : 'workouts';

  return (
    <div className="space-y-section">
      <PageHeader
        title="Workouts"
        actions={
          <>
            <ButtonLink to={creating.to} state={sheetState} variant="quiet">
              {creating.label}
            </ButtonLink>
            <ButtonLink to={TRAIN.newSession()} state={sheetState} variant="primary" icon={<Play size={18} />}>
              Start a session
            </ButtonLink>
          </>
        }
        mobileActions={
          <IconButton label="Start a session" to={TRAIN.newSession()} state={sheetState}>
            <Play size={22} />
          </IconButton>
        }
      />

      {/* The week: a strip once there is something to count, one line until then, a same-height skeleton before either. */}
      {logsQuery.isError ? null : logsQuery.isPending ? (
        <Skeleton className="h-[66px] w-full rounded-lg" />
      ) : strip.length ? (
        <StatStrip aria-label="Your week" items={strip} />
      ) : (
        <WeekLine last={logs[0] ?? null} state={sheetState} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Workout library"
          className="min-w-0 flex-1 basis-[22rem]"
          tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: hasMetric(counts[t.key]) ? counts[t.key] : undefined }))}
          value={landing ? '' : tab}
          onChange={(k: string) => {
            if (isTabKey(k)) setTab(k);
          }}
        />
        <SearchField
          label={`Filter ${filterLabel}`}
          hideLabel
          containerClassName="min-w-0 flex-1 basis-[14rem]"
          placeholder={pane.plans ? 'Filter plans by name or goal' : 'Filter by title, category or tag'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {tab === 'explore' || tab === 'premade' ? (
          <div role="group" aria-label={tab === 'premade' ? 'Premade catalogue' : 'Community catalogue'} className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Chip key={k.key} selected={kind === k.key} onClick={() => setKind(k.key)}>
                {k.label}
              </Chip>
            ))}
          </div>
        ) : null}

        {pane.loading ? (
          <GridSkeleton />
        ) : pane.error ? (
          <ErrorState error={pane.error} title={`Could not load ${filterLabel}`} onRetry={() => pane.refetch()} />
        ) : filtered.length === 0 ? (
          query ? (
            <EmptyState
              variant="no-results"
              title={`No matches for “${search.trim()}”`}
              message={pane.plans ? 'Try a different name or goal, or clear the filter.' : 'Try a different title, category or tag, or clear the filter.'}
              action={{ label: 'Clear filter', onClick: () => setSearch(''), variant: 'secondary' }}
            />
          ) : (
            <EmptyState family="train" title={emptyCopy[tab].title} message={emptyCopy[tab].message} action={emptyCopy[tab].action} secondaryAction={emptyCopy[tab].secondary} />
          )
        ) : pane.plans ? (
          <CardGrid min="20rem">
            {(filtered as WorkoutPlan[]).map((plan) => (
              <PlanCard key={plan._id} plan={plan} ownerView={tab === 'plans'} onAddWorkout={(p) => setAddingTo(p)} onDelete={(p) => setPendingPlanDelete(p)} />
            ))}
          </CardGrid>
        ) : (
          <>
            <CardGrid min="20rem">
              {(filtered as SocialWorkout[]).map((workout) => (
                <WorkoutCard
                  key={workout._id}
                  workout={workout}
                  ownerView={tab === 'mine'}
                  lastDone={lastDone.get(workout.title.trim().toLowerCase())}
                  gym={gymName}
                  onDelete={(w) => setPendingDelete(w)}
                  onReport={(w) => report({ targetType: 'workout', targetId: w._id, targetLabel: 'workout' })}
                  onAddToPlan={(w) => setAddToPlan(w)}
                />
              ))}
            </CardGrid>
            {pane.hasMore || (pane.total !== undefined && pane.total > pane.items.length) ? (
              <div className="flex flex-col items-center gap-2 pt-2">
                <p className="text-xs text-text-3">
                  Showing {formatStat(pane.items.length)} of {formatStat(pane.total ?? pane.items.length)} {filterLabel}
                </p>
                {pane.hasMore ? (
                  <Button variant="secondary" loading={pane.fetchingMore} onClick={() => pane.fetchMore?.()}>
                    Load more
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {addingTo ? <AddWorkoutPicker plan={addingTo} open onClose={() => setAddingTo(null)} /> : null}
      <AddToPlanModal
        workout={addToPlan}
        onClose={() => setAddToPlan(null)}
        onCreatePlan={() => {
          setAddToPlan(null);
          open(TRAIN.newPlan);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete workout?"
        message={`“${pendingDelete?.title ?? ''}” will be removed from your library. Sessions you have already logged are kept.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
      <ConfirmDialog
        open={Boolean(pendingPlanDelete)}
        title="Delete plan?"
        message={`“${pendingPlanDelete?.title ?? ''}” will be removed. The workouts scheduled in it stay in your library.`}
        confirmLabel="Delete"
        destructive
        loading={removePlan.isPending}
        onCancel={() => setPendingPlanDelete(null)}
        onConfirm={() => pendingPlanDelete && removePlan.mutate(pendingPlanDelete)}
      />
      {reportModal}
    </div>
  );
}
