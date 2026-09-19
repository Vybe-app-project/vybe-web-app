import { Badge, cx } from './ui';
import { Calendar, Trophy } from './icons';
import { useUnits, weightUnit } from '../lib/units';
import { hasRecapSummary, recapKindLabel, recapStats, type RecapSummary } from '../lib/recapSummary';

export { hasRecapSummary };

/**
 * A weekly or monthly recap shared as a post: the server-built snapshot,
 * printed in the viewer's unit (recaps carry no unit of their own). The
 * mobile card shows the same numbers; the web has no recap viewer yet, so
 * there is no "View recap" row here.
 */
export function RecapSummaryCard({ summary, className }: { summary: RecapSummary; className?: string }) {
  const system = useUnits((s) => s.system);
  const unit = weightUnit(system);
  const stats = recapStats(summary, unit);
  const exercises = (summary.topExercises ?? []).filter(Boolean).slice(0, 3);
  const title = recapKindLabel(summary.kind);

  return (
    <section
      aria-label={`${title}: ${summary.periodLabel}`}
      data-testid="recap-summary-card"
      data-kind={summary.kind}
      className={cx('rounded-lg border border-line bg-surface-2 p-3 text-text-1', className)}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text" aria-hidden="true">
          <Calendar size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            <span className="text-xs text-text-3">{summary.periodLabel}</span>
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
          ) : (
            <p className="mt-1 text-sm text-text-2">A quiet stretch. The next one is a fresh start.</p>
          )}
        </div>
      </div>
      {exercises.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Most trained">
          {exercises.map((name) => (
            <li key={name}>
              <Badge size="sm">{name}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default RecapSummaryCard;
