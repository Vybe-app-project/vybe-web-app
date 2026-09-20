import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeatureGate } from '../lib/capabilities';
import { localDayParams } from '../lib/timezone';
import { useUnits, weightUnit } from '../lib/units';
import { EmptyState, ErrorState, PageHeader, PageSkeleton, SkeletonCard, Tabs } from './ui';
import { Plus } from './icons';
import {
  PERIODS,
  PROGRESS_STRINGS,
  YEAR_FALLBACK,
  isFeatureDisabled,
  isProgressPeriod,
  periodLabel,
  periodRange,
  workoutPreferencesOf,
  type ProgressCalendar,
  type ProgressPeriod,
  type ProgressSummary,
} from '../lib/progress';
import { ProgressTiles } from './progress/ProgressTiles';
import { TrainingCalendar } from './progress/TrainingCalendar';
import { MuscleGroups } from './progress/MuscleGroups';
import { Movements } from './progress/Movements';
import { RecordsList } from './progress/RecordsList';
import { ExerciseTrendSheet } from './progress/ExerciseTrendSheet';

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

  const periodParam = params.get('period');
  const period: ProgressPeriod = isProgressPeriod(periodParam) ? periodParam : 'month';
  const exerciseId = params.get('exercise');

  // The summary window: the quarter stands in for the year (92-day cap).
  const summaryPeriod = period === 'year' ? YEAR_FALLBACK : period;
  const range = useMemo(() => periodRange(summaryPeriod), [summaryPeriod]);
  const yearRange = useMemo(() => periodRange('year'), []);

  const summary = useQuery({
    queryKey: ['workout-progress', 'summary', range.from, range.to, range.timezoneOffsetMinutes],
    enabled,
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
  if (!enabled) return <Navigate to="/workouts/logs" replace />;

  // Which days feed the heatmap, and what the calendar card says about them.
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
    <div className="space-y-6">
      <PageHeader title={PROGRESS_STRINGS.title} subtitle={PROGRESS_STRINGS.subtitle} />

      <div className="space-y-2">
        <Tabs
          variant="segmented"
          aria-label={PROGRESS_STRINGS.period}
          tabs={PERIODS.map((p) => ({ key: p.key, label: p.label }))}
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
      ) : (
        <ProgressTiles summary={data} unit={unit} days={range.days} loading={summary.isPending} />
      )}

      {calendarLoading ? (
        <SkeletonCard media={false} />
      ) : calendarFailed ? (
        <ErrorState error={calendar.error} title="Could not load your training days" onRetry={() => calendar.refetch()} />
      ) : heatDays || !summary.isError ? (
        <TrainingCalendar range={heatRange} days={heatDays} rangeLabel={heatRangeLabel} note={calendarNote} />
      ) : null}

      {summary.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard media={false} />
          <SkeletonCard media={false} />
        </div>
      ) : summary.isError ? null : nothingLogged ? (
        <EmptyState
          title={PROGRESS_STRINGS.emptyTitle}
          message={PROGRESS_STRINGS.emptyBody}
          action={{ label: PROGRESS_STRINGS.emptyCta, to: '/workouts/logs?log=1', icon: <Plus size={18} /> }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <MuscleGroups groups={data?.muscleGroups} showAll={showAllMuscles} onToggle={() => setShowAllMuscles((v) => !v)} />
          <Movements exercises={data?.exercises} system={system} onOpen={openExercise} />
          <RecordsList className="lg:col-span-2" prs={data?.prs} system={system} showAll={showAllRecords} onToggle={() => setShowAllRecords((v) => !v)} />
        </div>
      )}

      <ExerciseTrendSheet exerciseId={exerciseId} name={exerciseRow?.name} measure={exerciseRow?.measure} system={system} preferences={preferences} onClose={closeExercise} />
    </div>
  );
}
