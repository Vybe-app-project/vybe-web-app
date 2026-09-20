import { Link } from 'react-router-dom';
import { Card, CardHeader, cx } from '../ui';
import { MONDAY_FIRST_WEEKDAYS } from '../../lib/recapView';
import { MONTHS_SHORT, PROGRESS_STRINGS, calendarGrid, countLabel, parseDateKey, type ProgressDay, type RampLevel } from '../../lib/progress';

/**
 * "Training days": one cell per local day of the window, Monday-first week
 * columns, intensity on the brand ramp (0 · 1 · 2 · 3+ sessions). The ramp is
 * the brand token at three opacities, so light and dark both read from
 * tokens and nothing here is red or green. A day with sessions links to that
 * day's section of the log (`/workouts/logs#day-<date>`, the ids WorkoutLogs
 * already renders). Pure: the caller decides whether `days` came from the
 * calendar route or `summary.byDay`.
 */

const RAMP: Record<RampLevel, string> = {
  0: 'border border-line bg-surface-2',
  1: 'bg-brand/25',
  2: 'bg-brand/55',
  3: 'bg-brand',
};

const CELL = 'size-3 rounded-[3px]';

/** A month label over the column that holds its first day (or the very first column). */
function monthLabels(columns: ReturnType<typeof calendarGrid>['columns']): Array<string | null> {
  return columns.map((column, index) => {
    const startsMonth = column.find((cell) => cell && parseDateKey(cell.date)?.d === 1);
    if (startsMonth) return MONTHS_SHORT[(parseDateKey(startsMonth.date)?.m ?? 1) - 1];
    if (index !== 0) return null;
    const first = column.find(Boolean);
    const month = first ? parseDateKey(first.date)?.m : undefined;
    if (!month) return null;
    const nextStartsSameMonth = columns[1]?.some((cell) => cell && parseDateKey(cell.date)?.d === 1 && parseDateKey(cell.date)?.m === month);
    return nextStartsSameMonth ? null : MONTHS_SHORT[month - 1];
  });
}

export function TrainingCalendar({
  range,
  days,
  note,
  now,
  className,
}: {
  range: { from: string; to: string };
  days: ReadonlyArray<ProgressDay> | null | undefined;
  /** A line under the legend, e.g. the year fallback. */
  note?: string | null;
  now?: Date;
  className?: string;
}) {
  const grid = calendarGrid(range, days, now);
  const months = grid.columns.length > 4 ? monthLabels(grid.columns) : null;
  return (
    <Card className={className} data-testid="progress-calendar">
      <CardHeader
        title={PROGRESS_STRINGS.calendar}
        subtitle={grid.cells.length ? `${countLabel(grid.activeDays, 'training day')} · ${countLabel(grid.totalSessions, 'session')}` : undefined}
      />
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex gap-1.5">
          <div aria-hidden="true" className="flex flex-col justify-end">
            {months ? <div className="h-4" /> : null}
            <div className="grid grid-rows-7 gap-1 pr-1 text-2xs leading-none text-text-3">
              {MONDAY_FIRST_WEEKDAYS.map((day, index) => (
                <span key={day} className="flex h-3 items-center">
                  {index % 2 === 0 ? day : ''}
                </span>
              ))}
            </div>
          </div>
          <div>
            {months ? (
              <div aria-hidden="true" className="grid h-4 grid-flow-col auto-cols-[0.75rem] gap-1 text-2xs leading-none text-text-3">
                {months.map((label, index) => (
                  <span key={index} className="whitespace-nowrap">
                    {label ?? ''}
                  </span>
                ))}
              </div>
            ) : null}
            <ol aria-label={PROGRESS_STRINGS.calendar} className="grid grid-flow-col grid-rows-7 gap-1">
              {grid.columns.flatMap((column, columnIndex) =>
                column.map((cell, rowIndex) =>
                  cell ? (
                    <li key={cell.date} data-level={cell.level} title={cell.label} className={cx(CELL, RAMP[cell.level])}>
                      {cell.sessions > 0 ? (
                        <Link
                          to={`/workouts/logs#day-${cell.date}`}
                          viewTransition
                          className="block size-full rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                        >
                          <span className="sr-only">{cell.label}</span>
                        </Link>
                      ) : (
                        <span className="sr-only">{cell.label}</span>
                      )}
                    </li>
                  ) : (
                    <li key={`pad-${columnIndex}-${rowIndex}`} aria-hidden="true" className={CELL} />
                  ),
                ),
              )}
            </ol>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-2xs text-text-3">
        <span aria-hidden="true" className="inline-flex gap-1">
          {([0, 1, 2, 3] as RampLevel[]).map((level) => (
            <span key={level} className={cx(CELL, RAMP[level])} />
          ))}
        </span>
        <span>{PROGRESS_STRINGS.calendarLegend}</span>
      </div>
      {note ? <p className="mt-2 text-xs text-text-2">{note}</p> : null}
    </Card>
  );
}
