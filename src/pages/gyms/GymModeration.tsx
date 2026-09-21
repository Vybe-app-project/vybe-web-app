import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { errMsg } from '../../lib/api';
import {
  type ModerationAction,
  type ModerationLogEntry,
  type ModerationTargetKind,
  type QueueItem,
  actOnModeration,
  actionsFor,
  appealsOf,
  clientRequestId,
  decideAppeal,
  gymV2Keys,
  isFeatureDisabled,
} from '../../lib/gymCommunityV2';
import { useModerationLog, useModerationQueue } from './useGymV2';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, Menu, Modal, SegmentedControl, Skeleton, SkeletonRow, cx, humanize, useToast, type MenuItem } from '../ui';
import { Shield } from '../icons';

/**
 * The moderation queue, the appeals and the log — one section under the
 * Members tab, for moderators, admins and the owner
 * (`gymModerationQueue`; design-gym-community-v2.md §5.3).
 *
 * Every read goes through `absentOnRefusal`, so with the flag off (or for a
 * member who is not a moderator) the whole section is absent: `useGymV2`
 * resolves `null` and this renders nothing at all.
 *
 * Each row offers only the rungs of the API's ladder its target kind and the
 * viewer's role allow (`actionsFor`), and the punitive ones ask for the
 * numbered community rule the API requires before they are sent — a
 * `RULE_REQUIRED` 400 is a bug in the client, not something to show a person.
 * Actions are keyed on a `clientRequestId`, so a retry replays.
 */

const ago = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

const PUNITIVE = new Set<ModerationAction>(['collapse', 'remove', 'mute', 'remove_member']);

/** "2 reports about a post", "A first post waiting for review": what the row is, in words. */
export function queueItemLine(item: QueueItem): string {
  if (item.kind === 'held_post') {
    const why =
      item.heldReason === 'new_member_hold'
        ? 'A new member’s first post is waiting for review'
        : item.heldReason === 'slow_mode'
          ? 'A post held by slow mode'
          : 'A post the filter held for review';
    return why;
  }
  const count = item.reportCount || item.reportIds?.length || 1;
  const what = String(item.target?.type || 'post').toLowerCase();
  const subject = what === 'comment' ? 'a comment' : what === 'user' || what === 'member' ? 'a member' : 'a post';
  return count === 1 ? `1 report about ${subject}` : `${count} reports about ${subject}`;
}

/** The target an action names: the report when there is one, else the post, else the member. */
export function targetFor(item: QueueItem, action: ModerationAction): { kind: ModerationTargetKind; id: string } | null {
  const memberId = item.member?.user?._id ? String(item.member.user._id) : null;
  const postId = item.target?.id ? String(item.target.id) : null;
  const reportId = item.reportIds?.[0] || (item.kind === 'report' ? item.id : null);
  if (action === 'mute' || action === 'remove_member') {
    if (reportId && item.kind === 'report') return { kind: 'report', id: reportId };
    return memberId ? { kind: 'member', id: memberId } : null;
  }
  if (action === 'dismiss' || action === 'escalate') return reportId ? { kind: 'report', id: reportId } : null;
  if (item.kind === 'report' && reportId) return { kind: 'report', id: reportId };
  const type = String(item.target?.type || '').toLowerCase();
  return postId ? { kind: type === 'comment' ? 'comment' : 'post', id: postId } : null;
}

/** "Removed a post under C1 · Re-rack your weights": one log row, from the fields the API sends. */
export function logLine(entry: ModerationLogEntry): string {
  if (entry.kind === 'note') return entry.text?.trim() || 'Added a note';
  const type = entry.action?.type ? humanize(entry.action.type) : 'Action';
  const rule = entry.action?.ruleCode ? ` under ${entry.action.ruleCode}${entry.action.ruleTitle ? ` · ${entry.action.ruleTitle}` : ''}` : '';
  const duration = entry.action?.duration ? ` for ${entry.action.duration}` : '';
  return `${type}${duration}${rule}`;
}

function Person({ actor }: { actor?: { _id?: string; username?: string; fullName?: string; avatar?: string } | null }) {
  const name = actor?.fullName?.trim() || actor?.username || 'Someone';
  if (!actor?._id) return <span className="font-semibold text-text-1">{name}</span>;
  return (
    <Link to={`/u/${actor._id}`} viewTransition className="font-semibold text-text-1 hover:underline">
      {name}
    </Link>
  );
}

/** A punitive action must name a rule: the dialog asks for its code and an optional note. */
function RuleDialog({
  open,
  action,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  action: ModerationAction | null;
  onClose: () => void;
  onConfirm: (input: { ruleCode: string; note: string; duration?: '24h' | '7d' }) => void;
  busy: boolean;
}) {
  const [ruleCode, setRuleCode] = useState('');
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState<'24h' | '7d'>('24h');
  const valid = /^[A-Za-z]\d{1,2}$/.test(ruleCode.trim());
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={action ? `${humanize(action)}: which rule?` : 'Which rule?'}
      description="The member is told which numbered community rule this was, and can appeal to the admins."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={() => onConfirm({ ruleCode: ruleCode.trim().toUpperCase(), note: note.trim(), ...(action === 'mute' ? { duration } : {}) })}
          >
            {action ? humanize(action) : 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Rule"
          value={ruleCode}
          onChange={(e) => setRuleCode(e.target.value)}
          placeholder="C1"
          maxLength={4}
          autoFocus
          hint="The code of one of this gym’s written rules, e.g. C1. Set them on the About tab."
        />
        {action === 'mute' ? (
          <SegmentedControl
            aria-label="How long"
            tabs={[
              { value: '24h', label: '24 hours' },
              { value: '7d', label: '7 days' },
            ]}
            value={duration}
            onChange={(v) => setDuration(v as '24h' | '7d')}
          />
        ) : null}
        <Input label="Note for the log" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} hint="Optional. Other moderators see it; the member never does." />
      </div>
    </Modal>
  );
}

function QueueRow({
  item,
  communityId,
  role,
  onDone,
}: {
  item: QueueItem;
  communityId: string;
  role: string | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const [asking, setAsking] = useState<ModerationAction | null>(null);
  const rungs = actionsFor(item, role);

  const act = useMutation({
    mutationFn: (input: { action: ModerationAction; ruleCode?: string; note?: string; duration?: '24h' | '7d' }) => {
      const target = targetFor(item, input.action);
      if (!target) throw new Error('This row has nothing to act on');
      return actOnModeration(communityId, {
        clientRequestId: clientRequestId('gym-mod'),
        action: input.action,
        target,
        ...(input.ruleCode ? { ruleCode: input.ruleCode } : {}),
        ...(input.note ? { note: input.note } : {}),
        ...(input.duration ? { duration: input.duration } : {}),
        ...(item.reportIds?.length ? { reportIds: item.reportIds } : {}),
      });
    },
    onSuccess: (result) => {
      toast.success(result.outcome ? `Done: ${humanize(result.outcome).toLowerCase()}` : 'Done');
      setAsking(null);
      onDone();
    },
    onError: (e) => {
      toast.error(isFeatureDisabled(e) ? 'Moderation is not available on your account yet.' : errMsg(e, 'Could not take that action'));
      setAsking(null);
    },
  });

  const items: MenuItem[] = rungs
    .filter((rung) => rung.action !== 'note')
    .map((rung) => ({
      label: rung.label,
      danger: rung.action === 'remove' || rung.action === 'remove_member',
      onSelect: () => (rung.rule ? setAsking(rung.action) : act.mutate({ action: rung.action })),
    }));

  const preview = item.target?.preview;
  const body = preview?.body?.trim() || preview?.title?.trim() || '';
  return (
    <li className="flex items-start gap-3 py-3">
      <Avatar src={item.target?.author?.avatar} name={item.target?.author?.fullName || item.target?.author?.username || 'Member'} size="sm" seed={item.target?.author?._id} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-1">{queueItemLine(item)}</p>
        <p className="t-meta">
          <Person actor={item.target?.author} />
          {item.createdAt ? ` · ${ago(item.createdAt)}` : ''}
          {item.member?.isNew ? ' · new here' : ''}
        </p>
        {item.reason ? <p className="t-meta mt-0.5 truncate">Reported as {humanize(item.reason).toLowerCase()}</p> : null}
        {body ? <p className="mt-1 line-clamp-2 text-sm text-text-2">{body}</p> : null}
        {item.scope === 'platform' ? <Badge tone="warning" className="mt-1">With Vybe</Badge> : null}
      </div>
      {items.length ? <Menu items={items} label="Moderate this" size={40} className="-mr-2 shrink-0" /> : null}
      <RuleDialog
        open={asking !== null}
        action={asking}
        busy={act.isPending}
        onClose={() => setAsking(null)}
        onConfirm={({ ruleCode, note, duration }) => act.mutate({ action: asking!, ruleCode, note, duration })}
      />
    </li>
  );
}

function AppealRows({ communityId, items, onDone }: { communityId: string; items: QueueItem[]; onDone: () => void }) {
  const toast = useToast();
  const rows = appealsOf(items);
  const decide = useMutation({
    mutationFn: ({ reportId, decision }: { reportId: string; decision: 'upheld' | 'reversed' }) => decideAppeal(communityId, reportId, { decision }),
    onSuccess: (_result, variables) => {
      toast.success(variables.decision === 'reversed' ? 'Appeal allowed — the post is back' : 'Appeal declined');
      onDone();
    },
    onError: (e) =>
      toast.error(
        isFeatureDisabled(e)
          ? 'Moderation is not available on your account yet.'
          : errMsg(e, 'Could not decide the appeal'),
      ),
  });
  if (!rows.length) {
    return <p className="mt-2 text-sm text-text-2">No appeals are open. A member whose post was removed can appeal to the admins here.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-line">
      {rows.map((row) => (
        <li key={row.reportId} className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-1">{queueItemLine(row.item)}</p>
            <p className="t-meta">
              <Person actor={row.item.target?.author} />
              {` · appeal ${humanize(row.status).toLowerCase()}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={decide.isPending && decide.variables?.reportId === row.reportId && decide.variables.decision === 'reversed'}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ reportId: row.reportId, decision: 'reversed' })}
            >
              Allow it
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={decide.isPending && decide.variables?.reportId === row.reportId && decide.variables.decision === 'upheld'}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ reportId: row.reportId, decision: 'upheld' })}
            >
              Keep the decision
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

type Pane = 'queue' | 'appeals' | 'log';

/**
 * Moderators only, and only where the flag is on: the queue, the appeals a
 * community admin may decide, and the log every action (and every equipment
 * save) writes. Renders `null` when the API refuses, so the Members tab is
 * unchanged for everyone else.
 */
export function GymModerationSection({
  communityId,
  role,
  enabled,
  className,
}: {
  communityId: string;
  /** The viewer's community role; the ladder is filtered by it. */
  role: string | null;
  /** The viewer is a moderator, admin or the owner. */
  enabled: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const [pane, setPane] = useState<Pane>('queue');
  const [page, setPage] = useState(1);
  // The open queue is read whichever pane is showing: the count on the
  // section's badge is the same figure the Queue pane lists, and the appeals
  // ride those rows' statements.
  const queue = useModerationQueue(communityId, 'open', page, enabled);
  const log = useModerationLog(communityId, 1, enabled && pane === 'log');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['community', communityId, 'moderation'] });
    qc.invalidateQueries({ queryKey: ['community', communityId, 'posts'] });
  };

  // The route answered 404 (the flag is off for this caller) or 403: absent, never an error.
  if (!enabled || (queue.isSuccess && queue.data === null)) return null;

  const items = queue.data?.items || [];
  const open = queue.data?.counts?.open ?? items.length;
  return (
    <Card className={className} aria-label="Moderation">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-section inline-flex items-center gap-2 text-text-1">
          <Shield size={18} className="text-text-2" />
          Moderation
        </h2>
        {open > 0 ? <Badge tone="info">{open}</Badge> : null}
      </div>
      <SegmentedControl
        aria-label="Moderation panes"
        className="mt-3"
        tabs={[
          { value: 'queue', label: 'Queue' },
          { value: 'appeals', label: 'Appeals' },
          { value: 'log', label: 'Log' },
        ]}
        value={pane}
        onChange={(v) => {
          setPane(v as Pane);
          setPage(1);
        }}
      />

      {queue.isLoading ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : null}
      {queue.isError ? <ErrorState error={queue.error} title="The queue is unavailable" onRetry={() => queue.refetch()} className="py-6" /> : null}

      {pane === 'queue' && queue.isSuccess ? (
        items.length ? (
          <>
            <ul className="mt-1 divide-y divide-line">
              {items.map((item) => (
                <QueueRow key={`${item.kind}-${item.id}`} item={item} communityId={communityId} role={role} onDone={refresh} />
              ))}
            </ul>
            {(queue.data?.hasNextPage || page > 1) ? (
              <nav aria-label="Queue pages" className="mt-3 flex items-center justify-between gap-3">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Newer
                </Button>
                <span className="tabular text-xs font-semibold text-text-2">Page {page}</span>
                <Button variant="ghost" size="sm" disabled={!queue.data?.hasNextPage} onClick={() => setPage((p) => p + 1)}>
                  Older
                </Button>
              </nav>
            ) : null}
          </>
        ) : (
          <EmptyState
            size="sm"
            icon={<Shield size={24} />}
            title="Nothing is waiting"
            message="Reports and posts the hold rules keep back land here. You will see what it is, who posted it and when."
          />
        )
      ) : null}

      {pane === 'appeals' && queue.isSuccess ? <AppealRows communityId={communityId} items={items} onDone={refresh} /> : null}

      {pane === 'log' ? (
        log.isLoading ? (
          <div className="mt-3 space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : log.isError ? (
          <ErrorState error={log.error} title="The log is unavailable" onRetry={() => log.refetch()} className="py-6" />
        ) : (log.data?.items?.length || 0) > 0 ? (
          <ul className="mt-2 divide-y divide-line">
            {(log.data?.items || []).map((entry) => (
              <li key={entry.id} className="py-2.5">
                <p className="text-sm text-text-1">{logLine(entry)}</p>
                <p className="t-meta">
                  <Person actor={entry.author} />
                  {entry.memberActor ? ' · about ' : ''}
                  {entry.memberActor ? <Person actor={entry.memberActor} /> : null}
                  {entry.createdAt ? ` · ${ago(entry.createdAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={cx('mt-2 text-sm text-text-2')}>Nothing has been moderated here yet. Every action you take is written down, with the rule it named.</p>
        )
      ) : null}
    </Card>
  );
}
