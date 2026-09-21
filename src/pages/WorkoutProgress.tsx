import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeatureGate } from '../lib/capabilities';
import { localDayParams } from '../lib/timezone';
import { useUnits, weightUnit } from '../lib/units';
import { CardGrid, EmptyState, ErrorState, PageHeader, PageSkeleton, SkeletonCard, SegmentedControl, useToast } from './ui';
import { Plus } from './icons';
import {
  PERIODS,
  PROGRESS_STRINGS,
  YEAR_FALLBACK,
  adjustmentLine,
  isFeatureDisabled,
  isProgressPeriod,
  periodLabel,
  periodRange,
  shelfRows,
  shortDate,
  workoutPreferencesOf,
  type ProgressCalendar,
  type ProgressPeriod,
  type ProgressSummary,
  type ShelfRow,
} from '../lib/progress';
import {
  clearRecordsReset,
  deleteRecord,
  fetchAdjustments,
  fetchRecords,
  isNotDeployed,
  recordIdOf,
  recordKeys,
  resetRecords,
  restoreRecord,
} from '../lib/records';
import { ProgressTiles } from './progress/ProgressTiles';
import { TrainingCalendar } from './progress/TrainingCalendar';
import { MuscleGroups } from './progress/MuscleGroups';
import { Movements } from './progress/Movements';
import { RecordsList } from './progress/RecordsList';
import { RecordAdjustments, RecordsShelf, ResetRecordsDialog, SHELF_COLLAPSED, factLabel, type AdjustmentRow } from './progress/RecordsShelf';
import { ExerciseTrendSheet } from './progress/ExerciseTrendSheet';
import { TRAIN, useSheetNav } from './workouts/sheet';

/**
 * The progression hub at /workouts/progress (design-progression-hub.md §3.8)
 * over the Wave F1 records API. Period chips (Week · Month · 3 months · Year)
 * live in `?period=`; every card has its own skeleton, content, empty and
 * error state and the page never blocks on one of them.
 *
 * Flag: the whole surface exists only while `features.progression` is on for
 * the caller. The gate waits for the capabilities query (a cold load must not
 * bounce), then sends a member without the flag to today's stats on
 * /workouts/logs. Nothing here fetches until the flag has answered true.
 *
 * Windows: GET /workouts/records/summary is capped at 92 days, so the Year
 * chip reads the 3-month summary for every tile and list and says so: the
 * label under the chips is always the summary's own window, and the year
 * range is printed on the calendar card alone, the one card that covers it.
 * The heatmap reads GET /workouts/records/calendar
 * (365 days), which the server keeps behind the flag per caller. A 404
 * FEATURE_DISABLED there (a rollout bucket, a 30 s cache window) degrades to
 * `summary.byDay` with an honest line, never an error.
 *
 * Personal records (P4): GET /workouts/records for the movements the summary
 * named, plus the two corrections the API supports per exercise — remove one
 * record (with an Undo through .../restore) and start fresh from a date (with
 * an Undo through DELETE .../reset). `GET /workouts/records/adjustments` reads
 * one exercise at a time, so the Adjustments line asks only once it is opened.
 * A 404 NOT_FOUND on any of them (a server without the routes) hides the
 * shelf; it is never an error state.
 */

export default function WorkoutProgress() {
  const gate = useFeatureGate('progression');
  const enabled = gate.enabled;
  const [params, setParams] = useSearchParams();
  const system = useUnits((s) => s.system);
  const unit = weightUnit(system);
  const user = useAuth((s) => s.user);
  const preferences = useMemo(() => workoutPreferencesOf(user), [user]);
  const [showAllMuscles, setShowAllMuscles] = useState(false);
  const [showAllRecords, setShowAllRecords] = useState(false);
  const [showAllBests, setShowAllBests] = useState(false);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [resetRow, setResetRow] = useState<ShelfRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { state: sheetState } = useSheetNav();
  const toast = useToast();
  const qc = useQueryClient();

  const periodParam = params.get('period');
  const period: ProgressPeriod = isProgressPeriod(periodParam) ? periodParam : 'month';
  const exerciseId = params.get('exercise');

  // The summary window: the quarter stands in for the year (92-day cap).
  const summaryPeriod = period === 'year' ? YEAR_FALLBACK : period;
  const range = useMemo(() => periodRange(summaryPeriod), [summaryPeriod]);
  const yearRange = useMemo(() => periodRange('year'), []);

  const summary = useQuery({
    queryKey: ['workout-progress', 'summary', range.from, range.to, range.timezoneOffsetMinutes],
    // GET /workouts/records/summary is not flag-gated (the app shows the hub with the flag off too).
    enabled: !gate.isPending,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get<ProgressSummary>('/workouts/records/summary', { params: { from: range.from, to: range.to, ...localDayParams() } });
      return data;
    },
  });

  const calendar = useQuery({
    queryKey: ['workout-progress', 'calendar', yearRange.from, yearRange.to, yearRange.timezoneOffsetMinutes],
    enabled: enabled && period === 'year',
    // A FEATURE_DISABLED 404 is an answer, not a fault: no retry, fall back at once.
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get<ProgressCalendar>('/workouts/records/calendar', { params: { from: yearRange.from, to: yearRange.to, ...localDayParams() } });
      return data;
    },
  });

  // The movements the summary named, which is what the bests read is keyed on
  // (the route takes up to 50 ids and lib/records trims to that).
  const exerciseIds = useMemo(
    () => (summary.data?.exercises ?? []).map((row) => row.exerciseId).filter((id): id is string => typeof id === 'string' && !!id),
    [summary.data],
  );

  const bests = useQuery({
    queryKey: recordKeys.bests(exerciseIds),
    enabled: exerciseIds.length > 0,
    // A 404 from a server without the maintenance routes is an answer, not a fault.
    retry: false,
    staleTime: 60_000,
    queryFn: () => fetchRecords(exerciseIds),
  });

  const shelf = useMemo(() => shelfRows(summary.data?.exercises, bests.data, system), [summary.data, bests.data, system]);
  const shownIds = useMemo(
    () => (showAllBests ? shelf : shelf.slice(0, SHELF_COLLAPSED)).map((row) => row.exerciseId),
    [shelf, showAllBests],
  );

  // One read per movement on screen: the route has no "every exercise" form,
  // so nothing is asked until the member opens the line.
  const adjustmentQueries = useQueries({
    queries: shownIds.map((id) => ({
      queryKey: recordKeys.adjustments(id),
      enabled: adjustmentsOpen,
      retry: false,
      staleTime: 60_000,
      queryFn: () => fetchAdjustments(id),
    })),
  });

  const adjustmentRows: AdjustmentRow[] = adjustmentQueries.flatMap((query, index) => {
    const exerciseId = shownIds[index];
    const name = shelf.find((row) => row.exerciseId === exerciseId)?.name ?? exerciseId;
    return (query.data ?? []).map((adjustment) => ({
      id: adjustment.id,
      exerciseId: adjustment.exerciseId,
      name,
      kind: adjustment.kind,
      text: adjustmentLine(adjustment.kind, null, adjustment.kind === 'reset' ? shortDate(adjustment.from ?? '') : null),
    }));
  });
  const adjustmentsLoading = adjustmentsOpen && adjustmentQueries.some((query) => query.isPending);

  const refreshRecords = async () => {
    await qc.invalidateQueries({ queryKey: recordKeys.all });
    await qc.invalidateQueries({ queryKey: ['workout-progress'] });
  };

  async function removeRecord(row: ShelfRow, factIndex: number) {
    const recordId = recordIdOf(row.exerciseId, row.facts[factIndex]);
    if (!recordId) return;
    setBusy(row.exerciseId);
    try {
      await deleteRecord(recordId);
      await refreshRecords();
      toast.success(`${factLabel(row, factIndex)} no longer counts for ${row.name}.`, {
        action: { label: PROGRESS_STRINGS.undo, onClick: () => void undoRemove(recordId) },
        duration: 12_000,
      });
    } catch (e) {
      toast.error(errMsg(e, 'Could not remove that record.'));
    } finally {
      setBusy(null);
    }
  }

  async function undoRemove(recordId: string) {
    try {
      await restoreRecord(recordId);
      await refreshRecords();
      toast.success('That record counts again.');
    } catch (e) {
      toast.error(errMsg(e, 'Could not put that record back.'));
    }
  }

  async function confirmReset(from: string) {
    const row = resetRow;
    if (!row) return;
    setBusy(row.exerciseId);
    try {
      await resetRecords(row.exerciseId, from);
      setResetRow(null);
      await refreshRecords();
      toast.success(`${row.name}: records before ${shortDate(from)} no longer count.`, {
        action: { label: PROGRESS_STRINGS.undo, onClick: () => void undoReset(row.exerciseId) },
        duration: 12_000,
      });
    } catch (e) {
      toast.error(errMsg(e, 'Could not start fresh for that movement.'));
    } finally {
      setBusy(null);
    }
  }

  async function undoReset(exerciseId: string) {
    try {
      await clearRecordsReset(exerciseId);
      await refreshRecords();
      toast.success('Every session counts again.');
    } catch (e) {
      toast.error(errMsg(e, 'Could not undo that.'));
    }
  }

  async function undoAdjustment(row: AdjustmentRow) {
    setBusy(row.id);
    try {
      if (row.kind === 'reset') await clearRecordsReset(row.exerciseId);
      else {
        const found = adjustmentQueries.flatMap((query) => query.data ?? []).find((item) => item.id === row.id);
        if (found && found.kind === 'exclude') await restoreRecord(found.recordId);
      }
      await refreshRecords();
    } catch (e) {
      toast.error(errMsg(e, 'Could not undo that.'));
    } finally {
      setBusy(null);
    }
  }

  const setPeriod = (next: ProgressPeriod) => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next === 'month') n.delete('period');
        else n.set('period', next);
        return n;
      },
      { replace: true },
    );
  };
  const openExercise = (id: string) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      n.set('exercise', id);
      return n;
    });
  };
  const closeExercise = () => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('exercise');
        return n;
      },
      { replace: true },
    );
  };

  if (gate.isPending) return <PageSkeleton />;
  if (gate.isError) return <ErrorState title="Could not check what is available" error={gate.error} onRetry={() => gate.refetch()} />;
  // The hub is visible with the flag off, as in the app; only the Year calendar, the hints and the
  // Settings switch wait for `progression`. A Year deep link falls back to the quarter while off.
  if (!enabled && period === 'year') return <Navigate to="/workouts/progress" replace />;

  // Which days feed the heatmap, and what the calendar card says about them.
  // A server without the records routes answers 404 NOT_FOUND: hide the shelf, never an error state.
  const bestsHidden = bests.isError && isNotDeployed(bests.error);
  const calendarHidden = period === 'year' && calendar.isError && isFeatureDisabled(calendar.error);
  const calendarFailed = period === 'year' && calendar.isError && !calendarHidden;
  const calendarLoading = period === 'year' ? (calendarHidden ? summary.isPending : calendar.isPending) : summary.isPending;
  const heatDays = period === 'year' && calendar.data ? calendar.data.days : summary.data?.byDay;
  const heatRange = period === 'year' && calendar.data ? yearRange : range;
  const calendarNote = calendarHidden ? PROGRESS_STRINGS.yearFallback : null;
  // The label names the window the tiles and lists actually cover; on Year that is the quarter.
  const label = periodLabel(range);
  const yearNote = period === 'year' ? (calendarHidden ? PROGRESS_STRINGS.yearAllQuarterNote : PROGRESS_STRINGS.yearSummaryNote) : null;
  const heatRangeLabel = heatRange === yearRange ? periodLabel(yearRange) : null;

  const data = summary.data;
  const nothingLogged = !!data && data.sessions === 0 && (data.prs?.length ?? 0) === 0;
  const exerciseRow = exerciseId ? data?.exercises?.find((row) => row.exerciseId === exerciseId) : undefined;

  return (
    <div className="space-y-section">
      <PageHeader title={PROGRESS_STRINGS.title} subtitle={PROGRESS_STRINGS.subtitle} />

      <div className="space-y-2">
        <SegmentedControl
          aria-label={PROGRESS_STRINGS.period}
          tabs={PERIODS.filter((p) => enabled || p.key !== 'year').map((p) => ({ key: p.key, label: p.label }))}
          value={period}
          onChange={(k: string) => setPeriod(k as ProgressPeriod)}
          className="max-w-md"
        />
        <p className="text-xs text-text-2">
          {label}
          {yearNote ? <span className="block text-text-3 sm:ml-2 sm:inline">{yearNote}</span> : null}
        </p>
      </div>

      {summary.isError ? (
        <ErrorState error={summary.error} title={PROGRESS_STRINGS.cardError} onRetry={() => summary.refetch()} />
      ) : nothingLogged ? (
        // Nothing in the window: one prompt with a verb instead of a strip of zeros and a blank calendar.
        <EmptyState family="train" title={PROGRESS_STRINGS.emptyTitle} message={PROGRESS_STRINGS.emptyBody} action={{ label: PROGRESS_STRINGS.emptyCta, to: TRAIN.newSession(), state: sheetState, icon: <Plus size={18} /> }} />
      ) : (
        <>
          <ProgressTiles summary={data} unit={unit} days={range.days} loading={summary.isPending} />

          {calendarLoading ? (
            <SkeletonCard media={false} />
          ) : calendarFailed ? (
            <ErrorState error={calendar.error} title="Could not load your training days" onRetry={() => calendar.refetch()} />
          ) : (
            <TrainingCalendar range={heatRange} days={heatDays} rangeLabel={heatRangeLabel} note={calendarNote} />
          )}

          {summary.isPending ? (
            <CardGrid min="22rem">
              <SkeletonCard media={false} />
              <SkeletonCard media={false} />
            </CardGrid>
          ) : (
            <>
              <CardGrid min="22rem">
                <MuscleGroups groups={data?.muscleGroups} showAll={showAllMuscles} onToggle={() => setShowAllMuscles((v) => !v)} />
                <Movements exercises={data?.exercises} system={system} onOpen={openExercise} />
              </CardGrid>
              <RecordsList prs={data?.prs} system={system} showAll={showAllRecords} onToggle={() => setShowAllRecords((v) => !v)} />
              {bestsHidden ? null : (
                <RecordsShelf
                  rows={shelf}
                  loading={exerciseIds.length > 0 && bests.isPending}
                  showAll={showAllBests}
                  onToggle={() => setShowAllBests((v) => !v)}
                  onRemove={(row, index) => void removeRecord(row, index)}
                  onReset={setResetRow}
                  busyExerciseId={busy}
                  footer={
                    shelf.length ? (
                      <RecordAdjustments
                        open={adjustmentsOpen}
                        rows={adjustmentRows}
                        loading={adjustmentsLoading}
                        onOpen={() => setAdjustmentsOpen(true)}
                        onUndo={(row) => void undoAdjustment(row)}
                        busyId={busy}
                      />
                    ) : null
                  }
                />
              )}
            </>
          )}
        </>
      )}

      <ResetRecordsDialog row={resetRow} busy={!!resetRow && busy === resetRow.exerciseId} onClose={() => setResetRow(null)} onConfirm={(from) => void confirmReset(from)} />

      <ExerciseTrendSheet exerciseId={exerciseId} name={exerciseRow?.name} measure={exerciseRow?.measure} system={system} preferences={preferences} onClose={closeExercise} />
    </div>
  );
}
