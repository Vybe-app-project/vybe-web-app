import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { useInfiniteScroll } from '../lib/hooks';
import { localDayParams } from '../lib/timezone';
import { browserTimeZone } from '../lib/timezoneSync';
import { useUnits, weightUnit } from '../lib/units';
import type { WorkoutSummaryUnit } from '../lib/workoutSummary';
import { Badge, Button, Callout, Card, EmptyState, ErrorState, PageHeader, Progress, Section, SkeletonCard, SkeletonRow, Spinner, cx } from './ui';
import { ChevronRight, Lock } from './icons';
import {
  dedupeHistory,
  historyRowLabel,
  lockedCopy,
  quietCopy,
  recapHeadline,
  recapTitle,
  runningBadge,
  summaryLine,
  type RecapKind,
  type RecapListRow,
  type RecapView,
} from '../lib/recapView';

/**
 * The member's recaps: the current week and month first (GET /recaps/current,
 * one card per kind; hidden when the API answers `recap: null`), then the
 * closed periods newest first (GET /recaps, paginated). The last closed week
 * is both a current card and the first history row from Monday to Sunday
 * evening, so history is deduped against the cards.
 */

type ListPage = { recaps: RecapListRow[]; total: number; page: number; hasNextPage: boolean };

/** Both zone hints: the API prefers the account's zone, then the IANA hint, then the offset. */
const currentParams = (kind: RecapKind) => {
  const timezone = browserTimeZone();
  return { kind, ...(timezone ? { timezone } : {}), ...localDayParams() };
};

function useCurrentRecap(kind: RecapKind) {
  return useQuery({
    queryKey: ['recaps', 'current', kind],
    queryFn: async () => {
      const { data } = await api.get('/recaps/current', { params: currentParams(kind) });
      return ((data as { recap?: RecapView | null }).recap ?? null) as RecapView | null;
    },
  });
}

function CurrentCard({ recap, unit }: { recap: RecapView; unit: WorkoutSummaryUnit }) {
  const stats = recapHeadline(recap.data, unit);
  const running = runningBadge(recap);
  const label = `${recapTitle(recap.kind)}: ${recap.periodLabel}`;
  return (
    <Card to={`/recaps/${recap._id}`} linkLabel={label} data-testid="recap-current-card" data-kind={recap.kind} data-status={recap.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-label text-text-2">{recapTitle(recap.kind)}</span>
        {running ? <Badge tone="info" size="sm">{running}</Badge> : null}
        {recap.status === 'locked' ? (
          <Badge tone="neutral" size="sm">
            <Lock size={12} aria-hidden="true" /> Locked
          </Badge>
        ) : null}
        {recap.viewedAt === null && recap.status !== 'locked' ? <Badge tone="brand" size="sm">New</Badge> : null}
        {recap.shares.length ? <Badge tone="neutral" size="sm">Shared</Badge> : null}
      </div>
      <h2 className="mt-1 text-lg font-semibold text-text-1">{recap.periodLabel}</h2>

      {recap.status === 'locked' ? (
        <div className="mt-3">
          <p className="text-sm text-text-2">{lockedCopy(recap.data.progress)}</p>
          {recap.data.progress ? (
            <Progress
              className="mt-2"
              value={Math.min(recap.data.progress.sessions, recap.data.progress.needed)}
              max={recap.data.progress.needed}
              label="Sessions toward unlocking this month"
              size="sm"
            />
          ) : null}
        </div>
      ) : stats.length ? (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {stats.map((stat) => (
            <div key={stat.key} className="min-w-0">
              <dt className="text-2xs uppercase tracking-wide text-text-3">{stat.label}</dt>
              <dd className="type-stat text-xl text-text-1">{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-text-2">{quietCopy(recap.kind)}</p>
      )}
    </Card>
  );
}

function HistoryRow({ row }: { row: RecapListRow }) {
  const quiet = row.status === 'quiet';
  return (
    <li>
      <Link
        to={`/recaps/${row._id}`}
        viewTransition
        className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors dur-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
        aria-label={historyRowLabel(row)}
        data-testid="recap-history-row"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cx('truncate text-sm font-semibold', quiet ? 'text-text-2' : 'text-text-1')}>{row.periodLabel}</p>
            <span className="text-xs text-text-3">{recapTitle(row.kind)}</span>
            {row.viewedAt === null ? <Badge tone="brand" size="sm">New</Badge> : null}
            {row.shared ? <Badge tone="neutral" size="sm">Shared</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-text-2">{summaryLine(row.summary)}</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-text-3" aria-hidden="true" />
      </Link>
    </li>
  );
}

export default function Recaps() {
  const system = useUnits((s) => s.system);
  const unit = weightUnit(system);

  const week = useCurrentRecap('week');
  const month = useCurrentRecap('month');

  const history = useInfiniteQuery({
    queryKey: ['recaps', 'list'],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/recaps', { params: { page: pageParam, limit: 20 } });
      return data as ListPage;
    },
    getNextPageParam: (last, all) => (last.hasNextPage ? all.length + 1 : undefined),
  });

  const sentinelRef = useInfiniteScroll(() => {
    if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
  }, !!history.hasNextPage);

  const cards = [week.data, month.data].filter((r): r is RecapView => !!r);
  const rows = dedupeHistory(
    history.data?.pages.flatMap((page) => page.recaps) ?? [],
    cards.map((r) => r._id),
  );
  const currentLoading = week.isLoading || month.isLoading;
  const currentFailed = week.isError || month.isError;
  const total = history.data?.pages[0]?.total ?? 0;
  const nothingYet = !currentLoading && !history.isLoading && !currentFailed && !history.isError && cards.length === 0 && total === 0;

  const retryCurrent = () => {
    if (week.isError) void week.refetch();
    if (month.isError) void month.refetch();
  };

  return (
    <>
      <PageHeader title="Recaps" subtitle="Your week and your month, in your own numbers." />

      {nothingYet ? (
        <EmptyState
          title="No recaps yet"
          message="Your first weekly recap arrives the Sunday evening after your first logged session."
          action={{ label: 'Log a workout', to: '/workouts?log=1' }}
        />
      ) : (
        <div className="space-y-8">
          <section aria-label="Current recaps" className="space-y-3">
            {currentLoading ? (
              <>
                <SkeletonCard media={false} />
                <SkeletonCard media={false} />
              </>
            ) : null}
            {cards.map((recap) => (
              <CurrentCard key={recap._id} recap={recap} unit={unit} />
            ))}
            {currentFailed ? (
              <Callout
                tone="warning"
                title="Could not load your current recap"
                action={
                  <Button variant="secondary" size="sm" onClick={retryCurrent}>
                    Try again
                  </Button>
                }
              >
                {errMsg(week.error ?? month.error, 'Try again in a moment.')}
              </Callout>
            ) : null}
          </section>

          {history.isError ? (
            <ErrorState error={history.error} retry={() => void history.refetch()} />
          ) : history.isLoading ? (
            <Section title="History">
              <Card padded={false}>
                <SkeletonRow className="px-4" />
                <SkeletonRow className="px-4" />
                <SkeletonRow className="px-4" />
              </Card>
            </Section>
          ) : rows.length || history.hasNextPage ? (
            <Section title="History" description="Closed weeks and months, newest first.">
              <Card padded={false}>
                <ul aria-label="Past recaps" className="divide-y divide-line">
                  {rows.map((row) => (
                    <HistoryRow key={row._id} row={row} />
                  ))}
                </ul>
              </Card>
              {history.hasNextPage ? (
                <div ref={sentinelRef} className="flex justify-center py-2">
                  {history.isFetchingNextPage ? (
                    <Spinner />
                  ) : (
                    <Button variant="ghost" onClick={() => void history.fetchNextPage()}>
                      Show older
                    </Button>
                  )}
                </div>
              ) : null}
            </Section>
          ) : cards.length ? (
            <p className="text-sm text-text-2">Past recaps appear here once a week or month closes.</p>
          ) : null}
        </div>
      )}
    </>
  );
}
