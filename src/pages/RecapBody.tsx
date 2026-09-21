import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Badge, Button, Callout, Card, Progress, Section, StatGrid, StatTile, cx, fmtStamp, plural } from './ui';
import { Building, Lock, Trophy, Users } from './icons';
import type { WorkoutSummaryUnit } from '../lib/workoutSummary';
import {
  MONDAY_FIRST_WEEKDAYS,
  activeDaysCopy,
  compareDeltas,
  compareLabel,
  dayDescription,
  dayLabel,
  hasDeltas,
  lockedCopy,
  lockedShareMessage,
  lockedTitle,
  mondayFirstIndex,
  monthBars,
  quietCopy,
  recapHeadline,
  recordLine,
  recordTypeLabel,
  weeksKeptCopy,
  yearTiles,
  type RecapDeltas,
  type RecapKind,
  type RecapStat,
  type RecapView,
} from '../lib/recapView';

/** The delta for one stat key, or undefined when the API compared nothing for it. */
function deltaOf(deltas: RecapDeltas, key: RecapStat['key']) {
  const delta = key === 'sessions' ? deltas.sessions : key === 'time' ? deltas.time : key === 'volume' ? deltas.volume : undefined;
  return delta ? { value: delta.value, direction: delta.direction, label: delta.label } : undefined;
}

/**
 * The headline tiles. The comparison with the member's own previous period
 * sits behind "Compare" (the API's DP-010 note on data.previous; the mobile
 * viewer does the same): the tiles only carry their deltas while it is open,
 * so a loss never shows unprompted. Controlled, so the page owns the state
 * and a server render can show either side.
 */
export function RecapHeadline({
  stats,
  deltas,
  kind,
  compareOpen,
  onToggleCompare,
}: {
  stats: RecapStat[];
  deltas: RecapDeltas;
  kind: RecapKind;
  compareOpen: boolean;
  onToggleCompare: () => void;
}) {
  const gridId = useId();
  if (!stats.length) return null;
  const comparable = hasDeltas(deltas);
  const deltaFor = (key: RecapStat['key']) => (compareOpen ? deltaOf(deltas, key) : undefined);
  return (
    <div>
      <div id={gridId}>
        <StatGrid columns={stats.length >= 4 ? 4 : stats.length === 3 ? 3 : 2}>
          {stats.map((stat) => (
            <StatTile key={stat.key} label={stat.label} value={stat.value} delta={deltaFor(stat.key)} />
          ))}
        </StatGrid>
      </div>
      {comparable ? (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" aria-expanded={compareOpen} aria-controls={gridId} onClick={onToggleCompare} data-testid="recap-compare-toggle">
            {compareLabel(kind, compareOpen)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A Year in Vybe's twelve months: one column per month, every month present
 * and zeros included, scaled against the busiest one. No y-axis, because the
 * API sends no scale — each column says its own numbers aloud instead. A
 * plain grid of divs; no chart library reaches this page.
 */
export function RecapYearMonths({ recap }: { recap: Pick<RecapView, 'data'> }) {
  const bars = monthBars(recap.data.byMonth);
  if (!bars.length) return null;
  return (
    <Card data-testid="recap-year-months">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="t-section text-text-1">Months</h2>
        <span className="t-meta">{activeDaysCopy(recap.data.activeDays, recap.data.activeDayCount)}</span>
      </div>
      <ol aria-label="Sessions by month" className="grid grid-cols-12 items-end gap-1">
        {bars.map((bar) => (
          <li key={bar.month} className="flex min-w-0 flex-col items-center gap-1">
            <span className="sr-only">{bar.description}</span>
            <span aria-hidden="true" className="flex h-20 w-full items-end">
              <span
                data-testid="recap-year-bar"
                data-sessions={bar.sessions}
                className={cx('w-full rounded-[3px]', bar.sessions > 0 ? 'bg-text-1' : 'bg-surface-3')}
                style={{ height: bar.sessions > 0 ? `${Math.max(8, Math.round(bar.ratio * 100))}%` : '2px' }}
              />
            </span>
            <span aria-hidden="true" className="t-meta w-full truncate text-center text-2xs">
              {bar.label}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The year's four totals, each box keeping its geometry with the next action in the number's place. */
export function RecapYearTotals({ recap, unit }: { recap: Pick<RecapView, 'data'>; unit: WorkoutSummaryUnit }) {
  const tiles = yearTiles(recap.data, unit);
  return (
    <section aria-label="The year in numbers" data-testid="recap-year-totals">
      <StatGrid columns={2}>
        {tiles.map((tile) => (
          <StatTile key={tile.key} label={tile.label} value={tile.value} size="hero" fallback={tile.fallback} />
        ))}
      </StatGrid>
    </section>
  );
}

/**
 * The body of one recap, exactly as the API describes it: headline numbers
 * (compared to the member's own previous period only behind "Compare"), the
 * days, the records, the most trained exercises, weeks kept, and the gyms and
 * buddies blocks only when the API sent a non-empty list. Pure apart from the
 * Compare toggle: the unit is a prop (the page reads the units store), no
 * queries and no router hooks, so react-dom/server can render it under
 * node:test.
 */
export function RecapBody({ recap, unit }: { recap: RecapView; unit: WorkoutSummaryUnit }) {
  const { data, kind } = recap;
  const stats = recapHeadline(data, unit);
  const deltas = compareDeltas(data, unit, kind);
  const [compareOpen, setCompareOpen] = useState(false);
  const gyms = Array.isArray(data.gyms) && data.gyms.length ? data.gyms : null;
  const buddies = Array.isArray(data.buddies) && data.buddies.length ? data.buddies : null;
  const firstOffset = kind === 'month' && data.byDay.length ? mondayFirstIndex(data.byDay[0].date) : 0;
  const comparable = hasDeltas(deltas);

  return (
    <div className="space-y-6" data-testid="recap-body" data-status={recap.status}>
      {recap.status === 'locked' ? (
        <Callout tone="info" icon={<Lock size={20} className="text-info" />} title={lockedTitle(kind)}>
          <p>{lockedCopy(data.progress, kind)}</p>
          <p className="mt-1">{lockedShareMessage(kind)}</p>
          {data.progress ? (
            <Progress
              className="mt-3"
              value={Math.min(data.progress.sessions, data.progress.needed)}
              max={data.progress.needed}
              label={kind === 'year' ? 'Sessions toward unlocking this year' : 'Sessions toward unlocking this month'}
            />
          ) : null}
        </Callout>
      ) : null}

      {recap.status === 'quiet' ? <p className="text-sm text-text-2">{quietCopy(kind)}</p> : null}

      {kind === 'year' ? (
        <>
          <RecapYearTotals recap={recap} unit={unit} />
          {comparable ? (
            <div className="-mt-4 flex justify-end">
              <Button variant="ghost" size="sm" aria-expanded={compareOpen} onClick={() => setCompareOpen((open) => !open)} data-testid="recap-compare-toggle">
                {compareLabel(kind, compareOpen)}
              </Button>
            </div>
          ) : null}
          {compareOpen ? (
            <StatGrid columns={stats.length >= 4 ? 4 : stats.length === 3 ? 3 : 2}>
              {stats.map((stat) => (
                <StatTile
                  key={stat.key}
                  label={stat.label}
                  value={stat.value}
                  delta={deltaOf(deltas, stat.key)}
                />
              ))}
            </StatGrid>
          ) : null}
          <RecapYearMonths recap={recap} />
        </>
      ) : (
        <RecapHeadline stats={stats} deltas={deltas} kind={kind} compareOpen={compareOpen} onToggleCompare={() => setCompareOpen((open) => !open)} />
      )}

      {data.byDay.length ? (
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-md font-semibold text-text-1">Days</h2>
            <span className="text-xs text-text-2">{activeDaysCopy(data.activeDays)}</span>
          </div>
          {kind === 'month' ? (
            <div aria-hidden="true" className="mb-1.5 grid grid-cols-7 gap-1.5" data-testid="recap-weekday-header">
              {MONDAY_FIRST_WEEKDAYS.map((weekday) => (
                <span key={weekday} className="text-center text-2xs text-text-3">
                  {weekday}
                </span>
              ))}
            </div>
          ) : null}
          <ol aria-label="Sessions by day" className="grid grid-cols-7 gap-1.5">
            {data.byDay.map((day, index) => {
              const active = day.sessions > 0;
              const description = dayDescription(day);
              return (
                <li
                  key={day.date}
                  title={description}
                  style={index === 0 && firstOffset ? { gridColumnStart: firstOffset + 1 } : undefined}
                  className={cx(
                    'flex min-h-11 flex-col items-center justify-center rounded-sm border text-xs tabular-nums',
                    active ? 'border-brand/30 bg-brand-soft text-brand-text' : 'border-line bg-surface-2 text-text-3',
                  )}
                >
                  {/* The cell's text for assistive tech; aria-label on a static <li> is not reliably read. */}
                  <span className="sr-only">{description}</span>
                  <span aria-hidden="true">{dayLabel(day.date, kind)}</span>
                  <span aria-hidden="true" className={cx('mt-0.5 text-2xs font-semibold', !active && 'invisible')}>
                    {day.sessions > 1 ? `×${day.sessions}` : '•'}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

      {data.prs.length ? (
        <Section title="Records" description={kind === 'year' ? 'Bests you set this year.' : kind === 'month' ? 'Bests you set this month.' : 'Bests you set this week.'}>
          <Card padded={false}>
            <ol aria-label="Records" className="divide-y divide-line">
              {data.prs.map((record, index) => (
                <li key={`${record.exerciseId ?? record.name}-${record.type}-${index}`} className="flex items-center gap-3 px-4 py-3">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning-text" aria-hidden="true">
                    <Trophy size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-1">{record.name}</p>
                    <p className="text-xs text-text-2">{recordTypeLabel(record.type)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-text-1">{recordLine(record, unit)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </Section>
      ) : null}

      {data.topExercises.length ? (
        <Section title="Most trained">
          <Card padded={false}>
            <ol aria-label="Most trained" className="divide-y divide-line">
              {data.topExercises.map((exercise, index) => (
                <li key={`${exercise.exerciseId ?? exercise.name}-${index}`} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-5 shrink-0 text-xs tabular-nums text-text-3" aria-hidden="true">{index + 1}</span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">{exercise.name}</p>
                  <span className="shrink-0 text-xs tabular-nums text-text-2">{`${plural(exercise.sessions, 'session')} · ${plural(exercise.sets, 'set')}`}</span>
                </li>
              ))}
            </ol>
          </Card>
        </Section>
      ) : null}

      {data.weeksKept ? (
        <Card className="flex items-center gap-3">
          <Badge tone="brand">Rhythm</Badge>
          <p className="text-sm text-text-1">{weeksKeptCopy(data.weeksKept)}</p>
        </Card>
      ) : null}

      {gyms ? (
        <Section title="Gyms">
          <Card padded={false}>
            <ul aria-label="Gyms" className="divide-y divide-line">
              {gyms.map((gym) => (
                <li key={gym.communityId} className="flex items-center gap-3 px-4 py-3">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-2" aria-hidden="true">
                    <Building size={16} />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">{gym.name}</p>
                  <span className="shrink-0 text-xs tabular-nums text-text-2">{plural(gym.visits, 'visit')}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      {buddies ? (
        <Section title="Buddies" description="People you trained alongside.">
          <Card padded={false}>
            <ul aria-label="Buddies" className="divide-y divide-line">
              {buddies.map((buddy) => {
                const name = buddy.fullName?.trim() || buddy.username || 'Vybe member';
                return (
                  <li key={buddy.userId} className="flex items-center gap-3 px-4 py-3">
                    <Avatar src={buddy.avatar} name={name} size="sm" />
                    <Link to={`/u/${buddy.userId}`} viewTransition className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1 hover:underline">
                      {name}
                    </Link>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-text-2">
                      <Users size={14} aria-hidden="true" />
                      {`${plural(buddy.sessions, 'session')} together`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </Section>
      ) : null}

      <p className="text-xs text-text-3">
        {`Generated ${fmtStamp(recap.generatedAt)}${recap.shares.length ? ` · Shared ${plural(recap.shares.length, 'time')}` : ''}`}
      </p>
    </div>
  );
}

export default RecapBody;
