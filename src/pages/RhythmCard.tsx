/**
 * The rhythm card on Home: the seven days of this week, the one line the
 * week's numbers make, the weekly chain once it is worth naming, and at most
 * one secondary row — the Monday suggestion, the welcome-back offer, the
 * unviewed recap or the rest-week bank, in that order.
 *
 * It sits in FirstWeekCard's slot and takes the same discipline: decide
 * before reading anything (a member inside their first week, or a server
 * with the flags dark, makes no request at all), and never render a sentence
 * before the query behind it resolves. The geometry is fixed — header, strip,
 * one line, one slot — so the skeleton is the card's exact height and the
 * feed under it never moves.
 *
 * Feature detection twice, as the brief requires: `insightsV2` in
 * /api/capabilities gates the card (there is no `rhythm` flag; GET /api/rhythm
 * itself is ungated, see the report), and each flagged block is dropped again
 * when its own route answers 404 FEATURE_DISABLED. Neither shows a skeleton
 * or an error.
 *
 * `RhythmCardView` renders from props alone (tests/rhythm-card.render.test.mjs
 * mounts it under react-dom/server); the default export owns every hook.
 */
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeature, useFeatureGate } from '../lib/capabilities';
import { isWithinWindow, parseCreatedAt } from '../lib/firstWeek';
import {
  RHYTHM_STRINGS,
  actOnSuggestion,
  basisRowLabel,
  fetchRhythm,
  isFeatureDisabled,
  milestoneLine,
  restBankLine,
  rhythmKeys,
  suggestionAcceptLabel,
  suggestionLine,
  weekCells,
  weekLine,
  weeksKeptLabel,
  type RhythmSuggestion,
  type RhythmView,
  type SuggestionAction,
} from '../lib/rhythm';
import {
  ackWelcomeBack,
  fetchInsights,
  fetchWelcomeBack,
  insightsKeys,
  TREND_WINDOWS,
  welcomeBackLine,
  welcomeBackOffer,
  type InsightsScore,
  type WelcomeBack,
  type WelcomeBackOffer,
} from '../lib/insights';
import { VYBE_SCORE_HREF, VybeScoreMetric, scoreHeadline } from '../components/VybeScore';
import { VYBE_SCORE } from '../lib/insights';
import type { RecapListRow } from '../lib/recapView';
import { Button, Card, Skeleton, cx } from './ui';
import { ChevronRight } from './icons';

/* ------------------------------------------------------------------- view */

/** `kind` is whatever the API listed: 'week', 'month' or 'year'. */
export type RhythmRecapRow = { id: string; kind: string };

export type RhythmCardViewProps = {
  /** null while the rhythm read is in flight: the frame renders its skeleton at the same height. */
  rhythm: RhythmView | null;
  /** The pending return record, when the `welcomeBack` route answered with one. */
  welcomeBack?: WelcomeBack | null;
  /** The newest recap the API says has not been opened. */
  recap?: RhythmRecapRow | null;
  /** The disclosed score, when `insightsV2` answered with one; the card's one big number. */
  score?: InsightsScore | null;
  onSuggestion?: (action: SuggestionAction) => void;
  onWelcomeBack?: (offer: WelcomeBackOffer | null) => void;
  /** True while either write is in flight: the actions show busy and ignore a second press. */
  busy?: boolean;
  className?: string;
};

/** The label under a recap row, in the noun of the period the API named. */
export function recapRowCopy(kind: string): string {
  if (kind === 'year') return 'Your year in Vybe is ready';
  if (kind === 'month') return 'Your month in review is ready';
  return RHYTHM_STRINGS.recapRow;
}

/** One 32 px cell per day: ink when the day counted, a hairline well when it did not. */
function DayStrip({ cells }: { cells: ReturnType<typeof weekCells> }) {
  return (
    <ol aria-label={RHYTHM_STRINGS.weekLabel} className="grid grid-cols-7 gap-1.5" data-testid="rhythm-days">
      {cells.map((cell) => (
        <li
          key={cell.index}
          data-counted={cell.counted ? 'true' : 'false'}
          className={cx(
            'flex h-8 items-center justify-center rounded-sm border text-xs font-semibold tabular-nums',
            cell.counted ? 'border-text-2 bg-text-1 text-bg' : 'border-line bg-surface-2 text-text-3',
          )}
        >
          {/* The letter repeats twice a week, so the spoken name is the day and its date. */}
          <span className="sr-only">{cell.description}</span>
          <span aria-hidden="true">{cell.letter}</span>
        </li>
      ))}
    </ol>
  );
}

const SLOT = 'flex h-14 flex-col justify-center';

export function RhythmCardView({
  rhythm,
  welcomeBack = null,
  recap = null,
  score = null,
  onSuggestion,
  onWelcomeBack,
  busy = false,
  className,
}: RhythmCardViewProps) {
  const titleId = useId();
  const [basisOpen, setBasisOpen] = useState(false);
  const cells = weekCells(rhythm?.currentWeek);
  const chain = weeksKeptLabel(rhythm?.weeksKept);
  const milestone = chain ? milestoneLine(rhythm?.nextMilestone) : null;
  const suggestion: RhythmSuggestion | null = rhythm?.suggestion ?? null;
  const suggestionText = suggestionLine(suggestion);
  const acceptLabel = suggestionAcceptLabel(suggestion);
  const offer = welcomeBackOffer(welcomeBack);
  // The welcome-back sentence replaces the week's line; everything else keeps its place.
  const line = welcomeBack ? welcomeBackLine(welcomeBack) : weekLine(rhythm?.currentWeek, rhythm?.pause);
  const bank = restBankLine(rhythm?.restTokens);
  const basis = Array.isArray(suggestion?.basis) ? suggestion.basis : [];
  const headline = scoreHeadline(score);

  return (
    <Card container data-testid="rhythm-card" role="region" aria-labelledby={titleId} className={className}>
      <div className="mb-3 flex min-h-12 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="t-section text-text-1">
            {RHYTHM_STRINGS.cardTitle}
          </h2>
          {rhythm && chain ? (
            <p className="t-meta" data-testid="rhythm-weeks-kept">
              {chain}
              {milestone ? <span className="text-text-3"> · {milestone}</span> : null}
            </p>
          ) : null}
        </div>
        {/* The one big number on Home, and the one blue text link: the Vybe
            score, straight from the API, opening the card that discloses it. */}
        {headline ? (
          <Link
            to={VYBE_SCORE_HREF}
            viewTransition
            className="pressable shrink-0 rounded-sm px-1 text-right"
            aria-label={`${VYBE_SCORE.name} ${headline.value}${headline.outOf ? ` ${headline.outOf}` : ''}. ${VYBE_SCORE.open}`}
            data-testid="rhythm-score"
          >
            <span className="t-meta block">{VYBE_SCORE.name}</span>
            <VybeScoreMetric headline={headline} size="compact" className="justify-end" />
          </Link>
        ) : rhythm ? null : (
          <Skeleton className="h-6 w-24 shrink-0 rounded-sm" />
        )}
      </div>

      {rhythm ? <DayStrip cells={cells} /> : <Skeleton className="h-8 w-full rounded-sm" aria-hidden="true" />}

      <div className="mt-3 flex h-10 items-start">
        {rhythm ? (
          <p className="t-body line-clamp-2 text-text-1" data-testid="rhythm-line">
            {line}
          </p>
        ) : (
          <Skeleton className="h-4 w-3/4 rounded-sm" aria-hidden="true" />
        )}
      </div>

      <div className={SLOT}>
        {!rhythm ? (
          <Skeleton className="h-4 w-1/2 rounded-sm" aria-hidden="true" />
        ) : welcomeBack ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="rhythm-welcome-back">
            {offer ? (
              <Button variant="link" size="sm" className="min-h-11" loading={busy} onClick={() => onWelcomeBack?.(offer)}>
                {offer.label}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => onWelcomeBack?.(null)} data-testid="rhythm-welcome-back-dismiss">
              {RHYTHM_STRINGS.welcomeBackDismiss}
            </Button>
          </div>
        ) : suggestionText ? (
          <div data-testid="rhythm-suggestion">
            <p className="t-meta line-clamp-2 text-text-1">
              <span className="text-text-2">{RHYTHM_STRINGS.suggestionPrefix}: </span>
              {suggestionText}
            </p>
            <div className="flex flex-wrap items-center gap-x-3">
              {acceptLabel ? (
                <Button variant="link" size="sm" className="min-h-11" loading={busy} onClick={() => onSuggestion?.('accept')}>
                  {acceptLabel}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => onSuggestion?.('not_now')}>
                {RHYTHM_STRINGS.notNow}
              </Button>
              {basis.length ? (
                <Button variant="ghost" size="sm" className="min-h-11" aria-expanded={basisOpen} onClick={() => setBasisOpen((open) => !open)}>
                  {RHYTHM_STRINGS.suggestionBasis}
                </Button>
              ) : null}
            </div>
          </div>
        ) : recap ? (
          <Link
            to={`/recaps/${recap.id}`}
            viewTransition
            className="pressable -mx-2 flex min-h-11 items-center gap-2 rounded-sm px-2 text-brand-text"
            data-testid="rhythm-recap-row"
          >
            <span className="t-body min-w-0 flex-1 truncate font-semibold">{recapRowCopy(recap.kind)}</span>
            <ChevronRight size={18} aria-hidden="true" className="shrink-0" />
          </Link>
        ) : bank ? (
          <p className="t-meta line-clamp-2" data-testid="rhythm-rest-bank">
            {bank}
          </p>
        ) : null}
      </div>

      {basisOpen && basis.length ? (
        <ul className="mt-1 divide-y divide-line border-t border-line" aria-label={RHYTHM_STRINGS.suggestionBasis} data-testid="rhythm-basis">
          {basis.map((week) => (
            <li key={week.key} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="t-meta">{week.key}</span>
              <span className="t-meta tabular-nums text-text-1">{basisRowLabel(week)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------------------------- container */

const STALE_MS = 60_000;

/** The rows GET /recaps returns; only the newest unopened one is offered. */
export function newestUnviewed(rows: readonly RecapListRow[] | undefined): RhythmRecapRow | null {
  for (const row of rows ?? []) {
    if (row.viewedAt === null && row.status === 'ready' && row._id) return { id: String(row._id), kind: row.kind };
  }
  return null;
}

export default function RhythmCard({ className }: { className?: string } = {}) {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  // There is no `rhythm` flag: GET /api/rhythm is ungated, so the card's own
  // gate is `insightsV2` -- the G-7 flag for the disclosed-insights surfaces.
  // While the answer is pending nothing is drawn at all: the flag is off in
  // production today, and a frame that appeared and then left would shift the
  // feed it sits above.
  const gate = useFeatureGate('insightsV2');
  const suggestionsOn = useFeature('rhythmSuggestions');
  const welcomeBackOn = useFeature('welcomeBack');

  // The first week belongs to the Get started card; this one takes its slot
  // once that window has passed. Decided before any read, as FirstWeekCard does.
  const createdAt = parseCreatedAt(user?.createdAt);
  const firstWeekOver = createdAt === null ? true : !isWithinWindow(createdAt, Date.now());
  const enabled = gate.enabled && !!user?._id && firstWeekOver;

  const rhythm = useQuery({
    queryKey: rhythmKeys.view(12),
    enabled,
    staleTime: STALE_MS,
    retry: false,
    queryFn: () => fetchRhythm(12),
  });

  const welcome = useQuery({
    queryKey: insightsKeys.welcomeBack(),
    enabled: enabled && welcomeBackOn,
    staleTime: STALE_MS,
    retry: false,
    queryFn: fetchWelcomeBack,
  });

  // The score rides the same flag as the card, so it needs no second gate;
  // a read that fails simply leaves the header without its number.
  const insights = useQuery({
    queryKey: insightsKeys.analytics(TREND_WINDOWS),
    enabled,
    staleTime: STALE_MS,
    retry: false,
    queryFn: () => fetchInsights(),
  });

  const recaps = useQuery({
    queryKey: ['recaps', 'home-unviewed'],
    enabled,
    staleTime: STALE_MS,
    retry: false,
    queryFn: async (): Promise<RecapListRow[]> => {
      const { data } = await api.get<{ recaps?: RecapListRow[] }>('/recaps', { params: { page: 1, limit: 5 } });
      return data?.recaps ?? [];
    },
  });

  const act = useMutation({
    mutationFn: (action: SuggestionAction) => {
      const id = rhythm.data?.suggestion?.id;
      if (!id) throw new Error('No suggestion');
      return actOnSuggestion(id, action);
    },
    onSuccess: (view) => {
      qc.setQueryData(rhythmKeys.view(12), view);
    },
  });

  const answer = useMutation({
    mutationFn: async (offer: WelcomeBackOffer | null) => {
      const record = welcome.data;
      if (!record) return;
      await ackWelcomeBack({
        id: record.id,
        action: offer?.action ?? 'seen',
        ...(offer?.countAsBreak ? { countAsBreak: true } : {}),
      });
    },
    onSuccess: () => {
      qc.setQueryData(insightsKeys.welcomeBack(), null);
      void qc.invalidateQueries({ queryKey: rhythmKeys.all });
    },
  });

  if (!enabled) return null;
  // A rhythm read that failed, or a server that does not run the route, leaves
  // Home exactly as it was: no skeleton, no error state, no empty card.
  if (rhythm.isError) return null;

  // A flagged block is dropped on its own 404 as well as on its flag; a block
  // still in flight is simply absent, which the fixed geometry absorbs.
  const welcomeRecord = welcomeBackOn && welcome.isSuccess && !isFeatureDisabled(welcome.error) ? welcome.data ?? null : null;
  const view = rhythm.data ?? null;
  const score = insights.isSuccess && !isFeatureDisabled(insights.error) ? insights.data?.score ?? null : null;
  const suggestionView =
    view && !(suggestionsOn && view.suggestion) ? { ...view, suggestion: null } : view;

  return (
    <RhythmCardView
      rhythm={suggestionView}
      welcomeBack={welcomeRecord}
      recap={newestUnviewed(recaps.data)}
      score={score}
      onSuggestion={(action) => act.mutate(action)}
      onWelcomeBack={(offer) => answer.mutate(offer)}
      busy={act.isPending || answer.isPending}
      className={className}
    />
  );
}
