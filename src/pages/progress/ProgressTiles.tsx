import { StatGrid, StatTile } from '../ui';
import { statTiles, type ProgressSummary, type WeightUnit } from '../../lib/progress';

/**
 * "This period": Sessions · Sets · Volume · Minutes. The comparison with the
 * previous window rides on StatTile's `hint` as a neutral number ("+2 vs the
 * previous 30 days", "same as the previous 30 days"), never on `delta`, whose
 * badge colours and trend icons would turn a count into a verdict
 * (design-progression-hub.md §3.8). Pure: `unit` comes from the caller.
 */
export function ProgressTiles({
  summary,
  unit,
  days,
  loading = false,
}: {
  summary: Pick<ProgressSummary, 'sessions' | 'setCount' | 'totalVolumeKg' | 'totalMinutes' | 'previous'> | null | undefined;
  unit: WeightUnit;
  /** The window length the hint names. */
  days: number;
  loading?: boolean;
}) {
  const tiles = statTiles(summary, unit, days);
  return (
    <section aria-label="This period" data-testid="progress-tiles">
      <StatGrid columns={4}>
        {tiles.map((tile) => (
          <StatTile key={tile.key} label={tile.label} value={tile.value} hint={tile.hint} loading={loading} />
        ))}
      </StatGrid>
    </section>
  );
}
