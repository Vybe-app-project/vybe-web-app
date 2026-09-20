/**
 * The Get started card on Home for a member's first week
 * (design-first-week-and-people.md §3.1, §4): a day line ("Day 3 of your
 * first week"), the one step worth doing today, the other open steps, and
 * the finished ones collapsed to a single line. "Log a workout" opens "Your
 * first session" until the first log exists: Start here (the seeded premade
 * "Foundation Full Body", read from the premade catalogue) or Start empty.
 * The card leaves after day 7, on dismissal (Undo in the toast), or once
 * every step this API can judge is done. No push, no countdown, no confetti.
 *
 * Three exports: `FirstWeekCardView` and `StarterSessionChoices` render from
 * props only (tests/first-week-card.render.test.mjs mounts them under
 * react-dom/server, where the Modal portal and a signed-in store do not
 * exist); the default `FirstWeekCard` owns every hook and every read.
 *
 * Reads: GET /users/me (through useAuth), /workouts/logs, /gyms/community/
 * my-communities, /meals/streak, /achievements/user (a second vote, as on
 * mobile) and the premade catalogue for the starter. No Wave F flag gates
 * this card and no flagged route is called; the only switch is the optional
 * kill switch `features.getStartedCard === false` (absent = on; the flag is
 * not seeded, so useFeature would read it as off for ever). Until
 * /capabilities has answered the switch is undecided and nothing renders,
 * so a switched-off card never flashes its skeleton on a cold load.
 */
import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, parseApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCapabilities } from '../lib/capabilities';
import {
  START_EMPTY_HREF,
  STARTER_HREF,
  STEP_HREFS,
  buildSteps,
  cardRows,
  clearDismissed,
  decideCard,
  firstWeekDay,
  firstWeekStrings,
  followingCountOf,
  normalizeAchievement,
  nothingAnswered,
  parseCreatedAt,
  pickStarterTemplate,
  progressOf,
  readDismissedAt,
  SOURCE_ERROR,
  SOURCE_NOT_DEPLOYED,
  sourceValue,
  starterMinutes,
  starterOffered,
  writeDismissed,
  type AchievementLike,
  type Progress,
  type SourceReading,
  type StarterTemplateLike,
  type StepKey,
} from '../lib/firstWeek';
import { MY_ACHIEVEMENTS_KEY, fetchMyAchievements } from '../lib/useMyAchievements';
import { localDayParams } from '../lib/timezone';
import { Badge, Button, ButtonLink, Card, IconButton, Modal, Ring, Skeleton, cx, useOnline, useToast } from './ui';
import { CheckCircle, ChevronRight, Dumbbell, MapPin, Play, Plus, Users, Utensils, X, type IconProps } from './icons';
import type { SocialWorkout } from './Workouts';

const strings = firstWeekStrings;

const ROW_ICONS: Readonly<Record<StepKey, ComponentType<IconProps>>> = {
  'first-move': Dumbbell,
  'social-spark': Users,
  'join-gym': MapPin,
  'first-meal': Utensils,
};

/* ------------------------------------------------------------------- view */

export type FirstWeekRow = {
  key: StepKey;
  isToday: boolean;
  href: string;
};

export type FirstWeekCardState = 'ready' | 'loading' | 'error' | 'offline';

export type FirstWeekCardViewProps = {
  /** "Day 3 of your first week"; null hides the line. */
  dayLine: string | null;
  /** Open rows in display order. */
  rows: readonly FirstWeekRow[];
  /** Titles of the finished steps, collapsed to one muted line. */
  doneTitles: readonly string[];
  progress: Progress;
  state: FirstWeekCardState;
  /** Receives the dismiss button's click, so the container can move focus before the card leaves. */
  onDismiss: (event: MouseEvent<HTMLButtonElement>) => void;
  /** While true the "Log a workout" row is a button that opens the starter dialog instead of a link. */
  starterOffered?: boolean;
  onOpenStarter?: () => void;
  onRetry?: () => void;
  /** True while a retry's reads are in flight: the Retry button shows busy and ignores a second press. */
  isRetrying?: boolean;
};

const ROW_CLASS =
  'flex w-full min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors dur-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function RowBody({ row }: { row: FirstWeekRow }) {
  const Icon = ROW_ICONS[row.key];
  const copy = strings.steps[row.key];
  return (
    <>
      <span
        aria-hidden="true"
        className={cx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          row.isToday ? 'bg-brand text-on-brand' : 'bg-surface-2 text-text-2',
        )}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-1">{copy.title}</span>
        <span className="block text-xs text-text-2">{copy.body}</span>
      </span>
      {row.isToday ? (
        <Badge tone="brand" data-testid="first-week-today-tag">
          {strings.today}
        </Badge>
      ) : null}
      <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-text-3" />
    </>
  );
}

export function FirstWeekCardView({
  dayLine,
  rows,
  doneTitles,
  progress,
  state,
  onDismiss,
  starterOffered: offered = false,
  onOpenStarter,
  onRetry,
  isRetrying = false,
}: FirstWeekCardViewProps) {
  const titleId = useId();
  return (
    <Card data-testid="first-week-card" role="region" aria-labelledby={titleId}>
      <div className="flex items-start gap-3">
        <div aria-hidden="true" className="shrink-0">
          <Ring value={progress.done} max={progress.total} size={48} stroke={5} color="brand" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="type-heading text-lg text-text-1">
            {strings.card.title}
          </h2>
          {dayLine ? (
            <p data-testid="first-week-day-line" className="text-xs text-text-2">
              {dayLine}
            </p>
          ) : null}
          <p className="text-xs text-text-3">{strings.card.progress(progress.done, progress.total)}</p>
        </div>
        <IconButton label={strings.dismiss.label} size={40} onClick={onDismiss} data-testid="first-week-dismiss">
          <X size={18} />
        </IconButton>
      </div>

      {state === 'loading' ? (
        <div role="status" aria-busy="true" aria-live="polite" className="mt-3 space-y-2">
          <span className="sr-only">{strings.states.loading}</span>
          <Skeleton className="h-12 rounded-md" />
          <Skeleton className="h-12 rounded-md" />
        </div>
      ) : null}

      {state === 'offline' ? <p className="mt-3 text-sm text-text-2">{strings.states.offline}</p> : null}

      {state === 'error' ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-2">{strings.states.error}</p>
          <Button variant="secondary" size="sm" aria-label={strings.states.retryLabel} loading={isRetrying} onClick={onRetry}>
            {strings.states.retry}
          </Button>
        </div>
      ) : null}

      {state === 'ready' ? (
        <>
          <ul className="mt-3 -mx-3 space-y-1" aria-label={strings.card.title}>
            {rows.map((row) => {
              const testId = `first-week-row-${row.key}`;
              const cls = cx(ROW_CLASS, row.isToday ? 'bg-brand-soft hover:bg-brand-soft' : 'hover:bg-surface-2');
              return (
                <li key={row.key}>
                  {row.key === 'first-move' && offered && onOpenStarter ? (
                    <button type="button" className={cls} onClick={onOpenStarter} aria-haspopup="dialog" data-testid={testId}>
                      <RowBody row={row} />
                    </button>
                  ) : (
                    <Link to={row.href} viewTransition className={cls} data-testid={testId}>
                      <RowBody row={row} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {doneTitles.length ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-text-3" data-testid="first-week-done-line">
              <CheckCircle size={16} aria-hidden="true" className="shrink-0 text-brand" />
              <span>{strings.card.doneLine(doneTitles)}</span>
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------------------- starter choices */

export type StarterSessionChoicesProps = {
  /** The catalogue's starter entry, null when the catalogue lacks it or could not be read, 'loading' while it is read. */
  template: StarterTemplateLike | null | 'loading';
  onClose?: () => void;
};

/**
 * The body of "Your first session": Start here (when the catalogue has it)
 * and Start empty. Neither link overrides its name: the visible text is the
 * accessible name, so "click Start here" works for speech input (WCAG 2.5.3).
 */
export function StarterSessionChoices({ template, onClose }: StarterSessionChoicesProps) {
  const copy = strings.starter;
  const minutes = starterMinutes(template === 'loading' ? null : template);
  const choice = 'justify-start whitespace-normal py-3 text-left';
  return (
    <div className="space-y-3">
      {template === 'loading' ? (
        <div role="status" aria-busy="true" aria-live="polite" className="rounded-md bg-surface-2 p-4" data-testid="starter-loading">
          <span className="sr-only">{copy.loading}</span>
          <Skeleton className="mb-2 h-4 w-1/2" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ) : template ? (
        <ButtonLink
          to={STARTER_HREF}
          variant="primary"
          size="lg"
          block
          className={choice}
          icon={<Play size={22} aria-hidden="true" className="shrink-0" />}
          onClick={onClose}
          data-testid="starter-start-here"
        >
          <span className="min-w-0 flex-1">
            <span className="block">{copy.title(minutes)}</span>
            <span className="block text-xs font-normal">{copy.body(minutes)}</span>
          </span>
        </ButtonLink>
      ) : (
        <p className="text-sm text-text-2" data-testid="starter-unavailable">
          {copy.unavailable}
        </p>
      )}
      <ButtonLink
        to={START_EMPTY_HREF}
        variant="secondary"
        size="lg"
        block
        className={choice}
        icon={<Plus size={22} aria-hidden="true" className="shrink-0" />}
        onClick={onClose}
        data-testid="starter-start-empty"
      >
        <span className="min-w-0 flex-1">
          <span className="block">{copy.empty}</span>
          <span className="block text-xs font-normal text-text-2">{copy.emptyBody}</span>
        </span>
      </ButtonLink>
    </div>
  );
}

/* --------------------------------------------------------------- container */

type QueryLike<T> = { isSuccess: boolean; isError: boolean; data: T | undefined; error: unknown };

/** A settled query as a source reading; null while it is still pending. A 404 means the route is not on this API. */
function readingOf<T>(query: QueryLike<T>): SourceReading<T> | null {
  if (query.isSuccess) return sourceValue(query.data as T);
  if (query.isError) return parseApiError(query.error).status === 404 ? SOURCE_NOT_DEPLOYED : SOURCE_ERROR;
  return null;
}

const STALE_MS = 5 * 60_000;

const asCount = (value: unknown, fallback: unknown): number => {
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  return Array.isArray(fallback) ? fallback.length : 0;
};

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus on the page when the card leaves: the first rendered
 * focusable element after `root` in document order (on Home, the composer's
 * "Share a session…" field, right where the card was), else the shell's main
 * landmark. Called while the dismiss button still holds focus; without it
 * focus falls to <body> and the toast's Undo sits at the far end of the DOM.
 */
function focusAfter(root: Element | null): void {
  if (typeof document === 'undefined') return;
  const next = root
    ? Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
        (el) => !root.contains(el) && (root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && el.getClientRects().length > 0,
      )
    : undefined;
  (next ?? document.getElementById('main'))?.focus();
}

export default function FirstWeekCard() {
  const user = useAuth((s) => s.user);
  const refreshUser = useAuth((s) => s.refreshUser);
  const online = useOnline();
  const toast = useToast();
  const capabilities = useCapabilities();
  const [starterOpen, setStarterOpen] = useState(false);
  const [dismissVersion, setDismissVersion] = useState(0);
  /** Set by Undo: once the card is back, focus returns to its dismiss button, where it was. */
  const restoreFocus = useRef(false);

  const userId = user?._id ? String(user._id) : null;
  const createdAt: unknown = user?.createdAt;
  const storage = useMemo(browserStorage, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dismissedAt = useMemo(() => readDismissedAt(storage, userId), [storage, userId, dismissVersion]);
  // Pending counts as off: nothing renders until the switch has answered
  // (Achievements gates on the same query the same way). The shell caches the
  // answer for five minutes, so after the first paint this costs nothing.
  const featureOff = capabilities.isPending || capabilities.data?.features?.getStartedCard === false;
  const now = Date.now();

  // Decide before reading anything: a day-9 account, a dismissed card, an
  // undecided switch or the kill switch make no request at all.
  const pre = decideCard({ userId, createdAt, now, dismissedAt, steps: null, featureOff });
  const enabled = pre.show;

  // A follow made this session is not in the cached user; refresh once on mount (throttled inside auth.ts).
  useEffect(() => {
    if (enabled) void refreshUser();
  }, [enabled, refreshUser]);

  const logs = useQuery({
    queryKey: ['first-week', 'logs'],
    enabled,
    staleTime: STALE_MS,
    retry: false,
    queryFn: async (): Promise<number> => {
      const { data } = await api.get('/workouts/logs', { params: { page: 1, limit: 1 } });
      return asCount(data?.total, data?.workouts);
    },
  });
  const communities = useQuery({
    queryKey: ['first-week', 'communities'],
    enabled,
    staleTime: STALE_MS,
    retry: false,
    queryFn: async (): Promise<number> => {
      const { data } = await api.get('/gyms/community/my-communities', { params: { page: 1, limit: 1 } });
      return asCount(data?.data?.pagination?.totalGymCommunities, data?.data?.gymCommunities);
    },
  });
  const meals = useQuery({
    queryKey: ['first-week', 'meals'],
    enabled,
    staleTime: STALE_MS,
    retry: false,
    queryFn: async (): Promise<{ lastLoggedDate: string | null }> => {
      // Only `lastLoggedDate` is kept: the route's `message` can carry streak copy this card never shows.
      const { data } = await api.get('/meals/streak', { params: localDayParams() });
      return { lastLoggedDate: typeof data?.lastLoggedDate === 'string' ? data.lastLoggedDate : null };
    },
  });
  const achievements = useQuery({
    queryKey: MY_ACHIEVEMENTS_KEY,
    enabled,
    staleTime: STALE_MS,
    retry: false,
    queryFn: fetchMyAchievements,
    select: (rows): AchievementLike[] => rows.map(normalizeAchievement).filter((a): a is AchievementLike => a !== null),
  });
  const premade = useQuery({
    queryKey: ['workouts', 'premade'],
    enabled: starterOpen,
    staleTime: STALE_MS,
    retry: false,
    queryFn: async (): Promise<SocialWorkout[]> => {
      const { data } = await api.get<{ workouts?: SocialWorkout[] }>('/workouts/commom/workouts/all/premade/fetch');
      return data.workouts ?? [];
    },
  });

  const readings = {
    workoutLogs: readingOf(logs),
    communities: readingOf(communities),
    meals: readingOf(meals),
    achievements: readingOf(achievements),
  };
  // Judge only once every source has settled (a value, a 404 or a failure), so
  // a row never flips from "to do" to "done" as answers trickle in.
  const steps =
    readings.workoutLogs && readings.communities && readings.meals && readings.achievements
      ? buildSteps({
          workoutLogs: readings.workoutLogs,
          communities: readings.communities,
          meals: readings.meals,
          achievements: readings.achievements,
          following: followingCountOf(user),
        })
      : null;

  const decision = decideCard({ userId, createdAt, now, dismissedAt, steps, featureOff });

  // After Undo the card is mounted again; put focus back on its dismiss button
  // (the toast's Undo has just unmounted from under the keyboard).
  useEffect(() => {
    if (!restoreFocus.current || !decision.show) return;
    restoreFocus.current = false;
    document.querySelector<HTMLElement>('[data-testid="first-week-dismiss"]')?.focus();
  }, [decision.show]);

  if (!decision.show || !userId) return null;

  const createdAtMs = parseCreatedAt(createdAt) ?? now;
  const day = firstWeekDay(createdAtMs, now);
  const rows = steps ? cardRows(steps, day) : null;
  // Day 1 with only "Follow someone" left: the WelcomeSheet already covers people; the card returns on day 2.
  if (rows && rows.open.length === 0) return null;

  const state: FirstWeekCardState = !steps
    ? online
      ? 'loading'
      : 'offline'
    : nothingAnswered(steps)
      ? online
        ? 'error'
        : 'offline'
      : 'ready';

  const dismiss = (event: MouseEvent<HTMLButtonElement>) => {
    // Move focus first, while the card (the region around the button) is still in the DOM.
    focusAfter(event.currentTarget.closest('[role="region"]'));
    writeDismissed(storage, userId, Date.now());
    setDismissVersion((v) => v + 1);
    toast.info(strings.dismiss.toast, {
      action: {
        label: strings.dismiss.undo,
        onClick: () => {
          clearDismissed(storage, userId);
          restoreFocus.current = true;
          setDismissVersion((v) => v + 1);
        },
      },
    });
  };

  const retry = () => {
    void logs.refetch();
    void communities.refetch();
    void meals.refetch();
    void achievements.refetch();
  };
  // A failed query keeps status 'error' while it refetches, so the state stays
  // 'error'; the Retry button carries the busy signal instead.
  const isRetrying = logs.isFetching || communities.isFetching || meals.isFetching || achievements.isFetching;

  const template: StarterTemplateLike | null | 'loading' = premade.isSuccess ? pickStarterTemplate(premade.data) : premade.isError ? null : 'loading';

  return (
    <>
      <FirstWeekCardView
        dayLine={strings.day(day)}
        rows={(rows?.open ?? []).map((key) => ({ key, isToday: rows?.today === key, href: STEP_HREFS[key] }))}
        doneTitles={(rows?.done ?? []).map((key) => strings.steps[key].title)}
        progress={steps ? progressOf(steps) : { done: 0, total: 4 }}
        state={state}
        onDismiss={dismiss}
        starterOffered={steps ? starterOffered(steps) : false}
        onOpenStarter={() => setStarterOpen(true)}
        onRetry={retry}
        isRetrying={isRetrying}
      />
      <Modal open={starterOpen} onClose={() => setStarterOpen(false)} title={strings.starter.sheetTitle} size="sm">
        <StarterSessionChoices template={template} onClose={() => setStarterOpen(false)} />
      </Modal>
    </>
  );
}
