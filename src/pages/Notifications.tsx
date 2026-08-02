import { Link } from 'react-router-dom';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import {
  displayName,
  timeAgo,
  useInfiniteScroll,
  type AppNotification,
} from '../lib/hooks';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  Spinner,
  useToast,
} from './ui';
import { Check, Trash } from './icons';

type Page = {
  notifications: AppNotification[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

const TYPE_TEXT: Record<string, string> = {
  post_like: 'liked your post',
  comment_like: 'liked your comment',
  post_comment: 'commented on your post',
  comment: 'commented on your post',
  follow: 'started following you',
  follow_request: 'requested to follow you',
  friend_request: 'sent you a friend request',
  friend_accept: 'accepted your friend request',
  message: 'sent you a message',
  workout_post: 'shared a new workout',
  mention: 'mentioned you',
};

function notificationText(n: AppNotification): string {
  return n.body || n.message || TYPE_TEXT[n.type] || 'sent you an update';
}

function notificationHref(n: AppNotification): string | null {
  const postId = n.data?.postId || n.data?.post;
  if (postId) return `/post/${postId}`;
  const senderId = n.sender?._id || n.data?.sender || n.data?.userId;
  if (senderId) return `/u/${senderId}`;
  return null;
}

function isUnread(n: AppNotification) {
  return !(n.isRead ?? n.read ?? false);
}

export default function Notifications() {
  const qc = useQueryClient();
  const toast = useToast();

  const query = useInfiniteQuery({
    queryKey: ['notifications'],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/notifications', {
        params: { page: pageParam, limit: 20 },
      });
      return data as Page;
    },
    getNextPageParam: (last, all) => (last.hasNextPage ? all.length + 1 : undefined),
  });

  const sentinelRef = useInfiniteScroll(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, !!query.hasNextPage);

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/notifications/${id}/read`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e) => toast.error(errMsg(e, 'Could not mark this notification as read.')),
  });

  const markAll = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.post('/notifications/mark-read', { ids, all: true });
    },
    onSuccess: () => {
      toast.success('All notifications marked as read');
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not mark notifications as read.')),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/notifications/${id}`);
    },
    onSuccess: () => {
      toast.success('Notification removed');
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete this notification.')),
  });

  const notifications = query.data?.pages.flatMap((p) => p.notifications || []) ?? [];
  const unreadIds = notifications.filter(isUnread).map((n) => n._id);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Notifications</h1>
          {unreadIds.length > 0 && (
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {unreadIds.length} unread
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => query.refetch()} loading={query.isRefetching}>
            Refresh
          </Button>
          <Button
            variant="primary"
            disabled={!unreadIds.length || markAll.isPending}
            loading={markAll.isPending}
            onClick={() => markAll.mutate(unreadIds)}
          >
            Mark all read
          </Button>
        </div>
      </header>

      {query.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="flex items-center gap-3 p-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-20" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {query.isError && !query.isLoading && (
        <ErrorState
          title="Notifications unavailable"
          message={errMsg(query.error, 'Please check your connection and try again.')}
          action={
            <Button variant="primary" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      )}

      {!query.isLoading && !query.isError && notifications.length === 0 && (
        <EmptyState
          title="No notifications yet"
          message="Likes, comments, follows and friend requests will appear here."
          action={
            <Link to="/discover">
              <Button variant="primary">Find people to follow</Button>
            </Link>
          }
        />
      )}

      <div className="space-y-2">
        {notifications.map((n) => {
          const href = notificationHref(n);
          const unread = isUnread(n);

          const body = (
            <div className="flex items-start gap-3">
              <Avatar
                src={mediaUrl(n.sender?.avatar)}
                name={displayName(n.sender)}
                size={40}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {n.sender && (
                    <span className="font-semibold">{displayName(n.sender)} </span>
                  )}
                  <span className={unread ? '' : 'text-[var(--color-muted)]'}>
                    {notificationText(n)}
                  </span>
                </p>
                {n.title && n.title !== notificationText(n) && (
                  <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                    {n.title}
                  </p>
                )}
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {timeAgo(n.createdAt)}
                </p>
              </div>
              {unread && (
                <span
                  aria-label="Unread"
                  className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand-2)]"
                />
              )}
            </div>
          );

          return (
            <Card
              key={n._id}
              className={`p-3 ${unread ? 'border-[var(--color-brand)]/40' : ''}`}
            >
              {href ? (
                <Link
                  to={href}
                  onClick={() => {
                    if (unread) markOne.mutate(n._id);
                  }}
                  className="block"
                >
                  {body}
                </Link>
              ) : (
                body
              )}

              <div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--color-line)] pt-2">
                {unread && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-white"
                    onClick={() => markOne.mutate(n._id)}
                    disabled={markOne.isPending}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Mark read
                  </button>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-red-400"
                  onClick={() => remove.mutate(n._id)}
                  disabled={remove.isPending}
                >
                  <Trash className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {query.hasNextPage && (
        <div ref={sentinelRef} className="py-6 text-center">
          {query.isFetchingNextPage ? (
            <Spinner />
          ) : (
            <Button variant="ghost" onClick={() => query.fetchNextPage()}>
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
