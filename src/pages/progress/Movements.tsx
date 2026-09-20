import { Card, CardHeader } from '../ui';
import { ChevronRight } from '../icons';
import { PROGRESS_STRINGS, movementRows, type ProgressExercise } from '../../lib/progress';
import type { UnitSystem } from '../../lib/unitConversions';

/**
 * "Movements": the period's top ten exercises by sessions, each a button that
 * opens the exercise trend sheet. The best for the exercise's measure prints
 * in the viewer's units ("Estimated 1RM 308.6 lb", "Longest hold 2:00",
 * "Best pace 5:24 /km"). Pure: `system` comes from the caller.
 */
export function Movements({
  exercises,
  system,
  onOpen,
  className,
}: {
  exercises: ReadonlyArray<ProgressExercise> | null | undefined;
  system: UnitSystem;
  onOpen: (exerciseId: string) => void;
  className?: string;
}) {
  const rows = movementRows(exercises, system);
  return (
    <Card className={className} data-testid="progress-movements">
      <CardHeader title={PROGRESS_STRINGS.movements} subtitle={rows.length ? 'Open a movement for its trend and records' : undefined} />
      {rows.length === 0 ? (
        <p className="text-sm text-text-2">{PROGRESS_STRINGS.emptyBody}</p>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.exerciseId}>
              <button
                type="button"
                onClick={() => onOpen(row.exerciseId)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text-1">{row.name}</span>
                  <span className="block text-xs text-text-2">{`${row.sessionsLabel}${row.best ? ` · ${row.best}` : ''}`}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-text-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
