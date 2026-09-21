/**
 * The Requests fold above the inbox, the list behind it, and the banner a
 * pending thread wears instead of a composer.
 *
 * Instagram's shape: one "Requests (3)" entry over the conversation list,
 * never a numeric badge beside a thread; a list of strangers with Accept
 * and Delete on each; and a "Hidden requests" fold underneath for the ones
 * a word filter caught. Nothing here is a filled blue — the accept is a
 * blue text button, so a list of ten requests is not ten primary actions
 * and the page keeps its one fill (docs/DESIGN.md).
 *
 * The flag (`messageRequests`) is off on every deployment today. The row is
 * gated on it AND the reader swallows `404 FEATURE_DISABLED`, because the
 * capabilities query is cached for five minutes and a stale `true` must
 * fall silent rather than show an error over the inbox.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFeature } from '../../lib/capabilities';
import {
  MESSAGE_REQUESTS_FLAG,
  contextLabel,
  fetchMessageRequests,
  acceptMessageRequest,
  blockMessageRequest,
  declineMessageRequest,
  hiddenRequestsLabel,
  isRequestGone,
  messageRequestKeys,
  requestErrorCopy,
  requestSender,
  requestsRowLabel,
  type MessageRequest,
} from '../../lib/messageRequests';
import { Avatar, Button, EmptyState, ErrorState, Skeleton, SkeletonRow, cx, useToast } from '../ui';
import { ChevronRight, Inbox } from '../icons';

const senderName = (u?: { fullName?: string; username?: string }) => u?.fullName?.trim() || u?.username || 'Vybe user';

/* ------------------------------------------------------------------ the gate */

/**
 * The first page, which is also where the counts live: `total` and
 * `hiddenTotal` are full counts, not this page's length, so the row's
 * number is right without a second request. Disabled entirely while the
 * flag is off, so nothing is fetched on a deployment without the feature.
 */
export function useMessageRequests(enabled = true) {
  const flagOn = useFeature(MESSAGE_REQUESTS_FLAG);
  const q = useQuery({
    queryKey: messageRequestKeys.list(false, 1),
    enabled: enabled && flagOn,
    staleTime: 30_000,
    queryFn: () => fetchMessageRequests({ page: 1 }),
  });
  return {
    flagOn,
    total: q.data?.total ?? 0,
    hiddenTotal: q.data?.hiddenTotal ?? 0,
    /** False for a minor or a member who turned requests off: no row at all. */
    allowRequests: q.data?.allowRequests !== false,
    query: q,
  };
}

/* ------------------------------------------------------------------ the row */

/**
 * "Requests" over the inbox: bold with a count when something is waiting,
 * plain when nothing is. Absent while the flag is off or the member does
 * not take requests — one row, never a badge per conversation.
 */
export function RequestsEntryRow({ total, compact }: { total: number; compact: boolean }) {
  const waiting = total > 0;
  return (
    <Link
      to="/messages/requests"
      viewTransition
      className={cx(
        'flex min-h-14 items-center gap-3 rounded-md px-3 transition-colors dur-1 hover:bg-surface-2',
        compact && 'px-2',
      )}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-text-2">
        <Inbox size={20} />
      </span>
      <span className={cx('min-w-0 flex-1 truncate text-base text-text-1', waiting ? 'font-semibold' : 'font-medium')}>
        {requestsRowLabel(total)}
      </span>
      <ChevronRight size={18} className="shrink-0 text-text-3" />
    </Link>
  );
}

/* ------------------------------------------------------------------ one request */

function RequestRow({
  request,
  meId,
  busy,
  onAccept,
  onDecline,
  onBlock,
}: {
  request: MessageRequest;
  meId?: string;
  busy?: 'accept' | 'decline' | 'block' | null;
  onAccept: () => void;
  onDecline: () => void;
  onBlock: () => void;
}) {
  const sender = requestSender(request, meId);
  const name = senderName(sender);
  const why = contextLabel(request.context);
  return (
    <li className="flex items-start gap-3 py-3">
      {sender?._id ? (
        <Link to={`/u/${sender._id}`} viewTransition aria-label={name} className="-m-1 shrink-0 rounded-full p-1">
          <Avatar src={sender.avatar} name={name} size="md" />
        </Link>
      ) : (
        <Avatar name={name} size="md" />
      )}
      <div className="min-w-0 flex-1">
        {sender?._id ? (
          <Link to={`/u/${sender._id}`} viewTransition className="block truncate text-sm font-semibold text-text-1 hover:underline">
            {name}
          </Link>
        ) : (
          <span className="block truncate text-sm font-semibold text-text-1">{name}</span>
        )}
        {why ? <p className="truncate text-xs text-text-2">{why}</p> : null}
        {request.message?.text ? (
          <p className="mt-1 line-clamp-2 text-sm text-text-1 [overflow-wrap:anywhere]">{request.message.text}</p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onAccept}
            className="min-h-9 text-sm font-semibold text-brand-text transition-opacity dur-1 hover:underline disabled:opacity-50"
          >
            {busy === 'accept' ? 'Accepting…' : 'Accept'}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onDecline}
            className="min-h-9 text-sm font-medium text-text-2 transition-opacity dur-1 hover:underline disabled:opacity-50"
          >
            {busy === 'decline' ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onBlock}
            className="min-h-9 text-sm font-medium text-text-2 transition-opacity dur-1 hover:underline disabled:opacity-50"
          >
            {busy === 'block' ? 'Blocking…' : 'Block'}
          </button>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ the list */

function RequestList({
  hidden,
  meId,
  onOpenThread,
}: {
  hidden: boolean;
  meId?: string;
  onOpenThread?: (roomId: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [acting, setActing] = useState<{ roomId: string; what: 'accept' | 'decline' | 'block' } | null>(null);

  const q = useQuery({
    queryKey: messageRequestKeys.list(hidden, 1),
    staleTime: 30_000,
    queryFn: () => fetchMessageRequests({ hidden, page: 1 }),
  });

  const settle = () => {
    setActing(null);
    qc.invalidateQueries({ queryKey: messageRequestKeys.all });
  };

  const act = useMutation({
    mutationFn: async ({ roomId, what }: { roomId: string; what: 'accept' | 'decline' | 'block' }) => {
      if (what === 'accept') return { what, data: await acceptMessageRequest(roomId) };
      if (what === 'decline') return { what, data: await declineMessageRequest(roomId) };
      return { what, data: await blockMessageRequest(roomId) };
    },
    onMutate: (vars) => setActing(vars),
    onSuccess: ({ what }, { roomId }) => {
      settle();
      if (what === 'accept') {
        // The room joins the inbox the moment the row turns active.
        qc.invalidateQueries({ queryKey: ['chatRooms'] });
        qc.invalidateQueries({ queryKey: ['unreadChats'] });
        toast.success('Request accepted');
        onOpenThread?.(roomId);
        return;
      }
      toast.success(what === 'block' ? 'Blocked' : 'Request deleted');
    },
    onError: (e) => {
      settle();
      // Answered on another device: the row is simply gone, not broken.
      if (isRequestGone(e)) {
        qc.invalidateQueries({ queryKey: messageRequestKeys.all });
        return;
      }
      toast.error(null, requestErrorCopy(e));
    },
  });

  if (q.isPending) {
    return (
      <ul className="space-y-1" aria-busy="true" aria-label="Loading requests">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i}>
            <SkeletonRow className="min-h-[4.5rem]" />
          </li>
        ))}
      </ul>
    );
  }
  if (q.isError) return <ErrorState error={q.error} title="Requests didn’t load" onRetry={() => q.refetch()} />;

  const requests = q.data?.requests || [];
  if (!requests.length) {
    return hidden ? (
      <p className="px-1 py-3 text-sm text-text-2">Nothing here.</p>
    ) : (
      <EmptyState
        size="sm"
        title="No requests"
        message="Messages from people you’re not connected to wait here first."
      />
    );
  }

  return (
    <ul className="divide-y divide-line" aria-label={hidden ? 'Hidden requests' : 'Message requests'}>
      {requests.map((request) => (
        <RequestRow
          key={request.room._id}
          request={request}
          meId={meId}
          busy={acting?.roomId === request.room._id ? acting.what : null}
          onAccept={() => act.mutate({ roomId: request.room._id, what: 'accept' })}
          onDecline={() => act.mutate({ roomId: request.room._id, what: 'decline' })}
          onBlock={() => act.mutate({ roomId: request.room._id, what: 'block' })}
        />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ the pane */

/**
 * The Requests pane. The hidden fold is a disclosure, not a tab: the point
 * of a hidden request is that it stays out of the way until you go looking,
 * and its list is only fetched once the fold opens.
 */
export function MessageRequestsView({ meId, onOpenThread }: { meId?: string; onOpenThread?: (roomId: string) => void }) {
  const { hiddenTotal, query } = useMessageRequests();
  const [showHidden, setShowHidden] = useState(false);
  const hiddenLabel = hiddenRequestsLabel(hiddenTotal);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      <p className="mb-2 text-xs text-text-2">
        People you’re not connected to. They can’t see whether you’ve read this, and deleting one tells them nothing.
      </p>

      <RequestList hidden={false} meId={meId} onOpenThread={onOpenThread} />

      {hiddenLabel ? (
        <section className="mt-4 border-t border-line pt-3">
          <button
            type="button"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((v) => !v)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-1 text-left transition-colors dur-1 hover:bg-surface-2"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text-1">{hiddenLabel}</span>
              <span className="block text-xs text-text-2">Caught by your hidden words.</span>
            </span>
            <ChevronRight size={18} className={cx('shrink-0 text-text-3 transition-transform dur-1', showHidden && 'rotate-90')} />
          </button>
          {showHidden ? (
            <div className="mt-2">
              <RequestList hidden meId={meId} onOpenThread={onOpenThread} />
            </div>
          ) : null}
        </section>
      ) : query.isPending ? (
        <Skeleton className="mt-4 h-11 w-full rounded-sm" />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the banner */

/**
 * What a pending thread wears instead of a composer. One line, then the
 * same two words the list uses — a reply IS an accept server-side, so
 * offering a composer here would accept the request without saying so.
 */
export function AcceptToReplyBanner({
  roomId,
  onAccepted,
}: {
  roomId: string;
  onAccepted?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const act = useMutation({
    mutationFn: async (what: 'accept' | 'decline') =>
      what === 'accept' ? acceptMessageRequest(roomId) : declineMessageRequest(roomId),
    onSuccess: (_d, what) => {
      qc.invalidateQueries({ queryKey: messageRequestKeys.all });
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      qc.invalidateQueries({ queryKey: ['chatRoom', roomId] });
      qc.invalidateQueries({ queryKey: ['unreadChats'] });
      toast.success(what === 'accept' ? 'Request accepted' : 'Request deleted');
      onAccepted?.();
    },
    onError: (e) => {
      if (isRequestGone(e)) {
        qc.invalidateQueries({ queryKey: messageRequestKeys.all });
        onAccepted?.();
        return;
      }
      toast.error(null, requestErrorCopy(e));
    },
  });

  return (
    <div className="shrink-0 border-t border-line bg-surface-1 px-3 py-3 safe-bottom" role="group" aria-label="Message request">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm text-text-2">Accept to reply.</p>
        <div className="flex shrink-0 items-center gap-3">
          <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate('decline')}>
            Delete
          </Button>
          <Button size="sm" variant="secondary" loading={act.isPending && act.variables === 'accept'} onClick={() => act.mutate('accept')}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
