import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { enrolledMeta, useRoutineFolders } from '../lib/programs';
import { displayWeight, useUnits, weightUnit } from '../lib/units';
import {
  Button,
  ButtonLink,
  ConfirmDialog,
  ErrorState,
  IconButton,
  PageHeader,
  Section,
  SegmentedControl,
  Skeleton,
  StatStrip,
  formatStat,
  hasMetric,
  useToast,
  type MenuItem,
  type StatStripItem,
} from './ui';
import { ArrowRight, Copy, Edit, Flag, Inbox, Layers, Play, Plus, ShareUp, Trash } from './icons';
import { useReportModal } from './Report';
import { useContinueProgram, useEnrolments } from './workouts/continue';
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
import { ALL_FOLDERS, FolderChips, MoveToFolderDialog, folderChips, folderTotal, inFolder, type FolderFilter } from './workouts/folders';
import { AddToPlanModal, AddWorkoutPicker } from './workouts/planPickers';
import { PlanRow, ROW_ACTION, RowList, RowSkeleton, WorkoutRow } from './workouts/rows';
import { LOGS_KEY, fetchLogs, lastDoneByTitle, parseLogDate, relativeDay, sortLogs, weekTotals, weeksKept, type WorkoutLog } from './workouts/sessions';
import { SessionResumeBar } from './workouts/session/ResumeBar';
import { useHasSession } from './workouts/session/store';
import { TRAIN, useSheetNav } from './workouts/sheet';

/**
 * The Train hub (2026-09-21). Top to bottom on a phone: the week as a
 * StatStrip (one line before the first session); the page's ONE prominent
 * button — "Start a session", or "Continue {plan} · Week n · Day d" while a
 * programme is running; a two-segment pill, Mine | Browse; then hairline rows.
 *
 * Every "Start" on this page opens the live runner (`TRAIN.liveSession`,
 * src/pages/workouts/session/Runner.tsx); logging a session after the fact is
 * the header's quiet "Log a past session". While a session is open the CTA
 * reads "Resume session" and a hairline bar at the top says how far in it is.
 *
 * Mine opens first and is designed for its zero state, which is where most
 * members are: one line, an outlined "New workout", three premade rows to
 * start from, and a link to Browse. Nobody is dropped into the catalogue.
 * Browse is three sections — Vybe workouts, Programs, From members — each
 * with its count in the header; a programme is a commitment, so its row opens
 * the schedule and Start lives there.
 *
 * No search field and no chip row: eleven catalogue items need neither, and
 * every control row above the first item is chrome the member pays for. Detail
 * and editor routes open as sheets over this page on desktop
 * (src/pages/workouts/*); the schedule pickers stay modals.
 */

// Legacy type and helper re-exports: FirstWeekCard and the detail pages import these from here.
export type { PlanEntry, SocialWorkout, WorkoutAuthor, WorkoutExercise, WorkoutPlan } from './workouts/model';
export { CATEGORY_OPTIONS, LEVEL_OPTIONS, fetchMyPlans, fetchPremade, sharePlan, shareWorkout } from './workouts/model';
export { LikeButton, MetaList } from './workouts/cards';
export { AddToPlanModal, AddWorkoutPicker } from './workouts/planPickers';

const TABS = [
  { key: 'mine', label: 'Mine' },
  { key: 'browse', label: 'Browse' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** `?tab=` values from before 2026-09-21 (plans · explore · premade) still land somewhere sensible. */
const tabFrom = (v: string | null): TabKey => (v === 'browse' || v === 'explore' || v === 'premade' ? 'browse' : 'mine');

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
 * One line in the strip's place when there is no week to count: before the
 * first session, or when the last one is more than two weeks back. The button
 * under it carries the action; this only says what is true — and, when there
 * is a last session, offers to repeat it. Same height as the strip, so the
 * block never shifts whichever way the data goes.
 */
function WeekLine({ last }: { last: WorkoutLog | null }) {
  const lastDate = last ? parseLogDate(last.date) : null;
  return (
    <div className="flex min-h-[66px] flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="t-body text-text-2">
        {last && lastDate ? `No session in the last two weeks. The last one was ${last.name || 'a workout'}, ${relativeDay(lastDate).toLowerCase()}.` : 'Your week fills in from the first session.'}
      </p>
      {last ? (
        <Link to={TRAIN.liveSession({ repeat: last._id })} viewTransition className={ROW_ACTION}>
          Repeat last <ArrowRight size={14} aria-hidden="true" />
        </Link>
      ) : null}
    </div>
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

/* ------------------------------------------------------------------ bits */

/** The count in a section header — drawn only when there is one (a zero is not a count). */
const Count = ({ n }: { n?: number }) => (hasMetric(n) ? <span className="t-meta tabular">{formatStat(n)}</span> : null);

function LoadMore({ shown, total, hasMore, fetching, onMore }: { shown: number; total?: number; hasMore?: boolean; fetching?: boolean; onMore?: () => unknown }) {
  if (!hasMore && !(total !== undefined && total > shown)) return null;
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      {total !== undefined && total > shown ? (
        <p className="t-meta">
          Showing {formatStat(shown)} of {formatStat(total)}
        </p>
      ) : null}
      {hasMore ? (
        <Button variant="secondary" loading={fetching} onClick={() => onMore?.()}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function Workouts() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tabParam = params.get('tab');
  const kindParam = params.get('kind');
  const tab: TabKey = tabFrom(tabParam);
  const [addingTo, setAddingTo] = useState<WorkoutPlan | null>(null);
  const [addToPlan, setAddToPlan] = useState<SocialWorkout | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SocialWorkout | null>(null);
  const [pendingPlanDelete, setPendingPlanDelete] = useState<WorkoutPlan | null>(null);
  const [moving, setMoving] = useState<SocialWorkout | null>(null);
  const [folder, setFolder] = useState<FolderFilter>(ALL_FOLDERS);
  const { report, reportModal } = useReportModal();
  const { state: sheetState, open } = useSheetNav();
  const system = useUnits((s) => s.system);
  const continueProgram = useContinueProgram();
  // One read for the hub: the CTA's label and every programme row's meta.
  const enrolments = useEnrolments();
  const hasSession = useHasSession();

  const qc = useQueryClient();
  const toast = useToast();

  const nextPage = (last: WorkoutPage) => (last.pagination && last.pagination.page < last.pagination.pages ? last.pagination.page + 1 : undefined);

  // The library and the log are read up front: Mine is the landing pane, the log feeds the strip and every row's "Done …".
  const mine = useInfiniteQuery({ queryKey: ['workouts', 'mine', 'paged'], queryFn: ({ pageParam }) => fetchMyWorkoutsPage(pageParam as number), initialPageParam: 1, getNextPageParam: nextPage });
  const logsQuery = useQuery({ queryKey: LOGS_KEY, queryFn: fetchLogs });
  const logs = useMemo(() => sortLogs(logsQuery.data?.workouts ?? []), [logsQuery.data]);
  const loadedMine = useMemo(() => mine.data?.pages.flatMap((p) => p.items) ?? [], [mine.data]);
  const loadedTotal = mine.data?.pages[0]?.pagination?.total ?? loadedMine.length;
  const mineEmpty = mine.isSuccess && loadedMine.length === 0;

  // Folders are a filing cabinet the member opted into: the chip row exists
  // only once they have made one, and it filters what is loaded (the count on
  // the chip is the server's, so "Showing 3 of 8" stays honest while paging).
  const folders = useRoutineFolders(tab === 'mine');
  const chips = useMemo(() => folderChips(folders.data?.folders ?? [], folders.data?.unfiled ?? 0, loadedTotal), [folders.data, loadedTotal]);
  const mineItems = useMemo(() => (folder === ALL_FOLDERS ? loadedMine : loadedMine.filter((w) => inFolder(w, folder))), [loadedMine, folder]);
  const mineTotal = folderTotal(chips, folder) ?? loadedTotal;

  const setTab = (next: TabKey) => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next === 'browse') n.set('tab', 'browse');
        else n.delete('tab');
        n.delete('kind');
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

  // Mine's zero state borrows the first three premade rows, so the catalogue is read as soon as the library turns out empty.
  const browsing = tab === 'browse';
  const plans = useQuery({ queryKey: ['workouts', 'plans'], queryFn: fetchMyPlans, enabled: !browsing });
  const premade = useQuery({ queryKey: ['workouts', 'premade'], queryFn: fetchPremade, enabled: browsing || mineEmpty });
  const premadePlans = useQuery({ queryKey: ['workouts', 'premade-plans'], queryFn: fetchPremadePlans, enabled: browsing || mineEmpty });
  const explore = useInfiniteQuery({
    queryKey: ['workouts', 'explore', 'paged'],
    queryFn: ({ pageParam }) => fetchExplorePage(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: browsing,
  });
  const communityPlans = useQuery({ queryKey: ['workouts', 'community-plans'], queryFn: fetchCommunityPlans, enabled: browsing });

  const exploreItems = useMemo(() => explore.data?.pages.flatMap((p) => p.items) ?? [], [explore.data]);
  const exploreTotal = explore.data?.pages[0]?.pagination?.total ?? exploreItems.length;
  const browseTotal = (premade.data?.length ?? 0) + (premadePlans.data?.length ?? 0);

  // `?tab=plans` / `#plans` and `?kind=programs` were panes; now they are sections — scroll to them once they have rendered.
  const wantsPlans = tabParam === 'plans' || location.hash === '#plans';
  const wantsPrograms = kindParam === 'programs';
  const plansReady = !browsing && !plans.isPending;
  const programsReady = browsing && !premadePlans.isPending;
  useEffect(() => {
    const id = wantsPlans && plansReady ? 'plans' : wantsPrograms && programsReady ? 'programs' : null;
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [wantsPlans, plansReady, wantsPrograms, programsReady]);

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

  const lastDone = useMemo(() => lastDoneByTitle(logs), [logs]);
  const strip = useMemo(() => weekItems(logs, system), [logs, system]);

  /** "Done yesterday" — only when this title has been logged. */
  const doneLabel = (workout: SocialWorkout): string | null => {
    const log = lastDone.get(workout.title.trim().toLowerCase());
    const when = log ? parseLogDate(log.date) : null;
    return when ? `Done ${relativeDay(when).toLowerCase()}` : null;
  };

  /** Owner actions on a Mine row. Catalogue rows have none: Share, Add to plan and Report live on the detail sheet. */
  const ownMenu = (workout: SocialWorkout): MenuItem[] => [
    { label: 'Edit', icon: <Edit size={18} />, onSelect: () => open(TRAIN.editWorkout(workout._id)) },
    { label: 'Add to plan', description: 'Schedule it into one of your plans', icon: <Layers size={18} />, onSelect: () => setAddToPlan(workout) },
    // Absent while the `programs` flag is off: the folders read answers 404 and there is nothing to move into.
    ...(folders.data ? [{ label: 'Move to folder…', description: 'File it, or make a folder', icon: <Inbox size={18} />, onSelect: () => setMoving(workout) }] : []),
    { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void shareWorkout(workout, toast, 'share') },
    { label: 'Copy link', icon: <Copy size={18} />, onSelect: () => void shareWorkout(workout, toast, 'copy') },
    { label: 'Delete', icon: <Trash size={18} />, onSelect: () => setPendingDelete(workout), danger: true, divider: true },
  ];
  // Report stays reachable from a catalogue row's detail sheet; the hook is kept for the modal it renders.
  void report;
  void Flag;

  // The page's one prominent action. A session already open comes first —
  // nothing else on this page matters while one is running — then the
  // programme's next day, then a fresh session.
  // Continue carries the programme slot, so finishing the session marks the day done.
  const cta = hasSession
    ? { label: 'Resume session', to: TRAIN.liveSession() }
    : continueProgram
      ? { label: continueProgram.label, to: continueProgram.to }
      : { label: 'Start a session', to: TRAIN.liveSession() };

  const workoutRow = (workout: SocialWorkout, own: boolean) => (
    <WorkoutRow
      key={workout._id}
      workout={workout}
      to={TRAIN.workout(workout._id)}
      startTo={TRAIN.liveSession({ from: workout._id })}
      state={sheetState}
      extra={[doneLabel(workout), own && workout.isPublic === false && 'Private']}
      menu={own ? ownMenu(workout) : undefined}
      compact={own}
    />
  );

  return (
    // One column on desktop too (Instagram's register): rows a metre wide put "Start" too far from the title.
    <div className="space-y-4 lg:max-w-form lg:space-y-section">
      <PageHeader
        title="Workouts"
        actions={
          <>
            <ButtonLink to={TRAIN.newSession()} state={sheetState} variant="quiet">
              Log a past session
            </ButtonLink>
            <ButtonLink to={TRAIN.newWorkout} state={sheetState} variant="quiet">
              New workout
            </ButtonLink>
            {/* The runner is a page, so this link carries no sheet background. */}
            <ButtonLink to={cta.to} variant="primary" icon={<Play size={18} />}>
              {cta.label}
            </ButtonLink>
          </>
        }
        mobileActions={
          <IconButton label={cta.label} to={cta.to}>
            <Play size={22} />
          </IconButton>
        }
      />

      {/* The week, then the one prominent button on phones (the desktop header carries it). The
          skeleton, the strip and the one-line state are all 66 px, so nothing below moves whichever
          way the log answers (a 44 px line here measured CLS 0.33 for members with a week to show). */}
      <SessionResumeBar />

      <div className="space-y-3">
        {logsQuery.isError ? null : logsQuery.isPending ? (
          <Skeleton className="h-[66px] w-full rounded-lg" />
        ) : strip.length ? (
          <StatStrip aria-label="Your week" items={strip} />
        ) : (
          <WeekLine last={logs[0] ?? null} />
        )}
        <ButtonLink to={cta.to} variant="primary" block icon={<Play size={18} />} className="lg:hidden">
          {cta.label}
        </ButtonLink>
      </div>

      <SegmentedControl
        aria-label="Workout library"
        className="lg:max-w-xs"
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={(k: string) => setTab(tabFrom(k))}
      />

      {tab === 'mine' ? (
        <div className="space-y-section">
          <Section title="My workouts" action={<Count n={mineTotal} />}>
            {mine.isPending ? (
              <RowSkeleton rows={3} />
            ) : mine.isError ? (
              <ErrorState error={mine.error} title="Could not load your workouts" onRetry={() => mine.refetch()} />
            ) : mineItems.length === 0 ? (
              <div className="space-y-3">
                <p className="t-body text-text-2">Nothing here yet — build one, or start one of these.</p>
                <ButtonLink to={TRAIN.newWorkout} state={sheetState} variant="secondary" block icon={<Plus size={18} />}>
                  New workout
                </ButtonLink>
                {premade.isPending ? (
                  <RowSkeleton rows={3} />
                ) : premade.data?.length ? (
                  <>
                    <RowList aria-label="Start one of these">{premade.data.slice(0, 3).map((w) => workoutRow(w, false))}</RowList>
                    <Link
                      to={TRAIN.tab('browse')}
                      viewTransition
                      className={ROW_ACTION}
                      onClick={(e) => {
                        e.preventDefault();
                        setTab('browse');
                      }}
                    >
                      Browse all{hasMetric(browseTotal) ? ` ${formatStat(browseTotal)}` : ''} <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <FolderChips chips={chips} value={folder} onChange={setFolder} />
                <RowList>{mineItems.map((w) => workoutRow(w, true))}</RowList>
                <LoadMore shown={mineItems.length} total={mineTotal} hasMore={mine.hasNextPage} fetching={mine.isFetchingNextPage} onMore={() => mine.fetchNextPage()} />
              </div>
            )}
          </Section>

          <div id="plans" className="scroll-mt-32">
            <Section
              title="My plans"
              action={
                <ButtonLink to={TRAIN.newPlan} state={sheetState} variant="link" size="sm" icon={<Plus size={16} />}>
                  New plan
                </ButtonLink>
              }
            >
              {plans.isPending ? (
                <RowSkeleton rows={2} />
              ) : plans.isError ? (
                <ErrorState error={plans.error} title="Could not load your plans" onRetry={() => plans.refetch()} />
              ) : !plans.data?.length ? (
                <p className="t-body text-text-2">No plans yet. A plan groups workouts into weeks you can follow one day at a time.</p>
              ) : (
                <RowList>
                  {plans.data.map((plan) => {
                    const href = `/workouts/plans/${plan._id}`;
                    return (
                      <PlanRow
                        key={plan._id}
                        plan={plan}
                        to={href}
                        state={sheetState}
                        extra={[enrolledMeta(enrolments.byPlan.get(plan._id)), !plan.isPremade && plan.isPublic === false && 'Private']}
                        menu={planMenu(plan, { isOwn: true, toast, onEdit: (p) => open(TRAIN.editPlan(p._id)), onAddWorkout: (p) => setAddingTo(p), onDelete: (p) => setPendingPlanDelete(p) })}
                      />
                    );
                  })}
                </RowList>
              )}
            </Section>
          </div>
        </div>
      ) : (
        <div className="space-y-section">
          <Section title="Vybe workouts" action={<Count n={premade.data?.length} />}>
            {premade.isPending ? (
              <RowSkeleton rows={8} />
            ) : premade.isError ? (
              <ErrorState error={premade.error} title="Could not load the catalogue" onRetry={() => premade.refetch()} />
            ) : !premade.data?.length ? (
              <p className="t-body text-text-2">Vybe’s ready-made sessions are not published yet.</p>
            ) : (
              <RowList>{premade.data.map((w) => workoutRow(w, false))}</RowList>
            )}
          </Section>

          <div id="programs" className="scroll-mt-32">
            <Section title="Programs" action={<Count n={premadePlans.data?.length} />}>
              {premadePlans.isPending ? (
                <RowSkeleton rows={3} />
              ) : premadePlans.isError ? (
                <ErrorState error={premadePlans.error} title="Could not load the programs" onRetry={() => premadePlans.refetch()} />
              ) : !premadePlans.data?.length ? (
                <p className="t-body text-text-2">Vybe’s programs are not published yet.</p>
              ) : (
                <RowList>
                  {premadePlans.data.map((plan) => (
                    <PlanRow key={plan._id} plan={plan} to={TRAIN.plan(plan._id)} state={sheetState} extra={[enrolledMeta(enrolments.byPlan.get(plan._id))]} />
                  ))}
                </RowList>
              )}
            </Section>
          </div>

          <Section title="From members" action={<Count n={exploreTotal} />}>
            {explore.isPending ? (
              <RowSkeleton rows={3} />
            ) : explore.isError ? (
              <ErrorState error={explore.error} title="Could not load shared workouts" onRetry={() => explore.refetch()} />
            ) : exploreItems.length === 0 ? (
              <p className="t-body text-text-2">Nothing shared by members yet. Share one of yours to get things going.</p>
            ) : (
              <>
                <RowList>{exploreItems.map((w) => workoutRow(w, false))}</RowList>
                <LoadMore shown={exploreItems.length} total={exploreTotal} hasMore={explore.hasNextPage} fetching={explore.isFetchingNextPage} onMore={() => explore.fetchNextPage()} />
              </>
            )}
          </Section>

          {communityPlans.data?.length ? (
            <Section title="Shared programs" action={<Count n={communityPlans.data.length} />}>
              <RowList>
                {communityPlans.data.map((plan) => (
                  <PlanRow key={plan._id} plan={plan} to={TRAIN.plan(plan._id)} state={sheetState} extra={[enrolledMeta(enrolments.byPlan.get(plan._id))]} />
                ))}
              </RowList>
            </Section>
          ) : null}
        </div>
      )}

      {addingTo ? <AddWorkoutPicker plan={addingTo} open onClose={() => setAddingTo(null)} /> : null}
      <MoveToFolderDialog workout={moving} folders={folders.data?.folders ?? []} onClose={() => setMoving(null)} />
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
