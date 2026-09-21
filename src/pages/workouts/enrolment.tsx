import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Menu, cx, formatStat, type MenuItem } from '../../components/ui';
import { Check, ChevronDown, Minus } from '../../components/icons';
import { nextUpLine, progressLine, type EnrollmentStatus, type Progress, type ScheduleRow, type ScheduleWeekRows } from '../../lib/programs';
import { ROW_ACTION } from './rows';

/**
 * The programme surface on a plan page, as pure props so the states can be
 * rendered and read without a server (tests/programs.render.test.mjs).
 *
 * The research this follows — Peloton Programs 3.0 after four years of
 * complaints, Garmin Coach, Ladder — lands on one shape: every week is
 * readable before joining, the schedule is a suggestion, and the state is a
 * fraction plus one next-up line. So there is no lock, no reset, no day
 * counted as owed; a day nobody trained is simply not done, and a skip is a
 * word you can take back. The card says where you are and what is next; the
 * week list says what the plan is.
 */

/* ------------------------------------------------------------------- card */

export type EnrolmentCardProps = {
  /** `none` before joining; otherwise the enrolment's status. A `left` row reads as `none`. */
  state: 'none' | EnrollmentStatus;
  progress?: Progress | null;
  /** Whole weeks since the anchor, the week the calendar suggests today. */
  suggestedWeek?: number | null;
  durationWeeks?: number | null;
  /** How many sessions the plan schedules, for the line before joining. */
  sessionCount?: number;
  /** The pointer: the first slot neither done nor skipped. */
  next?: ScheduleRow | null;
  /** The live runner, carrying the pointer's slot. */
  nextTo?: string | null;
  onStart?: () => void;
  starting?: boolean;
  /** Pause / Resume · Shift schedule · Mark complete · Leave. */
  menu?: MenuItem[];
};

const JOIN_COPY = 'The schedule is a suggestion. Sessions count in any order, and a day you skip stays yours to come back to.';

/** "Week 2 of 4 · 5 of 12 done", with the status in front of it when it is not simply running. */
export function enrolmentLine(props: Pick<EnrolmentCardProps, 'state' | 'progress' | 'suggestedWeek' | 'durationWeeks'>): string {
  const line = progressLine(props.progress, props.suggestedWeek, props.durationWeeks);
  if (props.state === 'completed') {
    const done = props.progress?.done ?? 0;
    const total = props.progress?.total ?? 0;
    return total > 0 ? `Plan complete · ${done} of ${total} done` : 'Plan complete';
  }
  if (props.state === 'paused') return line ? `Paused · ${line}` : 'Paused';
  return line;
}

/**
 * One card under the plan's title. Not enrolled: a sentence and the page's
 * one filled blue. Enrolled: the fraction, the one next-up row with a blue
 * text Start, and a quiet overflow for everything that changes the enrolment.
 */
export function EnrolmentCard(props: EnrolmentCardProps) {
  const { state, next, nextTo, onStart, starting, menu } = props;

  if (state === 'none' || state === 'left') {
    const count = props.sessionCount ?? 0;
    const weeks = props.durationWeeks ?? 0;
    const shape = [
      count > 0 ? `${formatStat(count)} ${count === 1 ? 'session' : 'sessions'}` : null,
      weeks > 0 ? `${formatStat(weeks)} ${weeks === 1 ? 'week' : 'weeks'}` : null,
    ]
      .filter(Boolean)
      .join(' over ');
    return (
      <Card className="space-y-3">
        {shape ? <p className="t-body text-text-1">{shape}.</p> : null}
        <p className="t-meta">{JOIN_COPY}</p>
        <Button variant="primary" block loading={starting} onClick={onStart}>
          Start this plan
        </Button>
      </Card>
    );
  }

  const line = enrolmentLine(props);
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="t-section min-w-0 text-text-1">{line}</p>
        {menu?.length ? <Menu items={menu} label="Plan options" /> : null}
      </div>
      {next ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-3">
          <p className="t-body min-w-0 truncate text-text-1">Next: {nextUpLine(next)}</p>
          {nextTo ? (
            <Link to={nextTo} viewTransition aria-label={`Start ${next.title || 'the next session'}`} className={ROW_ACTION}>
              Start
            </Link>
          ) : null}
        </div>
      ) : state === 'completed' ? null : (
        <p className="t-meta border-t border-line pt-3">Every session is marked. Mark the plan complete when you are ready.</p>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- week list */

/** ✓ for a session that happened, a dash for one taken out, nothing for the rest. */
function StateGlyph({ row }: { row: ScheduleRow }) {
  if (row.state === 'done') return <Check size={16} className="shrink-0 text-success" aria-hidden="true" />;
  if (row.state === 'skipped') return <Minus size={16} className="shrink-0 text-text-3" aria-hidden="true" />;
  return <span aria-hidden="true" className="h-4 w-4 shrink-0" />;
}

/** "Mon · Foundation Full Body · 28 min" — the whole row, in one line of text. */
export function slotLine(dayLabel: string, row: Pick<ScheduleRow, 'title' | 'estimatedMin'>): string {
  return [dayLabel, row.title || 'Session', row.estimatedMin ? `${formatStat(row.estimatedMin)} min` : null].filter(Boolean).join(' · ');
}

export type WeekListProps = {
  weeks: readonly ScheduleWeekRows[];
  /** Open weeks; everything else is collapsed. The current week opens on arrival. */
  open: ReadonlySet<number>;
  onToggle: (week: number) => void;
  /** The detail sheet for a slot's workout. */
  workoutTo: (workoutId: string) => string;
  /** Router state, so a slot opens as a sheet over the plan on desktop. */
  linkState?: unknown;
  /** Mark done · Skip / Un-skip · Open workout. Absent while the member is not on the plan. */
  menuFor?: (row: ScheduleRow) => MenuItem[];
  /** The owner's control at the end of a row (removing the session from the week). */
  ownerAction?: (row: ScheduleRow) => ReactNode;
};

/** "3 of 4 done" while enrolled, "4 sessions" before, "Rest week" when the week is empty. */
export function weekSummary(week: ScheduleWeekRows, enrolled: boolean): string {
  if (week.total === 0) return 'Rest week';
  if (enrolled) return `${formatStat(week.done)} of ${formatStat(week.total)} done`;
  return `${formatStat(week.total)} ${week.total === 1 ? 'session' : 'sessions'}`;
}

/**
 * The plan, week by week, as a text-only day list: Monday to Sunday, one
 * hairline row a day, rest days dimmed and named rather than left out. Every
 * week is here whether or not the member has enrolled — a plan you cannot
 * read is a plan you cannot choose.
 */
export function WeekList({ weeks, open, onToggle, workoutTo, linkState, menuFor, ownerAction }: WeekListProps) {
  const enrolled = Boolean(menuFor);
  return (
    <div className="space-y-3">
      {weeks.map((week) => {
        const isOpen = open.has(week.week);
        const panelId = `plan-week-${week.week}`;
        return (
          <Card key={week.week} padded={false}>
            <button
              type="button"
              className="pressable flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => onToggle(week.week)}
            >
              <span className="t-section text-text-1">Week {week.week}</span>
              <span className="flex items-center gap-2">
                <span className="t-meta tabular">{weekSummary(week, enrolled)}</span>
                <ChevronDown size={16} className={cx('shrink-0 text-text-3 transition-transform dur-2', isOpen && 'rotate-180')} aria-hidden="true" />
              </span>
            </button>

            {isOpen ? (
              <ul id={panelId} className="divide-y divide-line border-t border-line">
                {week.days.map((day) =>
                  day.rest ? (
                    <li key={`${week.week}-${day.day}-rest`} className="flex min-h-11 items-center px-4 py-2">
                      <span aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />
                      <span className="t-body text-text-3">{day.label} · Rest</span>
                    </li>
                  ) : (
                    day.rows.map((row) => (
                      <li key={`${row.week}-${row.day}-${row.order}`} className="flex min-h-12 items-center gap-2 py-1 pl-4 pr-2">
                        <StateGlyph row={row} />
                        {row.workoutId ? (
                          <Link
                            to={workoutTo(row.workoutId)}
                            state={linkState}
                            viewTransition
                            className={cx('pressable -mx-1 min-w-0 flex-1 truncate rounded-sm px-1 py-2 t-body', row.state === 'done' ? 'text-text-2' : 'text-text-1')}
                          >
                            {slotLine(day.label, row)}
                          </Link>
                        ) : (
                          <span className="min-w-0 flex-1 truncate py-2 t-body text-text-2">{slotLine(day.label, row)}</span>
                        )}
                        {row.state === 'skipped' ? <span className="t-meta shrink-0">Skipped</span> : null}
                        {row.isNext ? <span className="t-meta shrink-0">Next</span> : null}
                        {ownerAction?.(row)}
                        {menuFor ? <Menu items={menuFor(row)} label={`Options for ${row.title || 'this session'} on week ${row.week}, ${day.label}`} /> : null}
                      </li>
                    ))
                  ),
                )}
              </ul>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
