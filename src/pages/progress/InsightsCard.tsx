import { Button, Card, CardHeader, Skeleton, cx } from '../ui';
import { ChevronRight } from '../icons';
import { VybeScoreMetric, VybeScoreParts } from '../../components/VybeScore';
import {
  INSIGHTS_STRINGS,
  VYBE_SCORE,
  movedHint,
  scoreHeadline,
  type Focus,
  type InsightsScore,
} from '../../lib/insights';

/**
 * The Vybe score on Progress: the headline number, the three parts it is
 * made of with the inputs each one read, the one comparison the API made,
 * and the "About this score" disclosure.
 *
 * The score is consistency over what the member logged this week — never a
 * reading of their health, a level reached, or a verdict. The band is a word in the ink
 * colour; `movedBy` is neutral hint text with no arrow and no verdict colour,
 * the rule the period tiles beside this card already follow. While any part
 * is short the number's place reads "Calibrating" with the API's exact gap,
 * never a 0.
 *
 * Focus is one row: the server's own label for the kind the member chose, and
 * the button that opens the sheet offering the four values the route accepts.
 *
 * Pure — props only, no query and no store — so tests/progress-insights.render
 * can mount it under react-dom/server.
 */
export function InsightsCard({
  score,
  focus,
  focusEnabled = false,
  onEditFocus,
  onAbout,
  loading = false,
  className,
}: {
  score: InsightsScore | null;
  focus?: Focus | null;
  /** The `focus` flag: the row exists only while the three focus routes answer. */
  focusEnabled?: boolean;
  onEditFocus?: () => void;
  onAbout?: () => void;
  loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <Card className={className} data-testid="insights-card" aria-busy="true">
        <CardHeader title={VYBE_SCORE.name} />
        <Skeleton className="h-11 w-32 rounded-sm" />
        <Skeleton className="mt-3 h-4 w-3/4 rounded-sm" />
        <Skeleton className="mt-3 h-24 w-full rounded-sm" />
      </Card>
    );
  }
  const headline = scoreHeadline(score);
  if (!score || !headline) return null;
  const hint = movedHint(score);
  const focusLabel = focus?.label || null;

  return (
    <Card className={className} data-testid="insights-card">
      <CardHeader title={VYBE_SCORE.name} subtitle={VYBE_SCORE.eyebrow(score.window || 'week')} />

      <VybeScoreMetric headline={headline} size="hero" />
      {headline.note ? (
        <p className="t-body mt-1 text-text-2" data-testid="insights-note">
          {headline.note}
        </p>
      ) : null}
      {/* The one comparison the API makes, as text: no badge, no arrow, no colour. */}
      {hint ? (
        <p className="t-meta mt-1" data-testid="insights-moved">
          {hint}
        </p>
      ) : null}

      <VybeScoreParts score={score} className="mt-4 border-t border-line pt-2.5" />

      <div className={cx('mt-1 flex flex-wrap items-center gap-x-3', focusEnabled && 'border-t border-line pt-1')}>
        <Button variant="ghost" size="sm" className="-ml-3 min-h-11" onClick={onAbout} aria-haspopup="dialog" data-testid="insights-about">
          {VYBE_SCORE.about}
        </Button>
        {focusEnabled ? (
          <button
            type="button"
            onClick={onEditFocus}
            className="pressable ml-auto -mr-2 flex min-h-11 items-center gap-1 rounded-sm px-2 text-left"
            aria-haspopup="dialog"
            data-testid="insights-focus-row"
          >
            <span className="t-meta">{INSIGHTS_STRINGS.focusRow}</span>
            <span className="t-body font-semibold text-text-1">{focusLabel ?? INSIGHTS_STRINGS.focusNone}</span>
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-text-3" />
          </button>
        ) : null}
      </div>
    </Card>
  );
}

export default InsightsCard;
