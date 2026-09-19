import type { ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Progress,
  Skeleton,
  StatTile,
  cx,
  fmtStamp,
  humanize,
  isoStamp,
  plural,
} from '../../components/ui';
import { Bell, FileText, Monitor, Shield } from '../../components/icons';
import {
  JOB_STATE_LABELS,
  adoptionRows,
  formatShare,
  jobCounts,
  pushSummary,
  queueTone,
  shortSha,
  type ClientAdoption,
  type NotificationHealth,
} from '../../lib/adminOps';
import { appealState, guidelineByCode, type ReportAppeal, type ReportStatement } from '../../lib/adminReports';

/**
 * Prop-driven pieces for the staff console. None of them reads a query,
 * a store or the router, so tests/admin-cards.render.test.mjs can mount
 * them through react-dom/server with no providers, and the pages that use
 * them (AdminSystem, AdminDashboard, AdminReports) stay readable.
 */

/* ----------------------------------------------------------- timestamps */

/**
 * A timestamp with its zone and the ISO form as a tooltip (see lib/format).
 * AdminLayout's `Stamp` delegates here; this file cannot import AdminLayout,
 * which pulls in the console stylesheet that Node cannot load.
 */
export function TimeStamp({
  iso,
  seconds = false,
  dateOnly = false,
  className,
}: {
  iso?: string | number | Date | null;
  seconds?: boolean;
  dateOnly?: boolean;
  className?: string;
}) {
  const value = isoStamp(iso);
  if (!value) return <span className={cx('tabular', className)}>—</span>;
  return (
    <time className={cx('tabular', className)} dateTime={value} title={value}>
      {fmtStamp(iso, { seconds, dateOnly })}
    </time>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-label text-text-2">{label}</dt>
      <dd className="mt-0.5 text-sm text-text-1">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------ API build */

export type ApiVersion = { sha?: string; builtAt?: string; node?: string };

/** GET /api/version: { sha, builtAt, node }; sha and builtAt are '' when the deploy did not stamp them. */
export function ApiBuildCard({
  version,
  loading = false,
  error,
}: {
  version?: ApiVersion | null;
  loading?: boolean;
  error?: string | null;
}) {
  const sha = typeof version?.sha === 'string' ? version.sha.trim() : '';
  const builtAt = typeof version?.builtAt === 'string' ? version.builtAt.trim() : '';
  const node = typeof version?.node === 'string' ? version.node.trim() : '';
  return (
    <Card>
      <CardHeader title="API build" subtitle={<span className="admin-code">GET /api/version</span>} />
      {loading ? (
        <Skeleton className="h-9 w-40" />
      ) : error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : (
        <>
          <p className="type-stat text-2xl text-text-1">
            <span className="admin-code" title={sha || undefined}>{shortSha(sha)}</span>
          </p>
          <p className="tabular mt-1 text-xs text-text-2">
            {builtAt ? (
              isoStamp(builtAt) ? <>Built <TimeStamp iso={builtAt} /></> : <>Built <span className="admin-code">{builtAt}</span></>
            ) : (
              'Build time not set'
            )}
          </p>
          <p className="tabular mt-0.5 text-xs text-text-2">{node ? `Node ${node}` : 'Node version not reported'}</p>
          {!sha ? <p className="mt-2 text-xs text-text-3">The deploy did not stamp a commit (GIT_SHA).</p> : null}
        </>
      )}
    </Card>
  );
}

/* -------------------------------------------------- notification jobs */

const PUSH_ROWS_SHOWN = 10;

const PUSH_OUTCOME_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  delivered: 'success',
  retryable: 'warning',
  deferred: 'warning',
  failed: 'danger',
  invalid_token: 'danger',
  no_token: 'neutral',
  suppressed: 'neutral',
  capped: 'neutral',
};

/**
 * GET /api/admin/notifications/health. Every field in the payload is
 * rendered; none of it is a payload or a routing id.
 */
export function NotificationJobsCard({
  health,
  loading = false,
  error,
  forbidden = false,
  showAllPush = false,
  onTogglePush,
  onRetry,
  now = Date.now(),
}: {
  health?: NotificationHealth | null;
  loading?: boolean;
  error?: string | null;
  /** A 403: the token is a member's, not staff. */
  forbidden?: boolean;
  showAllPush?: boolean;
  onTogglePush?: () => void;
  onRetry?: () => void;
  now?: number;
}) {
  const counts = jobCounts(health);
  const total = counts.reduce((n, r) => n + r.count, 0);
  const dead = counts.find((r) => r.state === 'dead')?.count ?? 0;
  const tone = queueTone(health, now);
  const deadByCode = Array.isArray(health?.deadByErrorCode) ? health.deadByErrorCode : [];
  const kinds = Array.isArray(health?.kinds) ? health.kinds.filter((k) => typeof k === 'string') : [];
  const push = Array.isArray(health?.push) ? health.push : [];
  const pushRows = showAllPush ? push : push.slice(0, PUSH_ROWS_SHOWN);
  const pushTotals = pushSummary(health);

  const headerBadge =
    loading || error || forbidden || !health
      ? null
      : dead > 0 ? (
        <Badge tone="danger" dot>{plural(dead, 'dead job')}</Badge>
      ) : tone === 'warning' ? (
        <Badge tone="warning" dot>Backlog</Badge>
      ) : (
        <Badge tone="success" dot>Healthy</Badge>
      );

  return (
    <Card>
      <CardHeader
        title="Notification jobs"
        subtitle={<span className="admin-code">GET /api/admin/notifications/health</span>}
        action={headerBadge}
      />
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : forbidden ? (
        <ErrorState
          title="Staff access required"
          message="Only administrator accounts can read the job queue."
          className="py-6"
        />
      ) : error ? (
        <ErrorState title="Could not read notification health" message={error} retry={onRetry} className="py-6" />
      ) : (
        <div className="space-y-5">
          {total === 0 ? (
            <EmptyState
              variant="no-results"
              icon={<Bell size={24} />}
              title="No jobs recorded"
              message="The queue is empty. Jobs appear as members trigger notifications."
              size="sm"
            />
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" role="list" aria-label="Jobs by state">
            {counts.map((row) => (
              <div key={row.state} role="listitem">
                <StatTile
                  label={JOB_STATE_LABELS[row.state]}
                  value={row.count.toLocaleString()}
                  tone={row.state === 'dead' && row.count > 0 ? 'accent' : 'neutral'}
                />
              </div>
            ))}
          </div>

          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label="Oldest queued"><TimeStamp iso={health?.oldestPendingAt ?? null} /></Fact>
            <Fact label="Last completed"><TimeStamp iso={health?.lastCompletedAt ?? null} /></Fact>
            <Fact label="Last worker activity"><TimeStamp iso={health?.lastWorkerActivityAt ?? null} /></Fact>
          </dl>

          <section aria-label="Dead jobs by error code">
            <h4 className="type-label mb-1.5 text-text-2">Dead by error code</h4>
            {deadByCode.length === 0 ? (
              <p className="text-xs text-text-3">No dead jobs.</p>
            ) : (
              <ul className="divide-y divide-line">
                {deadByCode.map((row) => (
                  <li key={row.code} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                    <span className="admin-code">{row.code}</span>
                    <Badge tone="danger" size="sm">{plural(Number(row.count) || 0, 'job')}</Badge>
                    <span className="ml-auto text-xs text-text-2">
                      Last failed <TimeStamp iso={row.lastFailedAt ?? null} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Job kinds">
            <h4 className="type-label mb-1.5 text-text-2">Kinds</h4>
            {kinds.length === 0 ? (
              <p className="text-xs text-text-3">No handlers registered.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {kinds.map((kind) => (
                  <Badge key={kind} tone="neutral"><span className="admin-code">{kind}</span></Badge>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Push deliveries since the API started">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <h4 className="type-label text-text-2">Push since restart</h4>
              {push.length > 0 ? (
                <p className="tabular text-xs text-text-2">
                  {pushTotals.delivered.toLocaleString()} delivered · {pushTotals.failed.toLocaleString()} failed · {pushTotals.other.toLocaleString()} other
                </p>
              ) : null}
            </div>
            {push.length === 0 ? (
              <p className="text-xs text-text-3">No pushes since the API started.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="admin-table min-w-[480px]">
                    <thead>
                      <tr>
                        <th scope="col">Type</th>
                        <th scope="col">Outcome</th>
                        <th scope="col">Code</th>
                        <th scope="col" className="num">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pushRows.map((row, i) => (
                        <tr key={`${row.type}:${row.outcome}:${row.code}:${i}`}>
                          <td><span className="admin-code">{row.type}</span></td>
                          <td>
                            <Badge tone={PUSH_OUTCOME_TONE[row.outcome] ?? 'neutral'} size="sm">{humanize(row.outcome)}</Badge>
                          </td>
                          <td><span className="admin-code">{row.code}</span></td>
                          <td className="num">{(Number(row.count) || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {push.length > PUSH_ROWS_SHOWN && onTogglePush ? (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={onTogglePush} aria-expanded={showAllPush}>
                    {showAllPush ? `Show top ${PUSH_ROWS_SHOWN}` : `Show all ${plural(push.length, 'row')}`}
                  </Button>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------- client adoption */

const PLATFORM_LABELS: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web' };
const platformLabel = (name: string) => (Object.hasOwn(PLATFORM_LABELS, name) ? PLATFORM_LABELS[name] : name);

/** GET /api/admin/analytics .clientAdoption, one row per platform release. */
export function ClientAdoptionTable({ adoption }: { adoption?: ClientAdoption | null }) {
  const rows = adoptionRows(adoption);
  if (rows.length === 0) {
    return (
      <EmptyState
        variant="no-results"
        icon={<Monitor size={24} />}
        title="No client reports yet"
        message="Releases appear here once apps send the X-Vybe-Client header. The web app does not send it yet."
        size="sm"
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="admin-table min-w-[520px]">
        <thead>
          <tr>
            <th scope="col">Platform</th>
            <th scope="col">Release</th>
            <th scope="col" className="num">Users</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.platform}:${r.release}`}>
              <td className="text-text-1">
                {r.first ? (
                  <>
                    <span className="font-semibold">{platformLabel(r.platform)}</span>
                    <span className="tabular ml-2 text-xs text-text-2">{plural(r.platformUsers, 'user')}</span>
                  </>
                ) : (
                  <span className="sr-only">{platformLabel(r.platform)}</span>
                )}
              </td>
              <td><span className="admin-code">{r.release}</span></td>
              <td className="num">{r.users.toLocaleString()}</td>
              <td>
                <div className="flex items-center gap-2">
                  <Progress value={r.share} size="sm" className="w-24" label={`${formatShare(r.share)} of ${platformLabel(r.platform)} users on ${r.release}`} />
                  <span className="tabular text-xs text-text-1">{formatShare(r.share)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------- statements */

const STATEMENT_ACTION_LABELS: Record<string, string> = {
  remove_content: 'Content removed',
  suspend_user: 'Account suspended',
  mark_sensitive: 'Marked sensitive',
  no_action: 'No action',
};

/** The statement of reasons written on remove_content / suspend_user / mark_sensitive / dismiss. */
export function StatementBlock({ statement }: { statement?: ReportStatement | null }) {
  if (!statement || typeof statement !== 'object') return null;
  const action = typeof statement.action === 'string' ? statement.action : '';
  const code = typeof statement.ruleCode === 'string' ? statement.ruleCode : '';
  const title = typeof statement.ruleTitle === 'string' && statement.ruleTitle ? statement.ruleTitle : guidelineByCode(code)?.title ?? '';
  const rule = code ? `${code}${title ? ` · ${title}` : ''}` : '';
  return (
    <div className="rounded-sm border border-line bg-surface-2 px-3 py-2">
      <p className="type-label flex items-center gap-1.5 text-text-2">
        <FileText size={14} /> Statement of reasons
      </p>
      <p className="mt-1 text-xs text-text-1">
        {action ? STATEMENT_ACTION_LABELS[action] ?? humanize(action) : 'Action not recorded'}
        {rule ? <> · <span className="admin-code">{rule}</span></> : null}
      </p>
      {statement.note ? <p className="mt-1 text-xs text-text-2 italic">“{statement.note}”</p> : null}
      <p className="mt-1 text-xs text-text-2">
        Issued <TimeStamp iso={statement.issuedAt ?? null} />
        {statement.detectedBy ? ` · detected by ${humanize(statement.detectedBy).toLowerCase()}` : ''}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- appeals */

const APPEAL_TONE: Record<string, 'warning' | 'neutral' | 'success'> = {
  open: 'warning',
  upheld: 'neutral',
  reversed: 'success',
};

/**
 * The member's appeal and its decision, or the appeal window when no appeal
 * exists yet. `targetType` only changes "Content restored" to "Account
 * restored" for account suspensions.
 */
export function AppealBlock({
  appeal,
  appealUntil,
  targetType,
  action,
  now = Date.now(),
}: {
  appeal?: ReportAppeal | null;
  appealUntil?: string | null;
  targetType?: string;
  /** statement.action; decides whether a reversal restored an account, a screen or content. */
  action?: string;
  now?: number;
}) {
  const state = appealState({ appeal: appeal ?? null, appealUntil: appealUntil ?? null }, now);
  if (state === 'none') return null;
  if (!appeal || typeof appeal !== 'object' || state === 'window_open' || state === 'window_closed') {
    return (
      <p className="text-xs text-text-2">
        {state === 'window_open' ? (
          <>Appeal window closes <TimeStamp iso={appealUntil ?? null} dateOnly /></>
        ) : (
          'Appeal window closed'
        )}
      </p>
    );
  }
  const status = typeof appeal.status === 'string' ? appeal.status : 'open';
  const decidedBy = appeal.decidedBy && typeof appeal.decidedBy === 'object' ? appeal.decidedBy : null;
  const decidedName = decidedBy?.fullName || decidedBy?.email || (appeal.decidedAt ? 'an administrator' : '');
  return (
    <div className="rounded-sm border border-warning/30 bg-surface-2 px-3 py-2" data-appeal={status}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="type-label flex items-center gap-1.5 text-text-2">
          <Shield size={14} /> Appeal
        </p>
        <Badge tone={APPEAL_TONE[status] ?? 'neutral'} size="sm">{humanize(status)}</Badge>
        {status === 'reversed' && appeal.restored === true ? (
          <Badge tone="success" size="sm">
            {action === 'suspend_user' || (!action && targetType === 'user')
              ? 'Account restored'
              : action === 'mark_sensitive'
                ? 'Screen cleared'
                : 'Content restored'}
          </Badge>
        ) : status === 'reversed' && appeal.restored === false ? (
          <Badge tone="neutral" size="sm">Could not be restored</Badge>
        ) : null}
      </div>
      {appeal.message ? (
        <blockquote className="mt-1.5 border-l-2 border-line pl-2.5 text-sm leading-relaxed text-text-1">
          {appeal.message}
        </blockquote>
      ) : null}
      <p className="mt-1.5 text-xs text-text-2">
        Opened <TimeStamp iso={appeal.openedAt ?? null} />
        {appeal.decidedAt ? (
          <>
            {' · '}Decided{decidedName ? ` by ${decidedName}` : ''} <TimeStamp iso={appeal.decidedAt} />
          </>
        ) : null}
      </p>
      {appeal.note ? <p className="mt-1 text-xs text-text-2 italic">“{appeal.note}”</p> : null}
    </div>
  );
}
