import { Button, Card, CardHeader, EmptyState } from '../ui';
import { Trophy } from '../icons';
import { PROGRESS_STRINGS, countLabel, recordRows, type ProgressPr } from '../../lib/progress';
import type { UnitSystem } from '../../lib/unitConversions';

export const RECORDS_COLLAPSED = 20;

/**
 * "Records": the period's PRs newest first, each as
 * "Estimated 1RM: 308.6 lb, was 297.6 lb · 3 Sep" in the viewer's units,
 * twenty until "Show all". Empty state with a verb, no badge, no colour.
 * Pure: `system` and the open state come from the caller.
 */
export function RecordsList({
  prs,
  system,
  showAll,
  onToggle,
  now,
  className,
}: {
  prs: ReadonlyArray<ProgressPr> | null | undefined;
  system: UnitSystem;
  showAll: boolean;
  onToggle?: () => void;
  now?: Date;
  className?: string;
}) {
  const rows = recordRows(prs, system, now);
  const shown = showAll ? rows : rows.slice(0, RECORDS_COLLAPSED);
  const hasMore = rows.length > RECORDS_COLLAPSED;
  return (
    <Card className={className} data-testid="progress-records">
      <CardHeader
        title={PROGRESS_STRINGS.records}
        subtitle={rows.length ? countLabel(rows.length, 'record') : undefined}
        action={
          hasMore && onToggle ? (
            <Button variant="link" size="sm" onClick={onToggle} aria-expanded={showAll}>
              {showAll ? PROGRESS_STRINGS.showFewer : PROGRESS_STRINGS.showAll}
            </Button>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <EmptyState size="sm" level={3} icon={<Trophy size={24} />} title={PROGRESS_STRINGS.recordsEmptyTitle} message={PROGRESS_STRINGS.recordsEmptyBody} />
      ) : (
        <ol className="divide-y divide-line">
          {shown.map((row) => (
            <li key={row.key} className="py-2.5 text-sm">
              <p className="truncate font-semibold text-text-1">{row.exerciseName}</p>
              <p className="text-text-2">
                {`${row.title}: `}
                <span className="text-text-1">{row.value}</span>
                {`${row.was ? `, was ${row.was}` : ''}${row.date ? ` · ${row.date}` : ''}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
