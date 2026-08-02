import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { format } from 'date-fns';
import { adminApi, ORIGIN_BASE, errMsg } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  cx,
} from '../../components/ui';
import { Server, Refresh, Check, X, Alert, BarChart } from '../../components/icons';

/* --------------------------------------------------------------- types */

type Health = { status?: string; timestamp?: string; uptime?: number };
type Ready = {
  status?: string;
  database?: 'connected' | 'disconnected';
  providers?: Record<string, unknown>;
};
type PerfEntry = {
  count?: number;
  avgTime?: number;
  minTime?: number;
  maxTime?: number;
  totalTime?: number;
};
type PerfResponse = { success?: boolean; stats?: Record<string, PerfEntry> };

const POLL_MS = 10_000;

/**
 * /health and /ready are mounted at the server root, NOT under /api, so they
 * are fetched with a bare axios client against the origin. They are public,
 * which also means a 401 here must not bounce the admin session.
 */
const originApi = axios.create({ baseURL: ORIGIN_BASE || '/', timeout: 8000 });

function humanizeUptime(seconds?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

function ms(v?: number): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold',
        ok === null
          ? 'border-slate-700 bg-slate-800/60 text-slate-400'
          : ok
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/40 bg-red-500/10 text-red-300',
      )}
    >
      {ok === null ? <Alert size={12} /> : ok ? <Check size={12} /> : <X size={12} />}
      {label}
    </span>
  );
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3">
      <p className="font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-slate-100 tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function AdminSystem() {
  const health = useQuery<Health>({
    queryKey: ['system', 'health'],
    queryFn: async () => (await originApi.get('/health')).data ?? {},
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });

  const ready = useQuery<Ready>({
    queryKey: ['system', 'ready'],
    // /ready answers 503 when the DB is down; that body is still meaningful.
    queryFn: async () => {
      try {
        const { data } = await originApi.get('/ready');
        return data ?? {};
      } catch (e: any) {
        const body = e?.response?.data;
        if (body && typeof body === 'object') return body as Ready;
        throw e;
      }
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });

  const perf = useQuery<PerfResponse>({
    queryKey: ['admin', 'performance'],
    queryFn: async () => (await adminApi.get('/admin/performance')).data ?? {},
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const liveOk = health.isError ? false : health.data ? health.data.status === 'OK' : null;
  const readyOk = ready.data ? ready.data.status === 'ready' : ready.isError ? false : null;
  const dbConnected = ready.data
    ? ready.data.database === 'connected'
    : ready.isError
      ? false
      : null;

  const rows = useMemo(() => {
    const stats = perf.data?.stats ?? {};
    return Object.entries(stats)
      .map(([key, v]) => ({
        key,
        count: Number(v?.count) || 0,
        avgTime: Number(v?.avgTime) || 0,
        minTime: Number(v?.minTime) || 0,
        maxTime: Number(v?.maxTime) || 0,
        totalTime: Number(v?.totalTime) || 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [perf.data]);

  const totals = useMemo(() => {
    if (rows.length === 0) return null;
    const requests = rows.reduce((n, r) => n + r.count, 0);
    const totalTime = rows.reduce((n, r) => n + r.totalTime, 0);
    const slowest = rows.reduce((a, b) => (b.maxTime > a.maxTime ? b : a), rows[0]);
    return {
      requests,
      avg: requests > 0 ? totalTime / requests : 0,
      slowestKey: slowest.key,
      slowestMax: slowest.maxTime,
      endpoints: rows.length,
    };
  }, [rows]);

  const providers = ready.data?.providers;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-50">System</h1>
          <p className="mt-1 text-sm text-slate-500">
            Liveness and readiness are polled every 10 seconds directly from the API origin.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Refresh size={14} />}
          loading={health.isFetching || ready.isFetching || perf.isFetching}
          onClick={() => {
            void health.refetch();
            void ready.refetch();
            void perf.refetch();
          }}
        >
          Refresh now
        </Button>
      </div>

      {/* Status */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-800 bg-slate-950/60">
          <CardHeader title="Liveness" subtitle="GET /health" />
          {health.isLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <>
              <StatusPill ok={liveOk} label={liveOk ? 'Healthy' : liveOk === null ? 'Unknown' : 'Unreachable'} />
              <p className="mt-3 font-mono text-[11px] text-slate-500">
                {health.isError
                  ? errMsg(health.error, 'The API did not respond.')
                  : health.data?.timestamp
                    ? `Reported ${format(new Date(health.data.timestamp), 'HH:mm:ss')}`
                    : '—'}
              </p>
            </>
          )}
        </Card>

        <Card className="border-slate-800 bg-slate-950/60">
          <CardHeader title="Readiness" subtitle="GET /ready" />
          {ready.isLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  ok={readyOk}
                  label={readyOk ? 'Ready' : readyOk === null ? 'Unknown' : 'Not ready'}
                />
                <StatusPill
                  ok={dbConnected}
                  label={
                    dbConnected
                      ? 'DB connected'
                      : dbConnected === null
                        ? 'DB unknown'
                        : 'DB disconnected'
                  }
                />
              </div>
              {providers && Object.keys(providers).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(providers).map(([name, state]) => (
                    <Badge key={name} tone={state ? 'success' : 'danger'}>
                      {name}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {ready.isError && !ready.data ? (
                <p className="mt-3 font-mono text-[11px] text-red-400">
                  {errMsg(ready.error, 'Readiness probe failed.')}
                </p>
              ) : null}
            </>
          )}
        </Card>

        <Card className="border-slate-800 bg-slate-950/60">
          <CardHeader title="Process uptime" subtitle="Since last restart" />
          {health.isLoading ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <>
              <p className="font-mono text-2xl font-bold text-slate-100">
                {humanizeUptime(health.data?.uptime)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {typeof health.data?.uptime === 'number'
                  ? `${Math.round(health.data.uptime).toLocaleString()} seconds`
                  : 'Uptime not reported'}
              </p>
            </>
          )}
        </Card>
      </div>

      {/* Aggregate request stats */}
      <Card className="border-slate-800 bg-slate-950/60">
        <CardHeader
          title="Request throughput"
          subtitle="Aggregated from the in-process performance cache"
        />
        {perf.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : perf.isError ? (
          <ErrorState
            error={perf.error}
            retry={() => void perf.refetch()}
            title="Could not load performance stats"
            className="py-8"
          />
        ) : !totals ? (
          <EmptyState
            icon={<BarChart size={22} />}
            title="No samples recorded"
            message="The performance cache is empty — it fills as requests are served after a restart."
            className="py-10"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Requests sampled" value={totals.requests.toLocaleString()} />
            <StatTile label="Avg latency" value={ms(totals.avg)} sub="Across all tracked routes" />
            <StatTile
              label="Worst case"
              value={ms(totals.slowestMax)}
              sub={totals.slowestKey}
            />
            <StatTile label="Tracked routes" value={String(totals.endpoints)} />
          </div>
        )}
      </Card>

      {/* Per-route table */}
      <Card padded={false} className="overflow-hidden border-slate-800 bg-slate-950/60">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-100">Latency by route</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Sorted by request volume. Refreshes every 30 seconds.
          </p>
        </div>

        {perf.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Server size={22} />}
            title="No route samples"
            message="Performance data appears once the API has served instrumented requests."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                  <th className="px-4 py-3 font-semibold">Route</th>
                  <th className="px-4 py-3 text-right font-semibold">Requests</th>
                  <th className="px-4 py-3 text-right font-semibold">Avg</th>
                  <th className="px-4 py-3 text-right font-semibold">Min</th>
                  <th className="px-4 py-3 text-right font-semibold">Max</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className={cx('divide-y divide-slate-800/70', perf.isFetching && 'opacity-60')}>
                {rows.map((r) => (
                  <tr key={r.key} className="transition-colors hover:bg-slate-900/40">
                    <td className="px-4 py-2.5 font-mono text-[12px] break-all text-slate-200">
                      {r.key}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-slate-300 tabular-nums">
                      {r.count.toLocaleString()}
                    </td>
                    <td
                      className={cx(
                        'px-4 py-2.5 text-right font-mono text-[12px] tabular-nums',
                        r.avgTime > 1000
                          ? 'text-red-300'
                          : r.avgTime > 300
                            ? 'text-amber-300'
                            : 'text-emerald-300',
                      )}
                    >
                      {ms(r.avgTime)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-slate-500 tabular-nums">
                      {ms(r.minTime)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-slate-400 tabular-nums">
                      {ms(r.maxTime)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-slate-500 tabular-nums">
                      {ms(r.totalTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-center font-mono text-[11px] text-slate-600">
        Origin: {ORIGIN_BASE || window.location.origin}
      </p>
    </div>
  );
}
