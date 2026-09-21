import { Link } from 'react-router-dom';
import { ArrowRight, Check, Clock } from '../../../components/icons';
import { formatStat } from '../../../components/ui';
import { TRAIN } from '../sheet';
import { formatElapsed, isEmptySession } from './math';
import { sessionStats, useActiveSession, useSessionClock } from './store';

/**
 * "Session in progress · 12:34 · 5 sets" at the top of the Train hub and
 * History while a draft is open. One hairline row, 44 px, no card: the
 * session is already the hub's prominent button, and this only says that one
 * is running and how far in. It renders nothing when there is no session, so
 * the page's geometry is identical for the member who has none.
 */
export function SessionResumeBar() {
  const session = useActiveSession();
  const now = useSessionClock(Boolean(session));
  if (!session || isEmptySession(session)) return null;
  const stats = sessionStats(session, now);
  const parts = [
    stats.elapsedMs > 0 ? formatElapsed(stats.elapsedMs) : null,
    stats.setCount > 0 ? `${formatStat(stats.setCount)} ${stats.setCount === 1 ? 'set' : 'sets'}` : null,
  ].filter(Boolean);
  return (
    <Link
      to={TRAIN.liveSession()}
      viewTransition
      className="pressable flex min-h-11 items-center gap-2 rounded-sm border-b border-line px-1 text-sm"
      aria-label={`Back to your session in progress${parts.length ? `, ${parts.join(', ')}` : ''}`}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 text-text-2">
        <Clock size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold text-text-1">Session in progress</span>
        {parts.length ? <span className="t-meta tabular"> · {parts.join(' · ')}</span> : null}
        {stats.setCount > 0 ? (
          <span aria-hidden="true" className="ml-1 inline-flex align-middle text-text-2">
            <Check size={13} />
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1 font-semibold text-brand">
        Resume <ArrowRight size={14} />
      </span>
    </Link>
  );
}
