import { Link } from 'react-router-dom';
import {
  boardRows,
  metricLabel,
  pinnedBoardRow,
  type ChallengeActor,
  type ChallengeBoard as Board,
  type ChallengeBoardEntry,
} from '../../lib/challenges';
import { Avatar, Badge, EmptyState, Skeleton, cx, formatStat } from '../../components/ui';
import { Medal, Target, Trophy, Users } from '../../components/icons';
import { timeAgo } from '../../lib/hooks';

/**
 * The board (P8a). The one thing the research asked for and no leaderboard
 * in this category does: **you can see yourself without scrolling.** The
 * server does the work — `GET /board?around=me` sends `me` on every read and
 * the five ranked rows either side of the viewer when they sit outside the
 * top ten — and this component draws the viewer's row pinned above the list
 * when it is not in the visible slice, then the top ten, then a gap marker,
 * then the neighbourhood.
 *
 * A Group Goal has no ranks, ever (design §5.2): it draws the pooled total
 * against the target and the people who contributed, unranked. A known minor
 * reads their own row alone (`justMe`, D-91) and the screen says so.
 *
 * Pure props. The zero rule: a member with no counted day has no rank, so no
 * pinned row is drawn and the pane offers the next action instead.
 */

const MEDAL: Record<number, { className: string; label: string }> = {
  1: { className: 'text-warning-text', label: 'First place' },
  2: { className: 'text-text-2', label: 'Second place' },
  3: { className: 'text-accent-text', label: 'Third place' },
};

const nameOf = (user: ChallengeActor | null): string => user?.fullName || user?.username || 'Vybe athlete';

function BoardRow({ entry, unit, pinned = false }: { entry: ChallengeBoardEntry; unit: string; pinned?: boolean }) {
  const medal = MEDAL[entry.rank];
  const name = entry.isMe ? 'You' : nameOf(entry.user);
  return (
    <li
      aria-current={entry.isMe ? 'true' : undefined}
      className={cx(
        'flex items-center gap-3 px-3 py-2.5',
        entry.isMe ? 'bg-brand-soft' : pinned ? 'bg-surface-2' : undefined,
        pinned ? 'rounded-md' : undefined,
      )}
    >
      <span className="flex w-8 shrink-0 items-center justify-center">
        {medal && !pinned ? (
          <Medal size={22} filled className={medal.className} aria-label={medal.label} aria-hidden={false} role="img" />
        ) : (
          <span className="t-name tabular text-text-2">{entry.rank}</span>
        )}
      </span>
      <Avatar src={entry.user?.avatar} name={nameOf(entry.user)} size="sm" seed={entry.user?._id} ring={entry.isMe} />
      <p className="t-name min-w-0 flex-1 truncate text-text-1">
        <span className="truncate">{name}</span>
      </p>
      <span className="t-name tabular shrink-0 text-text-1">
        {formatStat(entry.score)}
        {unit ? <span className="t-meta ml-1 font-semibold">{unit}</span> : null}
      </span>
    </li>
  );
}

export function ChallengeBoardSkeleton() {
  return (
    <div className="space-y-1.5" aria-busy="true" aria-label="Loading the board">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-4 w-4 rounded-xs" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-10" />
        </div>
      ))}
    </div>
  );
}

/** The pooled pane of a Group Goal: the total, the viewer's part, the contributors. */
function GroupGoalPane({ board, unit }: { board: Board; unit: string }) {
  const goal = board.groupGoal;
  if (!goal) return null;
  const reached = goal.total >= goal.target && goal.target > 0;
  return (
    <div className="space-y-4">
      <div>
        <p className="t-metric text-text-1">
          {formatStat(goal.total)}
          <span className="text-text-3"> / {formatStat(goal.target)}</span>
        </p>
        <p className="t-meta">
          {unit ? `${unit} together` : 'together'}
          {reached ? ' · Goal reached' : null}
          {goal.reachedAt ? ` ${timeAgo(goal.reachedAt)}` : null}
        </p>
      </div>
      {goal.myPart > 0 ? (
        <p className="t-body text-text-2">
          Your part: <span className="tabular font-semibold text-text-1">{formatStat(goal.myPart)}</span>
        </p>
      ) : (
        <p className="t-body text-text-2">Log a session and your part shows up here.</p>
      )}
      {goal.contributors.length ? (
        <div>
          <p className="t-section mb-1 text-text-1">Who has counted</p>
          <ul className="divide-y divide-line">
            {goal.contributors.map((row) => (
              <li key={row.user._id} className="flex items-center gap-3 py-2.5">
                <Avatar src={row.user.avatar} name={nameOf(row.user)} size="sm" seed={row.user._id} />
                <p className="t-body min-w-0 flex-1 truncate text-text-1">{nameOf(row.user)}</p>
                {row.lastAt ? <span className="t-meta shrink-0">{timeAgo(row.lastAt)}</span> : null}
                <span className="t-name tabular shrink-0 text-text-1">{formatStat(row.score)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ChallengeBoardPane({
  board,
  me,
  /** Already resolved: the metric's word ("sessions", "minutes"). */
  unit,
  onLogSession,
}: {
  board: Board;
  me: ChallengeActor | null;
  unit?: string;
  onLogSession?: () => void;
}) {
  const word = unit ?? metricLabel(board.metric);
  if (board.mode === 'group_goal') return <GroupGoalPane board={board} unit={word} />;

  const pinned = pinnedBoardRow(board, me);
  const { entries, around, gap } = boardRows(board);

  if (board.justMe) {
    return (
      <div className="space-y-3">
        <p className="t-body text-text-2">Standings are off for your account, so this board shows your own row only.</p>
        <ul>
          <BoardRow
            entry={{ rank: board.me.rank ?? 0, user: me, score: board.me.score, isMe: true }}
            unit={word}
            pinned
          />
        </ul>
      </div>
    );
  }

  if (!entries.length) {
    return (
      <EmptyState
        size="sm"
        icon={<Trophy size={24} />}
        title="Nobody has counted a day yet"
        message="The board fills in as people train. A logged session is all it takes."
        action={onLogSession ? { label: 'Log a session', onClick: onLogSession, variant: 'secondary' } : undefined}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Your row, above the fold, whatever your rank. */}
      {pinned ? (
        <div>
          <p className="t-meta mb-1.5">Where you stand</p>
          <ul>
            <BoardRow entry={pinned} unit={word} pinned />
          </ul>
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {entries.map((entry) => (
          <BoardRow key={`top-${entry.rank}-${entry.user?._id ?? 'me'}`} entry={entry} unit={word} />
        ))}
      </ul>

      {around.length ? (
        <>
          {gap ? (
            <p className="t-meta px-3 text-center" aria-hidden="true">
              ⋯
            </p>
          ) : null}
          <ul className="divide-y divide-line">
            {around.map((entry) => (
              <BoardRow key={`near-${entry.rank}-${entry.user?._id ?? 'me'}`} entry={entry} unit={word} />
            ))}
          </ul>
        </>
      ) : null}

      <p className="t-meta inline-flex items-center gap-1.5">
        <Users size={14} /> {formatStat(board.participants)} {board.participants === 1 ? 'person' : 'people'} in
        {board.range.weekKey ? ` · week to ${new Date(board.range.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null}
      </p>
    </div>
  );
}

/**
 * The legacy leaderboard drawn as the same list: the fallback for a v2
 * challenge whose board the viewer may not read yet. The viewer's row is
 * pinned above it on the same rule — only when it exists and only when it
 * is out of sight.
 */
export function ChallengeLeaderboardList({
  entries,
  unit,
  /** How many rows are visible without scrolling; below that, pin. */
  visible = 10,
}: {
  entries: ChallengeBoardEntry[];
  unit: string;
  visible?: number;
}) {
  const index = entries.findIndex((entry) => entry.isMe);
  const pinned = index >= visible ? entries[index] : null;
  return (
    <div className="space-y-3">
      {pinned ? (
        <div>
          <p className="t-meta mb-1.5">Where you stand</p>
          <ul>
            <BoardRow entry={pinned} unit={unit} pinned />
          </ul>
        </div>
      ) : null}
      <ul className="divide-y divide-line">
        {entries.map((entry) => (
          <BoardRow key={`legacy-${entry.rank}-${entry.user?._id ?? 'me'}`} entry={entry} unit={unit} />
        ))}
      </ul>
    </div>
  );
}

/** The Stats pane's "your share" tile needs the pooled target to mean anything. */
export function GroupTargetLine({ board }: { board: Board }) {
  if (board.mode !== 'group_goal' || !board.groupGoal) return null;
  return (
    <p className="t-meta inline-flex items-center gap-1.5">
      <Target size={14} /> {formatStat(board.groupGoal.total)} of {formatStat(board.groupGoal.target)} together
    </p>
  );
}

/** A completed challenge's trophy line, with the badge tone the design gives a finished thing. */
export function ChallengeAward({ finished, to }: { finished: boolean; to: string }) {
  if (!finished) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="success">
        <Trophy size={12} /> Finished
      </Badge>
      <Link to={to} viewTransition className="t-body font-semibold text-brand-text hover:underline">
        See it on your achievements
      </Link>
    </div>
  );
}
