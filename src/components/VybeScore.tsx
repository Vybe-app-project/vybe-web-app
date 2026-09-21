/**
 * The Vybe score: one headline number a member sees in three places — the
 * Progress insights card, the Home rhythm card and their own profile — all
 * reading the same `score` block from `GET /api/health/analytics` behind
 * `insightsV2`.
 *
 * What it is, and what it is not. It is a bounded **consistency** summary of
 * what the member logged this week: Sessions 40 + Movement 30 + Meals 30
 * (`services/insightsScore.js`). It is not a health reading, not a fitness
 * level, not a diagnosis and not a verdict, so nothing here calls it one.
 * The band is a word in the ink colour — never red, never green — and the
 * one comparison the API makes rides as neutral hint text, the way the
 * Progress tiles print theirs: no arrow, no verdict colour.
 *
 * It is private. These components are rendered for the owner only; the score
 * never appears on another member's profile, in a feed card or in any rank.
 *
 * The zero rule: while any part is `not_enough_data` the number's place
 * holds the word "Calibrating" and the API's exact gap, never a 0.
 *
 * Every piece is pure — props only, no query, no store — so
 * tests/vybe-score.render.test.mjs can mount them under react-dom/server.
 */
import { Link } from 'react-router-dom';
import {
  VYBE_SCORE,
  movedHint,
  scoreHeadline,
  scoreRows,
  type InsightsScore,
  type ScoreHeadline,
} from '../lib/insights';
import { Button, Modal, cx } from './ui';

export { scoreHeadline };

export const VYBE_SCORE_HREF = '/workouts/progress';

/**
 * The number and its band, or the calibrating word and the gap. `hero` sets
 * the number in `.t-metric` (the one place type gets big); `compact` keeps it
 * inline for a profile row.
 */
export function VybeScoreMetric({
  headline,
  size = 'hero',
  className,
}: {
  headline: ScoreHeadline;
  size?: 'hero' | 'compact';
  className?: string;
}) {
  const hero = size === 'hero';
  return (
    <div className={cx(hero ? 'min-w-0' : 'flex min-w-0 items-baseline gap-1.5', className)} data-testid="vybe-score-metric" data-calibrating={headline.calibrating ? 'true' : 'false'}>
      <p className={cx('min-w-0', hero ? 'flex flex-wrap items-baseline gap-x-2' : 'contents')}>
        <span
          className={cx(
            'type-stat text-text-1',
            hero ? (headline.calibrating ? 'text-2xl' : 't-metric') : 'text-base font-semibold',
          )}
        >
          {headline.value}
        </span>
        {headline.outOf ? <span className={cx('text-text-2', hero ? 't-body' : 't-meta')}>{headline.outOf}</span> : null}
        {headline.band ? (
          <span className={cx('text-text-1', hero ? 't-body font-semibold' : 't-meta font-semibold')} data-testid="vybe-score-band">
            {headline.band}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/** The three parts as a hairline list: label, points against the part's own budget, the inputs, the gap. */
export function VybeScoreParts({ score, className }: { score: InsightsScore; className?: string }) {
  const rows = scoreRows(score);
  if (!rows.length) return null;
  return (
    <dl className={cx('divide-y divide-line', className)} data-testid="vybe-score-parts">
      {rows.map((row) => (
        <div key={row.key} className="py-2.5 first:pt-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="t-body min-w-0 truncate text-text-1">{row.label}</dt>
            <dd className="t-body shrink-0 tabular-nums text-text-1" data-part={row.key} data-state={row.state}>
              {row.value}
            </dd>
          </div>
          {row.inputs ? <p className="t-meta mt-0.5">{row.inputs}</p> : null}
          {row.gap ? <p className="t-meta mt-0.5 text-text-1">{row.gap}</p> : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * "About this score": the three parts with the inputs each number came from,
 * the one comparison the API made, and the disclosure the design keeps
 * verbatim. Nothing is computed here that the API did not send.
 */
export function VybeScoreAbout({
  open,
  onClose,
  score,
  withLink = false,
}: {
  open: boolean;
  onClose: () => void;
  score: InsightsScore | null;
  /** Adds the link to Progress; the Progress card itself does not need it. */
  withLink?: boolean;
}) {
  const window = score?.window || 'week';
  const hint = movedHint(score);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={VYBE_SCORE.about}
      description={`${VYBE_SCORE.name}: ${VYBE_SCORE.measure.toLowerCase()} over the three parts below.`}
      size="sm"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3" data-testid="vybe-score-about">
        {score ? <VybeScoreParts score={score} /> : null}
        {hint ? <p className="t-meta" data-testid="vybe-score-moved">{hint}</p> : null}
        <p className="t-meta">{VYBE_SCORE.disclosure(window)}</p>
        {withLink ? (
          <Link to={VYBE_SCORE_HREF} viewTransition onClick={onClose} className="t-body inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
            {VYBE_SCORE.open}
          </Link>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * The compact row: "Vybe score · 72 · OK" with the About trigger. The
 * profile's own row, shown to the owner alone and only once the score has a
 * number — a calibrating score is the owner's business on Progress, not a
 * line on their profile.
 */
export function VybeScoreRow({
  headline,
  onAbout,
  className,
}: {
  headline: ScoreHeadline;
  onAbout: () => void;
  className?: string;
}) {
  return (
    <div className={cx('flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1', className)} data-testid="vybe-score-row">
      <span className="t-meta">{VYBE_SCORE.name}</span>
      <span aria-hidden="true" className="t-meta">
        ·
      </span>
      <VybeScoreMetric headline={headline} size="compact" />
      <Button variant="link" size="sm" className="ml-auto min-h-11" onClick={onAbout} aria-haspopup="dialog">
        {VYBE_SCORE.about}
      </Button>
    </div>
  );
}
