import { Link } from 'react-router-dom';
import {
  daysLeftLabel,
  daysLeftUrgent,
  groupGoalLine,
  hasStanding,
  progressLine,
  standingLabel,
  type ChallengeStanding,
} from '../../lib/challenges';
import { Badge, Skeleton, Spinner, cx, formatStat } from '../../components/ui';
import { Flame, Target, Trophy } from '../../components/icons';

/**
 * A challenge as a row (P8a). The research's ask, in one line of copy each:
 * **where you stand**, **how far along you are** and **how long is left** —
 * and Join without opening anything.
 *
 * The register is the Train hub's rows: 72 px, a monochrome glyph tile, a
 * `.t-name` title, a `.t-meta` fact line, and one blue *text* action on the
 * right ("Join", the way a suggested row says "Follow"). No progress bar: a
 * bar is a second reading of a number the line already gives, and it reads
 * as decoration on a list of ten.
 *
 * Pure props, no query and no store, so tests/challenges-v2.render.test.mjs
 * can render every state through react-dom/server.
 *
 * The zero rule bites twice here. A member with a seat but no counted day
 * has **no standing** — `me.rank` is null until the first entry, and the row
 * says "Joined" rather than "#0" or "last". And a challenge nobody has
 * joined prints its goal, never "0 of 20".
 */

/** What a row needs off `GET /challenges` or `GET /challenges/user`. */
export type ChallengeRowData = ChallengeStanding & {
  _id: string;
  title: string;
  goal: number;
  mode?: string;
  ownership?: 'user' | 'system' | 'vybe';
  isActive?: boolean;
  maxParticipants?: number;
  stats?: { totalParticipants?: number };
  participants?: unknown[];
};

/** The blue text action at the end of a row — the same string the Train hub's "Start" uses. */
const ROW_ACTION =
  'pressable -mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2 text-sm font-semibold text-brand';

const ROW = 'relative flex min-h-18 items-center gap-3 py-2';

/** Seated participants, from whichever of the two shapes the row carries. */
export function participantCountOf(challenge: ChallengeRowData): number {
  const fromStats = Number(challenge.stats?.totalParticipants);
  if (Number.isFinite(fromStats) && fromStats > 0) return fromStats;
  const fromArray = challenge.participants?.length ?? 0;
  return fromArray;
}

/**
 * The row's fact line: how far along, how long is left, and how many people
 * — in that order, and only the parts that are true. A joined row leads with
 * the member's own number; an open one leads with the goal, because "0 of
 * 20" is a hole and "Goal: 20 sessions" is a fact.
 */
export function factLine(challenge: ChallengeRowData, unit: string): string {
  const joined = challenge.me?.joined === true;
  const group = groupGoalLine(challenge.groupGoal, unit);
  const mine = joined ? progressLine(challenge.me?.progress, challenge.goal, unit) : null;
  const goal = unit ? `Goal: ${formatStat(challenge.goal)} ${unit}` : `Goal: ${formatStat(challenge.goal)}`;
  const people = participantCountOf(challenge);
  const left = daysLeftLabel(challenge.daysLeft);
  return [
    group ?? mine ?? goal,
    left,
    people > 0 ? `${formatStat(people)} in` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ChallengeRow({
  challenge,
  unit,
  to,
  onJoin,
  joining = false,
  /** Open to this viewer: not joined, not closed, not full, and scored. */
  canJoin = false,
}: {
  challenge: ChallengeRowData;
  /** Already resolved with `unitLabel`; empty when a custom unit has no label. */
  unit: string;
  to: string;
  onJoin?: () => void;
  joining?: boolean;
  canJoin?: boolean;
}) {
  const joined = challenge.me?.joined === true;
  const standing = standingLabel(challenge.me, participantCountOf(challenge));
  const urgent = daysLeftUrgent(challenge.daysLeft);
  const isGroupGoal = challenge.mode === 'group_goal';

  return (
    <li className={cx(ROW, 'pressable rounded-sm')}>
      <Link
        to={to}
        viewTransition
        aria-label={`Open ${challenge.title}`}
        className="absolute inset-0 z-[1] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      />
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-text-2"
      >
        {isGroupGoal ? <Target size={22} /> : <Trophy size={22} />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="t-name flex min-w-0 items-center gap-1.5">
          <span className="truncate text-text-1">{challenge.title}</span>
          {challenge.ownership === 'vybe' ? (
            <Badge tone="info" size="sm">
              Vybe
            </Badge>
          ) : challenge.ownership === 'system' ? (
            <Badge tone="info" size="sm">
              Official
            </Badge>
          ) : null}
        </p>
        <p className={cx('t-meta tabular truncate', urgent && 'text-accent-text')}>
          {urgent ? <Flame size={12} className="mr-1 inline-block align-[-1px]" /> : null}
          {factLine(challenge, unit)}
        </p>
        {/* The standing is the row's own news, so it gets its own line — and
            it is absent, not zeroed, until the first counted day. */}
        {standing ? (
          <p className={cx('t-meta tabular truncate', hasStanding(challenge.me) ? 'font-semibold text-text-1' : 'text-text-3')}>
            {standing}
          </p>
        ) : null}
      </div>

      <div className="relative z-[2] flex shrink-0 items-center">
        {canJoin && !joined && onJoin ? (
          <button type="button" onClick={onJoin} disabled={joining} aria-label={`Join ${challenge.title}`} className={ROW_ACTION}>
            {joining ? <Spinner size={16} /> : null}
            Join
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Hairline-separated rows, the same list geometry the Train hub uses. */
export function ChallengeRowList({ children, ...rest }: { children: React.ReactNode } & React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className="divide-y divide-line" {...rest}>
      {children}
    </ul>
  );
}

/** The same 72 px geometry, so the list never shifts when it fills. */
export function ChallengeRowSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className={ROW}>
          <Skeleton className="h-12 w-12 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-10" />
        </li>
      ))}
    </ul>
  );
}
