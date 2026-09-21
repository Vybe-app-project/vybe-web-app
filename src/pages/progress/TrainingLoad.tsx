import { useState } from 'react';
import { Button, Card, CardHeader, Skeleton } from '../ui';
import {
  LOAD_STRINGS,
  loadBarLabel,
  loadBars,
  loadLine,
  loadNumbers,
  loadOfferLine,
  loadRatedLine,
  weekKeyLabel,
  type TrainingLoad as TrainingLoadBlock,
} from '../../lib/insights';

/**
 * Training load on Progress: effort times minutes, added up, this week
 * against the member's own previous four (`services/trainingLoad.js`).
 *
 * The verdict is the server's — one of five labels, printed as the design's
 * five sentences and never as a colour. The weekly series is the API's
 * `trainingLoad.weekly` (H-8), drawn as a plain grid of divs: weeks on the
 * x-axis, no y-axis, because the API sends no scale. Each bar is relative to
 * the tallest week in the set and says its own numbers aloud. No chart
 * library, no gradient, no red and no green.
 *
 * Off for a minor (`state: 'off'`, reason `age`) renders nothing at all, and
 * a week the API could not total is a bar with no height rather than a zero.
 *
 * Pure — props only.
 */
export function TrainingLoad({
  load,
  loading = false,
  className,
}: {
  load: TrainingLoadBlock | null;
  loading?: boolean;
  className?: string;
}) {
  const [numbersOpen, setNumbersOpen] = useState(false);
  if (loading) {
    return (
      <Card className={className} data-testid="training-load" aria-busy="true">
        <CardHeader title={LOAD_STRINGS.title} />
        <Skeleton className="h-4 w-2/3 rounded-sm" />
        <Skeleton className="mt-3 h-16 w-full rounded-sm" />
      </Card>
    );
  }
  // `off` is the minor policy: the card is absent, not empty, and says nothing
  // about why (docs/api-contract.md, insightsMinorPolicy).
  if (!load || load.state === 'off') return null;
  const line = loadLine(load);
  if (!line) return null;
  const bars = loadBars(load);
  const numbers = loadNumbers(load);
  const rated = loadRatedLine(load);
  const offer = loadOfferLine(load);

  return (
    <Card className={className} data-testid="training-load">
      <CardHeader title={LOAD_STRINGS.title} />

      <p className="t-body text-text-1" data-testid="training-load-line">
        {line}
      </p>
      {offer ? (
        <p className="t-body mt-1 text-text-2" data-testid="training-load-offer">
          {offer}
        </p>
      ) : null}

      {bars.length ? (
        <>
          <ol aria-label={LOAD_STRINGS.weeks} className="mt-4 flex items-end gap-1.5" data-testid="training-load-bars">
            {bars.map((bar) => (
              <li key={bar.weekKey} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="sr-only">{loadBarLabel(bar)}</span>
                <span aria-hidden="true" className="flex h-16 w-full items-end">
                  <span
                    data-testid="training-load-bar"
                    data-load={bar.load === null ? 'unknown' : String(bar.load)}
                    className={bar.ratio > 0 ? 'w-full rounded-[3px] bg-text-1' : 'w-full rounded-[3px] bg-surface-3'}
                    style={{ height: bar.ratio > 0 ? `${Math.max(8, Math.round(bar.ratio * 100))}%` : '2px' }}
                  />
                </span>
                <span aria-hidden="true" className="t-meta w-full truncate text-center text-2xs">
                  {weekKeyLabel(bar.weekKey).replace('Week ', '')}
                </span>
              </li>
            ))}
          </ol>
          <p className="t-meta mt-2">{LOAD_STRINGS.usualNote}</p>
        </>
      ) : null}

      {numbers ? (
        <div className="mt-1">
          <Button variant="ghost" size="sm" className="-ml-3 min-h-11" aria-expanded={numbersOpen} onClick={() => setNumbersOpen((open) => !open)} data-testid="training-load-numbers-toggle">
            {numbersOpen ? LOAD_STRINGS.hideNumbers : LOAD_STRINGS.showNumbers}
          </Button>
          {numbersOpen ? (
            <div className="mt-1 border-t border-line pt-2" data-testid="training-load-numbers">
              <p className="t-meta tabular-nums text-text-1">{numbers}</p>
              {rated ? <p className="t-meta mt-0.5">{rated}</p> : null}
              <p className="t-meta mt-0.5">{LOAD_STRINGS.explainer}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export default TrainingLoad;
