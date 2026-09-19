import { Badge, cx } from './ui';
import { Dumbbell, Trophy } from './icons';
import {
  formatBestSet,
  summaryStats,
  summaryUnit,
  type WorkoutSummary,
} from '../lib/workoutSummary';

const SHOWN_EXERCISES = 4;
const SHOWN_MUSCLES = 6;

function cardDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The workout a post was shared from: the API's server-built snapshot
 * (numbers cannot be claimed by the client), printed in the unit the member
 * trained in. Mobile renders the same card, so the two stay in step through
 * src/lib/workoutSummary.ts rather than through this markup.
 */
export function WorkoutSummaryCard({ summary, className }: { summary: WorkoutSummary; className?: string }) {
  const unit = summaryUnit(summary);
  const stats = summaryStats(summary);
  const exercises = summary.exercises ?? [];
  const shownExercises = exercises.slice(0, SHOWN_EXERCISES);
  const moreExercises = exercises.length - shownExercises.length;
  const muscles = (summary.muscleGroups ?? []).filter(Boolean);
  const shownMuscles = muscles.slice(0, SHOWN_MUSCLES);
  const moreMuscles = muscles.length - shownMuscles.length;
  const date = cardDate(summary.date);
  const title = summary.name?.trim() || 'Workout';

  return (
    <section
      aria-label={`Workout summary: ${title}`}
      data-testid="workout-summary-card"
      data-unit={unit}
      className={cx('rounded-lg border border-line bg-surface-2 p-3 text-text-1', className)}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text" aria-hidden="true">
          <Dumbbell size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            {date ? <span className="text-xs text-text-3">{date}</span> : null}
          </div>
          {stats.length ? (
            <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {stats.map((stat) => (
                <div key={stat.key} className="flex items-baseline gap-1">
                  <dt className="sr-only">{stat.label}</dt>
                  <dd className="font-semibold tabular-nums">{stat.value}</dd>
                  <dd className="text-xs text-text-2" aria-hidden="true">
                    {stat.key === 'prs' ? (
                      <span className="inline-flex items-center gap-0.5 text-warning-text">
                        <Trophy size={12} aria-hidden="true" /> {stat.label}
                      </span>
                    ) : (
                      stat.label
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>

      {shownMuscles.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Muscle groups">
          {shownMuscles.map((group) => (
            <li key={group}>
              <Badge size="sm">{group}</Badge>
            </li>
          ))}
          {moreMuscles > 0 ? (
            <li>
              <Badge size="sm">{`+${moreMuscles}`}</Badge>
            </li>
          ) : null}
        </ul>
      ) : null}

      {shownExercises.length ? (
        <ol className="mt-2.5 divide-y divide-line text-sm" aria-label="Exercises">
          {shownExercises.map((exercise, index) => {
            const best = formatBestSet(exercise.bestSet, unit);
            return (
              <li key={`${exercise.exerciseId || exercise.name}-${index}`} className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
                <span className="min-w-0 truncate">{exercise.name}</span>
                <span className="shrink-0 whitespace-nowrap text-xs text-text-2 tabular-nums">
                  {exercise.setCount > 0 ? `${exercise.setCount} ${exercise.setCount === 1 ? 'set' : 'sets'}` : ''}
                  {exercise.setCount > 0 && best ? ' · ' : ''}
                  {best ? <span className="font-medium text-text-1">{best}</span> : null}
                </span>
              </li>
            );
          })}
          {moreExercises > 0 ? <li className="pt-1.5 text-xs text-text-3">{`+${moreExercises} more ${moreExercises === 1 ? 'exercise' : 'exercises'}`}</li> : null}
        </ol>
      ) : null}
    </section>
  );
}

export default WorkoutSummaryCard;
