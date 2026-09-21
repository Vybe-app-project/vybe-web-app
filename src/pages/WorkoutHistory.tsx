import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { eachDayOfInterval, format, isValid, parseISO, startOfDay, subDays } from 'date-fns';
import { api, errMsg } from '../lib/api';
import { formatSeconds } from '../lib/duration';
import { displayWeight, useUnits, weightUnit } from '../lib/units';
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Menu,
  PageHeader,
  SegmentedControl,
  Skeleton,
  SkeletonTile,
  StatGrid,
  StatTile,
  cx,
  formatStat,
  humanize,
  useIsCompact,
  useToast,
  type MenuItem,
} from './ui';
import { Activity, Clock, Copy, Dumbbell, Edit, Flame, Plus, Trash, TrendingUp, Upload, Zap } from './icons';
import { MetaList } from './workouts/cards';
import { LOGS_KEY, dayKey, dayLabel, dayStreak, fetchLogs, parseLogDate, relativeDay, sessionVolume, sortLogs, weekTotals, weeksKept, type LogsResponse, type WorkoutLog } from './workouts/sessions';
import { usePortabilitySupport } from '../lib/portability';
import { periodRange } from '../lib/progress';
import { fetchRecordsSummary, isNotDeployed, recordKeys } from '../lib/records';
import { SessionResumeBar } from './workouts/session/ResumeBar';
import { TRAIN, useSheetNav } from './workouts/sheet';

// Recharts lives in the chart's own chunk; the 13 rem box keeps its height while it loads.
const HistoryChart = lazy(() => import('./workouts/HistoryChart'));

/**
 * History (was "Workout log"): every session you have logged, newest first,
 * with the week's numbers and the last seven days. A session opens as a sheet
 * (/workouts/history/:logId); logging one is /workouts/history/new. Older
 * deep links — /workouts/logs?log=1, ?from=<workoutId>, ?starter=1 — are
 * forwarded to that route with their seed intact.
 *
 * Coming from another app (P4): the header menu and the empty state both lead
 * to /workouts/import, and both disappear once lib/portability has seen a
 * 404 NOT_FOUND from the import route on this deployment.
 *
 * "PR" on a row comes from the period summary's own `prs[]`, each of which
 * carries the `workoutId` that set it: the badge is never derived here. The
 * summary is capped at 92 days, so a session older than the quarter carries no
 * badge — absent, not "no PR", which is the zero rule.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${formatStat(n)} ${n === 1 ? one : many}`;

/** Where a member arriving from Strong or Hevy goes, named once. */
export const IMPORT_PATH = '/workouts/import';
export const IMPORT_LABEL = 'Import from Strong or Hevy';
const IMPORT_MENU: MenuItem[] = [{ label: IMPORT_LABEL, description: 'A CSV export from either app', icon: <Upload size={18} />, to: IMPORT_PATH }];

/* --------------------------------------------------------------- session card */

function SessionCard({ log, onEdit, onRepeat, onDelete, state, pr = false }: { log: WorkoutLog; onEdit: (log: WorkoutLog) => void; onRepeat: (log: WorkoutLog) => void; onDelete: (log: WorkoutLog) => void; state: unknown; pr?: boolean }) {
  const system = useUnits((s) => s.system);
  const unit = weightUnit(system);
  const d = parseLogDate(log.date);
  const volume = sessionVolume(log);
  const exercises = log.exercises ?? [];
  const menu: MenuItem[] = [
    { label: 'Edit', icon: <Edit size={18} />, onSelect: () => onEdit(log) },
    { label: 'Log again', description: 'Same session, dated now', icon: <Copy size={18} />, onSelect: () => onRepeat(log) },
    { label: 'Delete', icon: <Trash size={18} />, danger: true, divider: true, onSelect: () => onDelete(log) },
  ];
  return (
    <Card container className="relative flex flex-col gap-3">
      <Link to={TRAIN.session(log._id)} state={state} viewTransition aria-label={`Open ${log.name || 'workout'}`} className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="type-heading truncate text-md text-text-1">{log.name || 'Workout'}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2">
            {d ? (
              <time dateTime={d.toISOString()} className="tabular">
                {format(d, 'HH:mm')}
              </time>
            ) : (
              <span>Unknown time</span>
            )}
            {log.type ? <Badge size="sm">{humanize(log.type)}</Badge> : null}
            {pr ? (
              <Badge size="sm" tone="accent" data-testid="log-pr">
                PR<span className="sr-only"> — a personal record in this session</span>
              </Badge>
            ) : null}
          </p>
        </div>
        <Menu items={menu} label={`Options for ${log.name || 'workout'}`} className="relative z-[2] -mr-2 -mt-1.5" />
      </div>

      <MetaList
        items={[
          !!log.duration && { icon: <Clock size={14} />, label: `${formatStat(log.duration)} min` },
          !!log.caloriesBurned && { icon: <Flame size={14} />, label: `${formatStat(log.caloriesBurned)} kcal` },
          volume > 0 && { icon: <Dumbbell size={14} />, label: `${formatStat(displayWeight(volume, system), { compact: volume >= 10_000 })} ${unit} lifted`, title: `${Math.round(volume).toLocaleString()} kg` },
          { icon: <Activity size={14} />, label: plural(exercises.length, 'exercise') },
        ]}
      />

      {exercises.length > 0 ? (
        <ul className="grid gap-1.5 @md:grid-cols-2">
          {exercises.map((ex, i) => {
            const completedSets = Array.isArray(ex.setRecords) ? ex.setRecords.filter((s) => s.completed) : null;
            const facts = completedSets
              ? [completedSets.length ? `${formatStat(completedSets.length)} ${completedSets.length === 1 ? 'set' : 'sets'}` : 'No sets done']
              : ([
                  ex.sets ? `${formatStat(ex.sets)} × ${formatStat(ex.reps ?? 0)}` : ex.reps ? `${formatStat(ex.reps)} reps` : null,
                  ex.weight ? `${formatStat(displayWeight(ex.weight, system))} ${unit}` : null,
                  ex.duration ? formatSeconds(ex.duration) : null,
                  ex.distance ? `${formatStat(ex.distance)} km` : null,
                ].filter(Boolean) as string[]);
            return (
              <li key={ex.exerciseId ?? `${log._id}-${i}`} className="flex min-h-10 items-center justify-between gap-3 rounded-sm bg-surface-2 px-3 py-1.5 text-sm">
                <span className="truncate font-medium text-text-1">{ex.name}</span>
                {facts.length ? (
                  <span className="type-stat shrink-0 text-sm text-text-2">
                    {facts.map((f, j) => (
                      <span key={f} className={cx(j > 0 && 'ml-2.5')}>
                        {f}
                      </span>
                    ))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {log.notes ? <p className="prose-measure line-clamp-3 text-sm text-text-2">{log.notes}</p> : null}
    </Card>
  );
}

/* -------------------------------------------------------------- week chart */

type Metric = 'volume' | 'minutes' | 'sessions';
const METRICS: Array<{ key: Metric; label: string }> = [
  { key: 'volume', label: 'Volume' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'sessions', label: 'Sessions' },
];

function WeekChart({ data, metric, onMetric, unit }: { data: Array<{ day: string; date: string; volume: number; minutes: number; sessions: number }>; metric: Metric; onMetric: (m: Metric) => void; unit: string }) {
  const meta = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const suffix = metric === 'volume' ? ` ${unit}` : metric === 'minutes' ? ' min' : '';
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="type-heading text-lg text-text-1">Last 7 days</h2>
          <p className="text-xs text-text-2">{meta.key === 'volume' ? 'Weight moved per day' : meta.key === 'minutes' ? 'Time trained per day' : 'Sessions per day'}</p>
        </div>
        <SegmentedControl aria-label="Chart metric" size="sm" tabs={METRICS.map((m) => ({ key: m.key, label: m.label }))} value={metric} onChange={(k) => onMetric(k as Metric)} />
      </div>
      <div className="relative h-52 w-full" role="img" aria-label={`${meta.label} for the last 7 days`}>
        <Suspense fallback={<Skeleton className="h-full w-full rounded-md" />}>
          <HistoryChart data={data} metric={metric} label={meta.label} suffix={suffix} />
        </Suspense>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function WorkoutHistory() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const [pendingDelete, setPendingDelete] = useState<WorkoutLog | null>(null);
  const [metric, setMetric] = useState<Metric>('volume');
  const compact = useIsCompact();
  const system = useUnits((s) => s.system);
  const unit = weightUnit(system);
  const { hash } = useLocation();
  const { state, open } = useSheetNav();
  const canImport = usePortabilitySupport((p) => p.importSupported);

  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: LOGS_KEY, queryFn: fetchLogs });
  const logs = useMemo(() => sortLogs(data?.workouts ?? []), [data]);

  // Which sessions set a record, straight from the summary's prs[] (92-day cap,
  // so the quarter is the widest window one read can answer for).
  const prWindow = useMemo(() => {
    const range = periodRange('quarter');
    return { from: range.from, to: range.to };
  }, []);
  const records = useQuery({
    queryKey: recordKeys.summary(prWindow),
    retry: false,
    staleTime: 60_000,
    queryFn: () => fetchRecordsSummary(prWindow),
  });
  const prWorkouts = useMemo(() => {
    if (records.isError && isNotDeployed(records.error)) return new Set<string>();
    return new Set((records.data?.prs ?? []).map((pr) => pr.workoutId).filter((id): id is string => typeof id === 'string' && !!id));
  }, [records.data, records.isError, records.error]);

  // Deep links from before the session route existed: ?log=1 opened the form here, ?from=<workoutId> prefilled it from a
  // library workout, ?starter=1 (the first-week card's "Start here") with the starter session. Forward them, seed intact.
  const wantsLog = params.get('log') === '1';
  const fromId = params.get('from');
  const wantsStarter = wantsLog && params.get('starter') === '1';
  useEffect(() => {
    if (!wantsLog) return;
    const n = new URLSearchParams(params);
    n.delete('log');
    n.delete('from');
    n.delete('starter');
    open(TRAIN.newSession({ from: fromId ?? undefined, starter: wantsStarter }), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLog, fromId, wantsStarter]);

  const remove = useMutation({
    mutationFn: async (log: WorkoutLog) => {
      await api.delete(`/workouts/logs/${log._id}`);
      return log._id;
    },
    onMutate: async (log) => {
      await qc.cancelQueries({ queryKey: LOGS_KEY });
      const previous = qc.getQueryData<LogsResponse>(LOGS_KEY);
      if (previous) {
        qc.setQueryData<LogsResponse>(LOGS_KEY, { ...previous, workouts: previous.workouts.filter((w) => w._id !== log._id), total: Math.max(0, previous.total - 1) });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(LOGS_KEY, ctx.previous);
      toast.error(errMsg(e, 'Could not delete session'));
    },
    onSuccess: () => toast.success('Session deleted'),
    onSettled: () => {
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: LOGS_KEY });
      // The progress hub's tiles, calendar, movements and records count this session too.
      qc.invalidateQueries({ queryKey: ['workout-progress'] });
      // And so do the records reads behind the PR badges and the bests shelf.
      qc.invalidateQueries({ queryKey: recordKeys.all });
    },
  });

  /* ---- derived: 14-day buckets → the chart; Monday weeks → the tiles */
  const chartData = useMemo(() => {
    const end = startOfDay(new Date());
    const start = subDays(end, 13);
    const buckets = new Map<string, { volume: number; sessions: number; minutes: number }>();
    for (const day of eachDayOfInterval({ start, end })) buckets.set(dayKey(day), { volume: 0, sessions: 0, minutes: 0 });
    for (const log of logs) {
      const d = parseLogDate(log.date);
      const bucket = d ? buckets.get(dayKey(d)) : undefined;
      if (!bucket) continue;
      bucket.volume += displayWeight(sessionVolume(log), system);
      bucket.sessions += 1;
      bucket.minutes += Number(log.duration) || 0;
    }
    return [...buckets.entries()].map(([key, value]) => ({ day: format(parseISO(key), 'EEE'), date: key, ...value, volume: Math.round(value.volume) }));
  }, [logs, system]);
  const lastSeven = chartData.slice(7);
  const fortnightHasSessions = chartData.some((d) => d.sessions > 0);
  const { week, lastWeek } = useMemo(() => weekTotals(logs), [logs]);
  const streak = useMemo(() => dayStreak(logs), [logs]);
  const kept = useMemo(() => weeksKept(logs), [logs]);

  const lastTrained = logs.length ? parseLogDate(logs[0].date) : null;

  /* ---- history grouped by day */
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: WorkoutLog[] }> = [];
    for (const log of logs) {
      const d = parseLogDate(log.date);
      const key = d ? dayKey(d) : 'unknown';
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(log);
      else out.push({ key, label: d ? dayLabel(d) : 'Unknown date', items: [log] });
    }
    return out;
  }, [logs]);

  // A calendar cell on the progress hub links to /workouts/history#day-<yyyy-MM-dd>. This list holds the latest 100
  // sessions only, so a day past that window (or one emptied since) has no heading to land on; say so instead of
  // leaving the member at the top wondering.
  const missingDay = useMemo(() => {
    const match = /^#day-(\d{4}-\d{2}-\d{2})$/.exec(hash);
    if (!match || !data || !logs.length || groups.some((g) => g.key === match[1])) return null;
    const day = parseISO(match[1]);
    if (!isValid(day)) return null;
    const oldest = parseLogDate(logs[logs.length - 1].date);
    const beyondWindow = Boolean(data.hasNextPage) && !!oldest && day < startOfDay(oldest);
    return { label: format(day, 'EEEE d MMMM yyyy'), beyondWindow };
  }, [hash, data, logs, groups]);

  // Land on that day once the list has rendered.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!/^day-\d{4}-\d{2}-\d{2}$/.test(id) || !groups.length) return;
    const t = window.setTimeout(() => {
      const heading = document.getElementById(id);
      const section = heading?.closest('section') as HTMLElement | null;
      if (!section) return;
      section.scrollIntoView({ block: 'start', behavior: 'smooth' });
      section.setAttribute('tabindex', '-1');
      section.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [hash, groups]);

  const delta = (now: number, before: number) => (before === 0 && now === 0 ? undefined : { value: Math.round(now - before), label: 'vs last week' });
  const hasLogs = logs.length > 0;

  return (
    <div className="space-y-section">
      <PageHeader
        title="History"
        subtitle="Every session you have logged."
        actions={
          <>
            <ButtonLink to="/workouts/progress" variant="secondary" icon={<TrendingUp size={18} />}>
              View progress
            </ButtonLink>
            <ButtonLink to={TRAIN.newSession()} state={state} variant={hasLogs ? 'primary' : 'secondary'} icon={<Plus size={18} />}>
              Log session
            </ButtonLink>
            {canImport ? <Menu items={IMPORT_MENU} label="More history options" /> : null}
          </>
        }
        mobileActions={
          <>
            <IconButton label="Log session" to={TRAIN.newSession()} state={state}>
              <Plus size={24} />
            </IconButton>
            {canImport ? <Menu items={IMPORT_MENU} label="More history options" /> : null}
          </>
        }
      />

      <SessionResumeBar />

      {isLoading ? (
        <>
          <StatGrid columns={4}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonTile key={i} />
            ))}
          </StatGrid>
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} padded={false} className="space-y-3 p-4">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
                <div className="grid gap-1.5 sm:grid-cols-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : isError ? (
        <ErrorState error={error} title="Could not load your sessions" onRetry={() => refetch()} />
      ) : !hasLogs ? (
        <EmptyState
          family="train"
          title="No sessions yet"
          message="Log your first session and your weekly volume, time and streak start building here."
          action={{ label: 'Log session', to: TRAIN.newSession(), state, icon: <Plus size={18} /> }}
          secondaryAction={
            <>
              {canImport ? (
                <ButtonLink to={IMPORT_PATH} variant="ghost" icon={<Upload size={18} />}>
                  {IMPORT_LABEL}
                </ButtonLink>
              ) : null}
              <ButtonLink to={TRAIN.hub} variant="quiet">
                Start from a workout
              </ButtonLink>
            </>
          }
        />
      ) : (
        <>
          {week.sessions > 0 ? (
            <StatGrid columns={streak > 0 ? 4 : 3}>
              <StatTile label="Sessions this week" value={formatStat(week.sessions)} icon={<Dumbbell size={18} />} delta={delta(week.sessions, lastWeek.sessions)} spark={compact ? undefined : lastSeven.map((d) => d.sessions)} />
              <StatTile
                label="Time this week"
                value={week.minutes > 0 ? formatStat(week.minutes) : '–'}
                unit={week.minutes > 0 ? 'min' : undefined}
                icon={<Clock size={18} />}
                delta={week.minutes > 0 ? delta(week.minutes, lastWeek.minutes) : undefined}
                hint={week.minutes > 0 ? undefined : 'No durations logged'}
                spark={compact ? undefined : lastSeven.map((d) => d.minutes)}
              />
              <StatTile
                label="Lifted this week"
                value={week.volumeKg > 0 ? formatStat(Math.round(displayWeight(week.volumeKg, system)), { compact: week.volumeKg >= 10_000 }) : '–'}
                unit={week.volumeKg > 0 ? unit : undefined}
                icon={<Activity size={18} />}
                delta={week.volumeKg > 0 ? delta(displayWeight(week.volumeKg, system), displayWeight(lastWeek.volumeKg, system)) : undefined}
                hint={week.volumeKg > 0 ? undefined : 'No weights logged'}
                spark={compact ? undefined : lastSeven.map((d) => d.volume)}
              />
              {streak > 0 ? <StatTile label="Streak" value={formatStat(streak)} unit={streak === 1 ? 'day' : 'days'} icon={<Zap size={18} filled />} hint="Train today to keep it going" /> : null}
            </StatGrid>
          ) : (
            <Card container>
              <div className="flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between">
                <div className="min-w-0">
                  <h2 className="type-heading text-md text-text-1">No session yet this week</h2>
                  <p className="mt-1 text-sm text-text-2">
                    {lastTrained ? `Last session ${logs[0].name || 'Workout'}, ${relativeDay(lastTrained).toLowerCase()}.` : ''}
                    {lastWeek.sessions > 0 ? ` Last week: ${plural(lastWeek.sessions, 'session')}${lastWeek.minutes ? ` · ${formatStat(lastWeek.minutes)} min` : ''}.` : ''}
                    {kept > 1 ? ` ${formatStat(kept)} weeks kept so far.` : ''}
                  </p>
                </div>
                <ButtonLink to={TRAIN.newSession({ repeat: logs[0]._id })} state={state} variant="secondary" icon={<Copy size={18} />} className="shrink-0 self-start @md:self-auto">
                  Log it again
                </ButtonLink>
              </div>
            </Card>
          )}

          {fortnightHasSessions ? <WeekChart data={lastSeven} metric={metric} onMetric={setMetric} unit={unit} /> : null}

          <div className="space-y-section">
            {missingDay ? (
              <Callout tone="info">
                <p role="status" data-testid="log-day-missing">
                  {missingDay.beyondWindow ? `${missingDay.label} is further back than the latest ${formatStat(logs.length)} sessions shown here.` : `No sessions on ${missingDay.label} in this history.`}
                </p>
              </Callout>
            ) : null}
            {groups.map((g) => (
              <section key={g.key} aria-labelledby={`day-${g.key}`} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id={`day-${g.key}`} className="type-label text-text-2">
                    {g.label}
                  </h2>
                  <span className="text-xs text-text-3">{plural(g.items.length, 'session')}</span>
                </div>
                <div className="space-y-3">
                  {g.items.map((log) => (
                    <SessionCard key={log._id} log={log} state={state} pr={prWorkouts.has(log._id)} onEdit={(l) => open(TRAIN.session(l._id, { edit: true }))} onRepeat={(l) => open(TRAIN.newSession({ repeat: l._id }))} onDelete={setPendingDelete} />
                  ))}
                </div>
              </section>
            ))}
            {data?.hasNextPage ? <p className="text-center text-xs text-text-3">Showing your latest {formatStat(logs.length)} of {formatStat(data.total)} sessions.</p> : null}
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete session?"
        message={`${pendingDelete?.name || 'This session'} will be removed from your history and your weekly totals.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
