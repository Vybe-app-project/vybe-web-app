/**
 * "Share a thing into this chat": the member's own logged sessions, saved
 * routines and recaps.
 *
 * Three kinds, not four. The API takes eight attachment types and a meal is
 * not one of them (`models/extensions/message/attachment.js
 * ATTACHMENT_TYPES`), so a Meals tab here would be a button that always
 * answered 400 ATTACHMENT_INVALID. The remaining five (post, session,
 * event, challenge, gym) have no "pick one of mine" list on the web and
 * reach a chat through their own Share controls.
 *
 * The trap this picker exists to avoid: `workout` and `routine` are two
 * different collections behind two words that mean nearly the same thing.
 * `workout` resolves a WorkoutLog — a session you actually did, from
 * `GET /workouts/logs`. `routine` resolves a SocialWorkout — a plan you
 * saved, from `GET /workouts/my`. Sending a routine id as a `workout` is a
 * 404 ATTACHMENT_NOT_FOUND, so each tab is wired to its own fetcher.
 *
 * Every list is a read the app already does, so opening the picker is
 * usually free: the same query keys the Train hub and Recaps use.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { api } from '../../lib/api';
import { SHARE_TAB_LABEL, SHAREABLE_FROM_WEB, type ShareCandidate, type ShareableType } from '../../lib/sharedCards';
import { fetchMyWorkoutsPage, type SocialWorkout } from '../workouts/model';
import { LOGS_KEY, fetchLogs, type WorkoutLog } from '../workouts/sessions';
import type { RecapListRow } from '../../lib/recapView';
import { Button, EmptyState, ErrorState, Modal, SegmentedControl, SkeletonRow, cx } from '../ui';
import { BookOpen, ClipboardList, Dumbbell, Sparkles, X } from '../icons';

const ICON: Record<ShareableType, typeof Dumbbell> = {
  workout: Dumbbell,
  routine: ClipboardList,
  recap: Sparkles,
};

const dayLabel = (iso?: string): string | undefined => {
  if (!iso) return undefined;
  try {
    const at = parseISO(iso);
    return Number.isNaN(at.getTime()) ? undefined : format(at, 'd MMM');
  } catch {
    return undefined;
  }
};

const countLabel = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;

const logCandidate = (log: WorkoutLog): ShareCandidate => ({
  type: 'workout',
  id: log._id,
  title: log.name || 'Workout',
  subtitle: [dayLabel(log.date), log.exercises?.length ? countLabel(log.exercises.length, 'exercise') : null].filter(Boolean).join(' · ') || undefined,
});

const routineCandidate = (workout: SocialWorkout): ShareCandidate => ({
  type: 'routine',
  id: workout._id,
  title: workout.title || 'Routine',
  subtitle: workout.exercises?.length ? countLabel(workout.exercises.length, 'exercise') : undefined,
});

const recapCandidate = (row: RecapListRow): ShareCandidate => ({
  type: 'recap',
  id: row._id,
  title: row.kind === 'month' ? 'Month in Vybe' : 'Your week',
  subtitle: row.periodLabel,
});

/** One tab's list, from the query the rest of the app already runs. */
function useCandidates(kind: ShareableType, enabled: boolean) {
  const logs = useQuery({ queryKey: LOGS_KEY, queryFn: fetchLogs, enabled: enabled && kind === 'workout' });
  const routines = useQuery({
    queryKey: ['workouts', 'mine', 'picker'],
    queryFn: async () => (await fetchMyWorkoutsPage(1)).items,
    enabled: enabled && kind === 'routine',
  });
  const recaps = useQuery({
    queryKey: ['recaps', 'list'],
    queryFn: async () => {
      const { data } = await api.get<{ recaps?: RecapListRow[] }>('/recaps', { params: { page: 1, limit: 20 } });
      return data.recaps || [];
    },
    enabled: enabled && kind === 'recap',
  });

  if (kind === 'workout') {
    return { query: logs, items: (logs.data?.workouts || []).map(logCandidate) };
  }
  if (kind === 'routine') {
    return { query: routines, items: (routines.data || []).map(routineCandidate) };
  }
  return { query: recaps, items: (recaps.data || []).map(recapCandidate) };
}

const EMPTY_COPY: Record<ShareableType, { title: string; message: string }> = {
  workout: { title: 'Nothing logged yet', message: 'Sessions you finish show up here to share.' },
  routine: { title: 'No routines yet', message: 'Save a workout and you can send it to anyone.' },
  recap: { title: 'No recaps yet', message: 'A recap arrives at the end of a week you trained.' },
};

export function SharePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (candidate: ShareCandidate) => void;
}) {
  const [kind, setKind] = useState<ShareableType>('workout');
  const { query, items } = useCandidates(kind, open);
  const Icon = ICON[kind];

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Share" description="Send one of your own things into this chat.">
      <div className="space-y-3">
        <SegmentedControl
          aria-label="What to share"
          fill
          size="sm"
          tabs={SHAREABLE_FROM_WEB.map((t) => ({ value: t, label: SHARE_TAB_LABEL[t] }))}
          value={kind}
          onChange={(v) => setKind(v as ShareableType)}
        />

        {query.isPending ? (
          <ul className="space-y-1" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i}>
                <SkeletonRow />
              </li>
            ))}
          </ul>
        ) : query.isError ? (
          <ErrorState error={query.error} title="Couldn’t load that list" onRetry={() => query.refetch()} className="py-4" />
        ) : items.length === 0 ? (
          <EmptyState size="sm" variant="first-run" icon={<Icon size={22} />} {...EMPTY_COPY[kind]} />
        ) : (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto" aria-label={SHARE_TAB_LABEL[kind]}>
            {items.map((candidate) => (
              <li key={`${candidate.type}-${candidate.id}`}>
                <button
                  type="button"
                  onClick={() => onPick(candidate)}
                  className="flex min-h-14 w-full items-center gap-3 px-1 text-left transition-colors dur-1 hover:bg-surface-2"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xs bg-surface-2 text-text-3">
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text-1">{candidate.title}</span>
                    {candidate.subtitle ? <span className="block truncate text-xs text-text-2">{candidate.subtitle}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/**
 * The chip over the composer once something is picked: what is about to be
 * sent, and the way to change your mind. One attachment per message (the
 * API takes one `attachment` object), so picking again replaces it.
 */
export function PendingAttachmentChip({ candidate, onClear }: { candidate: ShareCandidate; onClear: () => void }) {
  const Icon = ICON[candidate.type] || BookOpen;
  return (
    <div className={cx('mb-2 flex items-center gap-2 rounded-md border border-line bg-surface-2 p-2')}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xs bg-surface-3 text-text-3">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xs font-semibold text-text-2">{SHARE_TAB_LABEL[candidate.type]}</span>
        <span className="block truncate text-sm text-text-1">{candidate.title}</span>
      </span>
      <Button size="sm" variant="ghost" icon={<X size={16} />} onClick={onClear} aria-label="Remove attachment">
        Remove
      </Button>
    </div>
  );
}
