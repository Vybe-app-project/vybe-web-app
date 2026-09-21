import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, CardHeader, DateField, Menu, Modal, Skeleton, type MenuItem } from '../ui';
import { CalendarDays, Trash } from '../icons';
import { PROGRESS_STRINGS, countLabel, shortDate, type ShelfRow } from '../../lib/progress';

/**
 * "Personal records": one row per movement with its best set, the estimated
 * 1RM ("est."), the best single-set volume and when — the member's best ever,
 * as `GET /workouts/records` reports it after their own corrections. The
 * period's PRs stay on the Records card above; this is the standing shelf.
 *
 * Every row links to the movement's page, and its menu holds the two
 * corrections the API supports:
 *
 *  · "Remove this record" — `DELETE /workouts/records/:id`, one entry per
 *    distinct achieving set, because a set leaves every record type of the
 *    exercise together and the member should see which set they are dropping.
 *  · "Start fresh from a date…" — `POST /workouts/records/reset`, which takes
 *    an `exerciseId`: there is no route that resets every exercise at once, so
 *    this belongs to a row, not to the card's footer.
 *
 * Both are undone from the toast the page raises. Pure props: no query, no
 * store, no unit lookup — `system` is applied by lib/progress before a row
 * reaches this file, so the card renders under react-dom/server.
 */

export const SHELF_COLLAPSED = 8;

/** The one-line description of a record, used in a menu label and in a toast. */
export const factLabel = (row: Pick<ShelfRow, 'facts'>, index: number): string => {
  const fact = row.facts[index];
  return fact ? `${fact.label} ${fact.value}` : '';
};

/* -------------------------------------------------------------------- rows */

/**
 * The row's facts on one line. Each fact is unbreakable so a value never
 * parts from its label, and the separator is a real text node so the line
 * still has somewhere to wrap between facts on a 390 px screen.
 */
function FactList({ facts }: { facts: ShelfRow['facts'] }) {
  return (
    <span className="text-text-2">
      {facts.map((fact, i) => (
        <Fragment key={fact.type}>
          {i > 0 ? <span aria-hidden="true">{' · '}</span> : null}
          <span className="whitespace-nowrap">
            {`${fact.label} `}
            <span className="text-text-1">{fact.value}</span>
            {fact.estimated ? <span className="text-text-3">{` ${PROGRESS_STRINGS.estimateMark}`}</span> : null}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export function RecordsShelf({
  rows,
  loading = false,
  showAll,
  onToggle,
  onRemove,
  onReset,
  busyExerciseId = null,
  footer,
  className,
}: {
  rows: ReadonlyArray<ShelfRow> | null | undefined;
  loading?: boolean;
  showAll: boolean;
  onToggle?: () => void;
  /** The record id is built by lib/records from the fields the payload carries. */
  onRemove?: (row: ShelfRow, factIndex: number) => void;
  onReset?: (row: ShelfRow) => void;
  busyExerciseId?: string | null;
  /** The adjustments block, supplied by the page so this card stays pure. */
  footer?: ReactNode;
  className?: string;
}) {
  const list = rows ?? [];
  const shown = showAll ? list : list.slice(0, SHELF_COLLAPSED);
  const hasMore = list.length > SHELF_COLLAPSED;
  return (
    <Card className={className} data-testid="progress-bests">
      <CardHeader
        title={PROGRESS_STRINGS.bests}
        subtitle={list.length ? countLabel(list.length, 'movement') : undefined}
        action={
          hasMore && onToggle ? (
            <Button variant="link" size="sm" onClick={onToggle} aria-expanded={showAll}>
              {showAll ? PROGRESS_STRINGS.showFewer : PROGRESS_STRINGS.showAll}
            </Button>
          ) : null
        }
      />
      {loading ? (
        // The skeleton is the row geometry the list resolves to: name, facts, date.
        <ul className="divide-y divide-line" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="space-y-1.5 py-2.5">
              <Skeleton className="h-4 w-32 rounded-xs" />
              <Skeleton className="h-3.5 w-full rounded-xs" />
            </li>
          ))}
        </ul>
      ) : list.length === 0 ? (
        <p className="t-body text-text-2">{PROGRESS_STRINGS.bestsEmpty}</p>
      ) : (
        <ol className="divide-y divide-line">
          {shown.map((row) => {
            const items: MenuItem[] = [];
            if (onRemove) {
              row.facts.forEach((fact, index) => {
                const key = `${fact.workoutId}:${fact.setId ?? ''}`;
                if (items.some((item) => item.key === key)) return;
                items.push({
                  key,
                  label: PROGRESS_STRINGS.bestsRemove,
                  description: `${fact.label} ${fact.value}, ${shortDate(fact.date)}`,
                  icon: <Trash size={18} />,
                  danger: true,
                  onSelect: () => onRemove(row, index),
                });
              });
            }
            if (onReset) {
              items.push({
                key: 'reset',
                label: PROGRESS_STRINGS.bestsReset,
                icon: <CalendarDays size={18} />,
                divider: items.length > 0,
                onSelect: () => onReset(row),
              });
            }
            return (
              <li key={row.exerciseId} className="flex items-start gap-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/exercises/${row.exerciseId}`}
                    viewTransition
                    className="block truncate font-semibold text-text-1 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {row.name}
                  </Link>
                  <p className="mt-0.5">
                    <FactList facts={row.facts} />
                    {row.when ? <span className="text-text-3">{` · ${row.when}`}</span> : null}
                  </p>
                </div>
                {items.length ? (
                  <Menu
                    items={items}
                    size={40}
                    align="end"
                    label={`Records for ${row.name}`}
                    className={busyExerciseId === row.exerciseId ? 'pointer-events-none opacity-60' : undefined}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {footer}
    </Card>
  );
}

/* ------------------------------------------------------------- adjustments */

export type AdjustmentRow = { id: string; exerciseId: string; name: string; text: string; kind: 'exclude' | 'reset' };

/**
 * "Adjustments": the removals and resets still in force, each with its Undo.
 * The route reads one exercise at a time (`?exerciseId=`), so the page only
 * asks once this is open — before that the line offers "Show" rather than
 * claiming a count it has not read.
 */
export function RecordAdjustments({
  open,
  rows,
  loading = false,
  onOpen,
  onUndo,
  busyId = null,
}: {
  open: boolean;
  rows: ReadonlyArray<AdjustmentRow> | null | undefined;
  loading?: boolean;
  onOpen?: () => void;
  onUndo?: (row: AdjustmentRow) => void;
  busyId?: string | null;
}) {
  const list = rows ?? [];
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="progress-adjustments">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="t-meta">{PROGRESS_STRINGS.adjustments}</p>
        {!open && onOpen ? (
          <Button variant="link" size="sm" onClick={onOpen}>
            {PROGRESS_STRINGS.adjustmentsShow}
          </Button>
        ) : null}
      </div>
      {!open ? (
        <p className="t-meta text-text-3">{PROGRESS_STRINGS.bestsPerExercise}</p>
      ) : loading ? (
        <Skeleton className="h-4 w-48 rounded-xs" aria-hidden="true" />
      ) : list.length === 0 ? (
        <p className="t-meta text-text-3">{PROGRESS_STRINGS.adjustmentsNone}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((row) => (
            <li key={row.id} className="flex min-h-9 items-center justify-between gap-3 py-1.5">
              <p className="min-w-0 flex-1 truncate text-xs text-text-2">
                <span className="text-text-1">{row.name}</span>
                {` — ${row.text}`}
              </p>
              {onUndo ? (
                <Button variant="link" size="sm" disabled={busyId === row.id} onClick={() => onUndo(row)}>
                  {PROGRESS_STRINGS.undo}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- reset dialog */

/** The day the reset defaults to: today, on the device's clock, in the API's key format. */
const todayKey = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * "Start fresh?": one date, one sentence saying exactly what stops counting,
 * and the reassurance that it is reversible. `from` must not be in the future,
 * which is also the route's rule, so the field is capped at today.
 */
export function ResetRecordsDialog({
  row,
  onClose,
  onConfirm,
  busy = false,
  now,
}: {
  /** null keeps the dialog closed. */
  row: Pick<ShelfRow, 'exerciseId' | 'name'> | null;
  onClose: () => void;
  onConfirm: (from: string) => void;
  busy?: boolean;
  now?: Date;
}) {
  const today = todayKey(now);
  const [from, setFrom] = useState(today);
  const open = !!row;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={PROGRESS_STRINGS.bestsResetTitle}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!from} onClick={() => onConfirm(from)}>
            {PROGRESS_STRINGS.bestsResetConfirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="t-body text-text-2">
          {`${PROGRESS_STRINGS.bestsResetFrom} ${shortDate(from, now)} stop counting for ${row?.name ?? ''}. ${PROGRESS_STRINGS.bestsResetUndo}`}
        </p>
        <DateField label="From" value={from} max={today} onChange={(e) => setFrom(e.currentTarget.value)} />
      </div>
    </Modal>
  );
}
