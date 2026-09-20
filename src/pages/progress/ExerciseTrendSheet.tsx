import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';
import { ChartEmpty, ErrorState, Modal, Skeleton, Tabs, VIZ, chartTheme, humanize } from '../ui';
import {
  PROGRESS_STRINGS,
  RECORD_TYPES,
  RECORD_TYPE_TITLES,
  basisLine,
  formatClock,
  formatRecordValue,
  formatTrendValue,
  sessionLine,
  shortDate,
  suggestionLine,
  suggestionRule,
  trendDescription,
  trendSeries,
  type ProgressHistory,
  type ProgressMeasure,
  type ProgressPreviousResponse,
  type ProgressRecords,
  type WorkoutPreferences,
} from '../../lib/progress';
import type { UnitSystem } from '../../lib/unitConversions';

/**
 * The exercise detail for one movement (design-progression-hub.md §3.9):
 * its records (the seven types, absent ones hidden), a trend line in the
 * viewer's units (estimated 1RM for reps, time for holds, pace for
 * distance), the sessions list in their own words, and, when the API sent
 * one, the suggested next set with its rule and the two sessions it rests on.
 *
 * Reads GET /workouts/records/history (one page of 100), GET /workouts/records
 * and, only while the member's Suggestions switch is on, GET
 * /workouts/records/previous. `suggested` is present only with the flag on;
 * absent or null draws no line. Nothing here is coloured as a verdict.
 */

type TrendWindow = 'quarter' | 'year' | 'all';

const WINDOWS: ReadonlyArray<{ key: TrendWindow; label: string; days: number | null }> = [
  { key: 'quarter', label: '3 months', days: 91 },
  { key: 'year', label: 'Year', days: 365 },
  { key: 'all', label: 'All', days: null },
];

const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -8 };
const DAY_MS = 86_400_000;

/** The exercise's measure from what the history shows, when the summary did not say. */
function inferMeasure(history: ProgressHistory | undefined): ProgressMeasure {
  const rows = history?.sessions ?? [];
  if (rows.some((row) => (row.distanceKm ?? 0) > 0)) return 'distance';
  if (rows.some((row) => (row.durationMin ?? 0) > 0) && !rows.some((row) => row.sets.some((set) => set.completed === true))) return 'duration';
  return 'reps';
}

export function ExerciseTrendSheet({
  exerciseId,
  name,
  measure,
  system,
  preferences,
  onClose,
}: {
  /** null closes the sheet. */
  exerciseId: string | null;
  name?: string;
  measure?: ProgressMeasure;
  system: UnitSystem;
  preferences: WorkoutPreferences;
  onClose: () => void;
}) {
  const open = !!exerciseId;
  const id = exerciseId ?? '';
  const headingId = useId();
  const [window, setWindow] = useState<TrendWindow>('quarter');

  const history = useQuery({
    queryKey: ['workout-progress', 'history', id],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get<ProgressHistory>('/workouts/records/history', { params: { exerciseId: id, page: 1, limit: 100 } });
      return data;
    },
  });
  const records = useQuery({
    queryKey: ['workout-progress', 'records', id],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get<{ records: ProgressRecords }>('/workouts/records', { params: { exerciseId: id } });
      return data.records?.[id] ?? null;
    },
  });
  const previous = useQuery({
    queryKey: ['workout-progress', 'previous', id],
    enabled: open && preferences.progressionHints,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get<ProgressPreviousResponse>('/workouts/records/previous', { params: { exerciseId: id } });
      return data;
    },
  });

  const resolvedMeasure = measure ?? inferMeasure(history.data);
  const series = useMemo(() => trendSeries(resolvedMeasure, history.data?.sessions, system), [resolvedMeasure, history.data, system]);
  const shownPoints = useMemo(() => {
    const days = WINDOWS.find((w) => w.key === window)?.days ?? null;
    if (days === null) return series.points;
    const cutoff = Date.now() - days * DAY_MS;
    return series.points.filter((point) => Date.parse(point.date) >= cutoff);
  }, [series, window]);
  const shownSeries = { ...series, points: shownPoints };

  const title = name ?? history.data?.sessions[0]?.exerciseName ?? humanize(id);
  const recordRows = RECORD_TYPES.map((type) => ({ type, record: records.data?.[type] ?? null })).filter((row) => row.record);
  const suggested = preferences.progressionHints ? previous.data?.suggested ?? null : null;
  const animation = chartTheme.animationDuration;
  const timeAxis = series.unit === 's' || series.unit === 's/km' || series.unit === 's/mi';

  return (
    <Modal open={open} onClose={onClose} title={title} description="Records, trend and every session, in your units." size="lg">
      <div className="space-y-6">
        {/* Records */}
        <section aria-labelledby={`${headingId}-records`}>
          <h3 id={`${headingId}-records`} className="type-label mb-2 text-text-2">
            {PROGRESS_STRINGS.records}
          </h3>
          {records.isPending ? (
            <Skeleton className="h-20 w-full rounded-md" />
          ) : records.isError ? (
            <p className="text-sm text-text-2">Records could not load.</p>
          ) : recordRows.length === 0 ? (
            <p className="text-sm text-text-2">No records yet for this movement.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {recordRows.map(({ type, record }) => (
                <div key={type} className="rounded-md bg-surface-2 p-3">
                  <dt className="type-label text-text-2">{RECORD_TYPE_TITLES[type]}</dt>
                  <dd className="type-stat mt-1 text-lg text-text-1">{formatRecordValue(type, record!.value, system)}</dd>
                  <dd className="text-2xs text-text-3">{`${shortDate(record!.date)}${record!.reps ? ` · ${record!.reps} reps` : ''}`}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/* Trend */}
        <section aria-labelledby={`${headingId}-trend`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${headingId}-trend`} className="type-label text-text-2">
              {`${PROGRESS_STRINGS.trend} · ${series.what}`}
            </h3>
            <Tabs variant="segmented" size="sm" aria-label="Trend window" tabs={WINDOWS.map((w) => ({ key: w.key, label: w.label }))} value={window} onChange={(k: string) => setWindow(k as TrendWindow)} />
          </div>
          {history.isPending ? (
            <Skeleton className="h-52 w-full rounded-md" />
          ) : history.isError ? (
            <ErrorState error={history.error} title={PROGRESS_STRINGS.cardError} onRetry={() => history.refetch()} />
          ) : shownPoints.length < 2 ? (
            <ChartEmpty height={160} label={shownPoints.length === 1 ? `${PROGRESS_STRINGS.trendEmpty} One so far: ${formatTrendValue(series, shownPoints[0].value)} on ${shownPoints[0].label}.` : PROGRESS_STRINGS.trendEmpty} />
          ) : (
            <div className="h-52 w-full" role="img" aria-label={trendDescription(shownSeries)}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={shownPoints} margin={CHART_MARGIN}>
                  <CartesianGrid {...chartTheme.cartesianGrid} />
                  <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
                  <YAxis {...chartTheme.axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(v) => (timeAxis ? formatClock(Number(v)) : String(v))} />
                  <Tooltip {...chartTheme.tooltip} formatter={(v) => [formatTrendValue(series, Number(v ?? 0)), series.what]} />
                  <Line type="monotone" dataKey="value" stroke={VIZ.brand} strokeWidth={2} dot={{ r: 3, fill: VIZ.brand, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={animation > 0} animationDuration={animation} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {series.lowerIsBetter && shownPoints.length >= 2 ? <p className="mt-1 text-2xs text-text-3">Pace: a lower line is a faster run.</p> : null}
        </section>

        {/* Suggestion */}
        {suggested ? (
          <section aria-labelledby={`${headingId}-next`} className="rounded-md border border-line bg-surface-2 p-3 text-sm">
            <h3 id={`${headingId}-next`} className="font-semibold text-text-1">
              {suggestionLine(suggested)}
            </h3>
            <p className="mt-1 text-text-2">{suggestionRule(suggested)}</p>
            <p className="mt-2 text-xs font-medium text-text-3">{PROGRESS_STRINGS.basedOn}</p>
            <ul className="text-xs text-text-2">
              {suggested.basis.map((entry) => (
                <li key={entry.workoutId}>{basisLine(entry)}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-3">
              {`Your range: ${suggested.range.min}–${suggested.range.max} reps. Change it in `}
              <Link to="/settings#workouts" className="underline underline-offset-2 hover:text-text-1">
                Settings
              </Link>
              .
            </p>
          </section>
        ) : null}

        {/* Sessions */}
        <section aria-labelledby={`${headingId}-sessions`}>
          <h3 id={`${headingId}-sessions`} className="type-label mb-2 text-text-2">
            {history.data ? `Sessions · ${history.data.total}` : 'Sessions'}
          </h3>
          {history.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : history.isError ? null : (history.data?.sessions.length ?? 0) === 0 ? (
            <p className="text-sm text-text-2">No completed sessions yet.</p>
          ) : (
            <>
              <ol className="divide-y divide-line">
                {history.data!.sessions.map((row) => {
                  const line = sessionLine(row, system);
                  return (
                    <li key={row.workoutId} className="py-2 text-sm">
                      <p className="text-text-1">
                        {line.text}
                        {line.approximate ? <span className="ml-2 text-2xs text-text-3">{PROGRESS_STRINGS.approximate}</span> : null}
                      </p>
                      <p className="text-xs text-text-2">{`${shortDate(row.date)} · ${row.name}`}</p>
                    </li>
                  );
                })}
              </ol>
              {history.data!.hasNextPage ? <p className="mt-2 text-xs text-text-3">{PROGRESS_STRINGS.lastHundred}</p> : null}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
