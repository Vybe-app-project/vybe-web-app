import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { adminApi, ORIGIN_BASE, errMsg } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  SkeletonTile,
  StatGrid,
  StatTile,
  cx,
  humanize,
  plural,
} from '../../components/ui';
import { Server, Refresh, Check, X, Alert, BarChart, Zap } from '../../components/icons';
import { AdminPageHeader } from './AdminLayout';

/* --------------------------------------------------------------- types */

type Health = { status?: string; timestamp?: string; uptime?: number };
type Ready = {
  status?: string;
  database?: 'connected' | 'disconnected';
  providers?: Record<string, unknown>;
};
type Capabilities = { success?: boolean; authenticated?: boolean; capabilities?: Record<string, unknown> };
type PerfEntry = {
  count?: number;
  avgTime?: number;
  minTime?: number;
  maxTime?: number;
  totalTime?: number;
};
type PerfResponse = { success?: boolean; stats?: Record<string, PerfEntry> };

const POLL_MS = 10_000;
/** Rows shown before "Show all"; the table is sorted by volume so this is the top 25. */
const TOP_ROUTES = 25;

/**
 * The probes are read under the API prefix (/api/system/health, /api/system/
 * ready). The root /health and /ready are NOT proxied on the product origin:
 * Caddy serves the SPA there, so the console received index.html, failed to
 * find `status`, and reported a healthy API as "Unreachable / Not ready /
 * Database disconnected" every ten seconds.
 */
const PROBES = { health: '/system/health', ready: '/system/ready' } as const;

/** A probe answer is an object with a status; HTML (or anything else) means the path is not the API. */
function asProbe<T extends object>(data: unknown): T | null {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as T) : null;
}

/**
 * The provider capability booleans the API derives from its environment
 * (services/providerCapabilities.js). Grouped so an operator can read which
 * integrations are configured at a glance; unknown keys fall into "Other".
 */
const CAPABILITY_GROUPS: Array<{
  title: string;
  items: Array<{ key: string; label: string; description: string }>;
}> = [
  {
    title: 'Sign-in',
    items: [
      { key: 'emailAuth', label: 'Email and password', description: 'JWT secret present; sessions can be issued.' },
      { key: 'oauth', label: 'Social sign-in', description: 'At least one OAuth provider is configured.' },
      { key: 'googleOAuth', label: 'Google', description: 'Google client ID (web, or iOS plus web).' },
      { key: 'appleOAuth', label: 'Apple', description: 'Apple client ID.' },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { key: 'emailDelivery', label: 'Outbound email', description: 'SMTP host, sender and credentials complete.' },
      { key: 'push', label: 'Push notifications', description: 'Firebase service account loads.' },
    ],
  },
  {
    title: 'Media storage',
    items: [
      { key: 'storage', label: 'Uploads', description: 'A storage driver is ready.' },
      { key: 'localStorage', label: 'Local disk', description: 'Local driver with a signing secret.' },
      { key: 's3Storage', label: 'Amazon S3', description: 'Bucket, region and a credential source.' },
    ],
  },
  {
    title: 'Live',
    items: [
      { key: 'livestreamRelay', label: 'Livestream relay', description: 'Livestream config enabled.' },
      { key: 'turnRelay', label: 'TURN relay', description: 'WebRTC relay for streams behind NAT.' },
    ],
  },
  {
    title: 'Data providers',
    items: [
      { key: 'googlePlaces', label: 'Gym search', description: 'Places lookup available by any route.' },
      { key: 'googlePlacesProvider', label: 'Google Places key', description: 'Paid Places or Maps API key.' },
      { key: 'googlePlacesFallback', label: 'OpenStreetMap fallback', description: 'OSM user agent, or a non-production build.' },
      { key: 'usda', label: 'USDA food database', description: 'FoodData Central API key for nutrition lookups.' },
    ],
  },
];

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
    <span className="admin-status" data-state={ok === null ? 'unknown' : ok ? 'ok' : 'bad'}>
      {ok === null ? <Alert size={14} /> : ok ? <Check size={14} /> : <X size={14} />}
      {label}
    </span>
  );
}

/** Latency reads as plain numerals until it crosses the warning thresholds. */
function Latency({ value }: { value: number }) {
  if (value > 1000) return <Badge tone="danger" className="tabular">{ms(value)}</Badge>;
  if (value > 300) return <Badge tone="warning" className="tabular">{ms(value)}</Badge>;
  return <span className="tabular">{ms(value)}</span>;
}

/* ---------------------------------------------------------------- page */

export default function AdminSystem() {
  const [showAllRoutes, setShowAllRoutes] = useState(false);

  const health = useQuery<Health | null>({
    queryKey: ['system', 'health'],
    queryFn: async () => asProbe<Health>((await adminApi.get(PROBES.health)).data),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });

  const ready = useQuery<Ready | null>({
    queryKey: ['system', 'ready'],
    // The readiness probe answers 503 when the DB is down; that body is still meaningful.
    queryFn: async () => {
      try {
        return asProbe<Ready>((await adminApi.get(PROBES.ready)).data);
      } catch (e: any) {
        const body = asProbe<Ready>(e?.response?.data);
        if (body) return body;
        throw e;
      }
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });

  // Public endpoint; read through the admin client so the request carries the
  // same origin/base as everything else in the console.
  const caps = useQuery<Capabilities>({
    queryKey: ['system', 'capabilities'],
    queryFn: async () => (await adminApi.get('/capabilities')).data ?? {},
    staleTime: 60_000,
  });

  const perf = useQuery<PerfResponse>({
    queryKey: ['admin', 'performance'],
    queryFn: async () => (await adminApi.get('/admin/performance')).data ?? {},
    refetchInterval: 30_000,
    staleTime: 0,
  });

  // `null` data after a successful fetch means the path answered with
  // something that is not the probe (an HTML page): report "not exposed"
  // rather than a false alarm.
  const healthNotExposed = health.isSuccess && health.data === null;
  const readyNotExposed = ready.isSuccess && ready.data === null;
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

  const capabilities = useMemo(() => {
    const raw = caps.data?.capabilities;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  }, [caps.data]);

  const knownKeys = useMemo(
    () => new Set(CAPABILITY_GROUPS.flatMap((g) => g.items.map((i) => i.key))),
    [],
  );
  const otherCapabilities = useMemo(
    () => (capabilities ? Object.keys(capabilities).filter((k) => !knownKeys.has(k)) : []),
    [capabilities, knownKeys],
  );
  const capSummary = useMemo(() => {
    if (!capabilities) return null;
    const values = Object.values(capabilities);
    return { on: values.filter((v) => v === true).length, total: values.length };
  }, [capabilities]);

  const requiredProviders = ready.data?.providers;
  const visibleRows = showAllRoutes ? rows : rows.slice(0, TOP_ROUTES);
  const anyFetching = health.isFetching || ready.isFetching || perf.isFetching || caps.isFetching;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="System"
        subtitle="Liveness and readiness are polled every 10 seconds from the API origin; provider capabilities come from the API's own environment check."
        actions={
          <IconButton
            label="Refresh now"
            variant="secondary"
            disabled={anyFetching}
            onClick={() => {
              void health.refetch();
              void ready.refetch();
              void perf.refetch();
              void caps.refetch();
            }}
          >
            <Refresh size={18} className={cx(anyFetching && 'animate-spin')} />
          </IconButton>
        }
      />

      {/* Status */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Liveness" subtitle={<span className="admin-code">GET /api/system/health</span>} />
          {health.isLoading ? (
            <Skeleton className="h-7 w-32 rounded-full" />
          ) : (
            <>
              <StatusPill
                ok={liveOk}
                label={
                  liveOk
                    ? 'Healthy'
                    : healthNotExposed
                      ? 'Probe not exposed on this origin'
                      : liveOk === null
                        ? 'Unknown'
                        : 'Unreachable'
                }
              />
              <p className="tabular mt-3 text-xs text-text-2">
                {health.isError
                  ? errMsg(health.error, 'The API did not respond.')
                  : healthNotExposed
                    ? 'The path answered, but not with the API probe. Check the edge routing for /api/system/*.'
                    : health.data?.timestamp
                      ? `Reported at ${format(new Date(health.data.timestamp), 'HH:mm:ss')}`
                      : 'No timestamp reported'}
              </p>
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Readiness" subtitle={<span className="admin-code">GET /api/system/ready</span>} />
          {ready.isLoading ? (
            <Skeleton className="h-7 w-32 rounded-full" />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  ok={readyOk}
                  label={
                    readyOk
                      ? 'Ready'
                      : readyNotExposed
                        ? 'Probe not exposed on this origin'
                        : readyOk === null
                          ? 'Unknown'
                          : 'Not ready'
                  }
                />
                {readyNotExposed ? null : (
                  <StatusPill
                    ok={dbConnected}
                    label={dbConnected ? 'Database connected' : dbConnected === null ? 'Database unknown' : 'Database disconnected'}
                  />
                )}
              </div>
              {requiredProviders && Object.keys(requiredProviders).length > 0 ? (
                <div className="mt-3">
                  <p className="type-label text-text-2">Required providers</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {Object.entries(requiredProviders).map(([name, state]) => (
                      <Badge key={name} tone={state ? 'success' : 'danger'} dot>
                        {humanize(name)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-text-2">No providers are marked required for readiness.</p>
              )}
              {ready.isError && !ready.data ? (
                <p className="mt-3 text-xs text-danger">{errMsg(ready.error, 'Readiness probe failed.')}</p>
              ) : null}
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Process uptime" subtitle="Since the last restart" />
          {health.isLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : (
            <>
              <p className="type-stat text-2xl text-text-1">{humanizeUptime(health.data?.uptime)}</p>
              <p className="tabular mt-1 text-xs text-text-2">
                {typeof health.data?.uptime === 'number'
                  ? `${Math.round(health.data.uptime).toLocaleString()} seconds`
                  : 'Uptime not reported'}
              </p>
            </>
          )}
        </Card>
      </div>

      {/* Provider capabilities */}
      <Card>
        <CardHeader
          title="Provider capabilities"
          subtitle={<span className="admin-code">GET /api/capabilities</span>}
          action={
            capSummary ? (
              <Badge tone={capSummary.on === capSummary.total ? 'success' : 'neutral'}>
                <span className="tabular">{capSummary.on} of {capSummary.total}</span> configured
              </Badge>
            ) : null
          }
        />
        {caps.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : caps.isError ? (
          <ErrorState
            error={caps.error}
            retry={() => void caps.refetch()}
            title="Could not read capabilities"
            className="py-6"
          />
        ) : !capabilities || Object.keys(capabilities).length === 0 ? (
          <EmptyState
            variant="no-results"
            icon={<Zap size={24} />}
            title="No capability report"
            message="This API build does not expose provider capabilities."
            size="sm"
          />
        ) : (
          <div className="space-y-5">
            {CAPABILITY_GROUPS.map((group) => {
              const items = group.items.filter((i) => i.key in capabilities);
              if (items.length === 0) return null;
              return (
                <section key={group.title} aria-label={group.title}>
                  <h4 className="type-label mb-2 text-text-2">{group.title}</h4>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((item) => {
                      const on = capabilities[item.key] === true;
                      return (
                        <li key={item.key} className="admin-cap" data-on={on ? 'true' : 'false'}>
                          <span className="admin-cap-dot" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-text-1">
                              {item.label}
                              <span className="sr-only">: {on ? 'configured' : 'not configured'}</span>
                            </p>
                            <p className="truncate text-xs text-text-2" title={item.description}>{item.description}</p>
                          </div>
                          <span className={cx('shrink-0 text-xs font-semibold', on ? 'text-brand-text' : 'text-text-3')} aria-hidden="true">
                            {on ? 'On' : 'Off'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {otherCapabilities.length > 0 ? (
              <section aria-label="Other">
                <h4 className="type-label mb-2 text-text-2">Other</h4>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {otherCapabilities.map((key) => {
                    const on = capabilities[key] === true;
                    return (
                      <li key={key} className="admin-cap" data-on={on ? 'true' : 'false'}>
                        <span className="admin-cap-dot" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-text-1">{humanize(key)}</p>
                          <p className="admin-code truncate text-text-3">{key}</p>
                        </div>
                        <span className={cx('shrink-0 text-xs font-semibold', on ? 'text-brand-text' : 'text-text-3')}>
                          {on ? 'On' : 'Off'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </Card>

      {/* Aggregate request stats */}
      <Card>
        <CardHeader title="Request throughput" subtitle="Aggregated from the in-process performance cache" />
        {perf.isLoading ? (
          <StatGrid>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonTile key={i} />)}
          </StatGrid>
        ) : perf.isError ? (
          <ErrorState
            error={perf.error}
            retry={() => void perf.refetch()}
            title="Could not load performance stats"
            className="py-6"
          />
        ) : !totals ? (
          <EmptyState
            variant="no-results"
            icon={<BarChart size={24} />}
            title="No samples recorded"
            message="The performance cache is empty. It fills as requests are served after a restart."
            size="sm"
          />
        ) : (
          <StatGrid>
            <StatTile label="Requests sampled" value={totals.requests.toLocaleString()} />
            <StatTile label="Average latency" value={ms(totals.avg)} hint="Across all tracked routes" />
            <StatTile label="Worst case" value={ms(totals.slowestMax)} hint={totals.slowestKey} tone={totals.slowestMax > 1000 ? 'accent' : 'neutral'} />
            <StatTile label="Tracked routes" value={String(totals.endpoints)} />
          </StatGrid>
        )}
      </Card>

      {/* Per-route table */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-md font-semibold text-text-1">Latency by route</h3>
            <p className="mt-0.5 text-xs text-text-2">
              One row per route template, sorted by request volume. Refreshes every 30 seconds.
            </p>
          </div>
          {rows.length > TOP_ROUTES ? (
            <Button size="sm" variant="ghost" onClick={() => setShowAllRoutes((v) => !v)} aria-expanded={showAllRoutes}>
              {showAllRoutes ? `Show top ${TOP_ROUTES}` : `Show all ${plural(rows.length, 'route')}`}
            </Button>
          ) : null}
        </div>

        {perf.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            icon={<Server size={24} />}
            title="No route samples"
            message="Performance data appears once the API has served instrumented requests."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="admin-table min-w-[640px]">
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col" className="num">Requests</th>
                  <th scope="col" className="num">Average</th>
                  <th scope="col" className="num">Min</th>
                  <th scope="col" className="num">Max</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody className={cx(perf.isFetching && 'admin-fetching')}>
                {visibleRows.map((r) => (
                  <tr key={r.key}>
                    <td className="text-text-1">
                      <span className="admin-code block max-w-[28rem] truncate" title={r.key}>{r.key}</span>
                    </td>
                    <td className="num">{r.count.toLocaleString()}</td>
                    <td className="num"><Latency value={r.avgTime} /></td>
                    <td className="num text-text-2">{ms(r.minTime)}</td>
                    <td className="num text-text-2">{ms(r.maxTime)}</td>
                    <td className="num text-text-2">{ms(r.totalTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-center text-xs text-text-2">
        API origin <span className="admin-code">{ORIGIN_BASE || window.location.origin}</span>
      </p>
    </div>
  );
}
