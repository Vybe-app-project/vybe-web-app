import { Button, Card, CardHeader } from '../ui';
import { MUSCLE_ROWS_COLLAPSED, PROGRESS_STRINGS, muscleRows, type ProgressMuscleGroup } from '../../lib/progress';

/**
 * "Muscle groups": sets per group this period with a bar against the busiest
 * group (brand token, never a colour scale), "+n secondary" for assisting
 * work, the top eight until "Show all". The API already counts custom and
 * unknown exercises under Other; the footnote says so. Pure: the open state
 * lives with the caller.
 */
export function MuscleGroups({
  groups,
  showAll,
  onToggle,
  className,
}: {
  groups: ReadonlyArray<ProgressMuscleGroup> | null | undefined;
  showAll: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const { rows, hasMore } = muscleRows(groups, showAll, MUSCLE_ROWS_COLLAPSED);
  return (
    <Card className={className} data-testid="progress-muscles">
      <CardHeader
        title={PROGRESS_STRINGS.muscles}
        action={
          hasMore && onToggle ? (
            <Button variant="link" size="sm" onClick={onToggle} aria-expanded={showAll}>
              {showAll ? PROGRESS_STRINGS.showFewer : PROGRESS_STRINGS.showAll}
            </Button>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <p className="text-sm text-text-2">{PROGRESS_STRINGS.emptyBody}</p>
      ) : (
        <ol className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.group} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-text-1">{row.name}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(row.fraction * 100)}%` }} />
              </div>
              <span className="whitespace-nowrap text-right tabular-nums text-text-1">
                {row.sets}
                <span className="ml-1 text-2xs font-medium text-text-3">{row.sets === 1 ? 'set' : 'sets'}</span>
                {row.secondarySets ? <span className="ml-2 text-2xs text-text-3">{`+${row.secondarySets} secondary`}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-text-3">{PROGRESS_STRINGS.musclesFootnote}</p>
    </Card>
  );
}
