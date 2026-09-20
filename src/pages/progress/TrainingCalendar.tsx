import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, cx } from '../ui';
import { MONDAY_FIRST_WEEKDAYS } from '../../lib/recapView';
import { MONTHS_SHORT, PROGRESS_STRINGS, calendarGrid, countLabel, parseDateKey, type ProgressDay, type RampLevel } from '../../lib/progress';

/**
 * "Training days": one cell per local day of the window, Monday-first week
 * columns, intensity on the brand ramp (0 · 1 · 2 · 3+ sessions). The ramp is
 * the brand token at three opacities, so light and dark both read from
 * tokens and nothing here is red or green. Colour is never the only cue: a
 * rest day is a hollow surface-2 cell on the hairline, and any trained day
 * carries a brand-text border, so a 1-session day is told apart from a rest
 * day by its outline before its fill (WCAG 1.4.11; the 45% fill alone is
 * about 1.4:1 against an empty cell in light mode). A day with sessions links
 * to that day's section of the log (`/workouts/logs#day-<date>`, the ids
 * WorkoutLogs already renders). Cells sit on a 12 px box at a 16 px pitch
 * under a fine pointer and grow to 20 px at a 26 px pitch under a coarse one,
 * so touch targets clear WCAG 2.5.8's 24 px spacing. The grid scrolls to its
 * newest week on mount and whenever the range changes. Pure otherwise: the
 * caller decides whether `days` came from the calendar route or `summary.byDay`.
 */

const RAMP: Record<RampLevel, string> = {
  0: 'border border-line bg-surface-2',
  1: 'border border-brand-text bg-brand/45',
  2: 'border border-brand-text bg-brand/75',
  3: 'border border-brand-text bg-brand',
};

const CELL = 'size-3 pointer-coarse:size-5 rounded-[3px]';
const GAP = 'gap-1 pointer-coarse:gap-1.5';
const ROW = 'h-3 pointer-coarse:h-5';
const COLS = 'auto-cols-[0.75rem] pointer-coarse:auto-cols-[1.25rem]';

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
  rangeLabel,
  note,
  now,
  className,
}: {
  range: { from: string; to: string };
  days: ReadonlyArray<ProgressDay> | null | undefined;
  /** The window this grid covers, when it differs from the page's label (the Year chip). */
  rangeLabel?: string | null;
  /** A line under the legend, e.g. the year fallback. */
  note?: string | null;
  now?: Date;
  className?: string;
}) {
  const grid = calendarGrid(range, days, now);
  const months = grid.columns.length > 4 ? monthLabels(grid.columns) : null;
  const scroller = useRef<HTMLDivElement>(null);

  // The newest week sits at the right edge; a phone shows about 19 of 53 columns, so start there.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [range.from, range.to, grid.columns.length]);

  const counts = grid.cells.length ? `${countLabel(grid.activeDays, 'training day')} · ${countLabel(grid.totalSessions, 'session')}` : null;
  return (
    <Card className={className} data-testid="progress-calendar">
      <CardHeader title={PROGRESS_STRINGS.calendar} subtitle={counts ? (rangeLabel ? `${rangeLabel} · ${counts}` : counts) : undefined} />
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="inline-flex gap-1.5">
          <div aria-hidden="true" className="flex flex-col justify-end">
            {months ? <div className="h-4" /> : null}
            <div className={cx('grid grid-rows-7 pr-1 text-2xs leading-none text-text-3', GAP)}>
              {MONDAY_FIRST_WEEKDAYS.map((day, index) => (
                <span key={day} className={cx('flex items-center', ROW)}>
                  {index % 2 === 0 ? day : ''}
                </span>
              ))}
            </div>
          </div>
          <div>
            {months ? (
              <div aria-hidden="true" className={cx('grid h-4 grid-flow-col text-2xs leading-none text-text-3', COLS, GAP)}>
                {months.map((label, index) => (
                  <span key={index} className="whitespace-nowrap">
                    {label ?? ''}
                  </span>
                ))}
              </div>
            ) : null}
            <ol aria-label={PROGRESS_STRINGS.calendar} className={cx('grid grid-flow-col grid-rows-7', GAP)}>
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
        <span aria-hidden="true" className={cx('inline-flex', GAP)}>
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
