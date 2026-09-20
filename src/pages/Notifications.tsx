import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { displayName, timeAgo, useInfiniteScroll, type AppNotification } from '../lib/hooks';
import {
  isSystemNotification,
  notificationCopy,
  notificationHref,
  notificationText,
  type NotificationFamily,
  type NotificationGlyph,
} from '../lib/notificationCopy';
import { isUnread } from '../lib/notificationInbox';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Menu,
  PageHeader,
  Skeleton,
  Spinner,
  cx,
  useToast,
  type MenuItem,
} from './ui';
import type { IconComponent } from './icons';
import {
  BadgeCheck,
  Bell,
  Building,
  Check,
  CheckCircle,
  ClipboardList,
  Copy,
  Dumbbell,
  Heart,
  Image as ImageIcon,
  Inbox,
  MessageCircle,
  Settings,
  Share,
  Shield,
  Trash,
  UserPlus,
  Users,
  Utensils,
  Droplet, Trophy,
} from './icons';

export { notificationHref } from '../lib/notificationCopy';

type Page = {
  notifications: AppNotification[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

/** Copy lives in lib/notificationCopy.ts (keyed on the API enum); this maps its glyph names to icons. */
const GLYPH_ICON: Record<NotificationGlyph, IconComponent> = {
  droplet: Droplet,
  trophy: Trophy,
  heart: Heart,
  comment: MessageCircle,
  'user-plus': UserPlus,
  'user-check': BadgeCheck,
  users: Users,
  inbox: Inbox,
  dumbbell: Dumbbell,
  utensils: Utensils,
  clipboard: ClipboardList,
  image: ImageIcon,
  copy: Copy,
  share: Share,
  building: Building,
  shield: Shield,
  bell: Bell,
  settings: Settings,
};

/** Badge fill per family, on the existing soft tokens so dark mode follows. */
const FAMILY_CLASS: Record<NotificationFamily, string> = {
  like: 'bg-danger-soft text-danger',
  conversation: 'bg-info-soft text-info-text',
  people: 'bg-brand-soft text-brand-text',
  content: 'bg-accent-soft text-accent-text',
  system: 'bg-surface-3 text-text-2',
};

type Bucket = 'Today' | 'Yesterday' | 'This week' | 'Earlier';
const BUCKET_ORDER: Bucket[] = ['Today', 'Yesterday', 'This week', 'Earlier'];
const DAY = 86_400_000;

function bucketOf(iso: string, now = Date.now()): Bucket {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Earlier';
  const d = new Date(now);
  const startToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (t >= startToday) return 'Today';
  if (t >= startToday - DAY) return 'Yesterday';
  if (t >= startToday - 6 * DAY) return 'This week';
  return 'Earlier';
}

function NotificationRow({
  n,
  onRead,
  onDelete,
  busy,
}: {
  n: AppNotification;
  onRead: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const href = notificationHref(n);
  const unread = isUnread(n);
  const copy = notificationCopy(n.type);
  const Glyph = GLYPH_ICON[copy.glyph];
  const text = notificationText(n);
  // Security, system and account rows have no human actor: the API sets
  // `sender` to the user themselves, which used to render "<Your name> Your
  // password was changed." with your own avatar, linking to your own profile.
  const system = isSystemNotification(n.type) || copy.family === 'system';

  const items: MenuItem[] = [
    ...(unread ? [{ label: 'Mark as read', icon: <Check size={18} />, onSelect: onRead, disabled: busy }] : []),
    { label: 'Delete', icon: <Trash size={18} />, onSelect: onDelete, danger: true, disabled: busy, divider: unread },
  ];

  const body = (
    <>
      <span className="relative shrink-0">
        {system ? (
          <span
            role="img"
            aria-label={n.type === 'security' ? 'Security notice' : 'Vybe notice'}
            className={cx('inline-flex h-11 w-11 items-center justify-center rounded-full', FAMILY_CLASS.system)}
          >
            <Glyph size={22} />
          </span>
        ) : (
          <>
            <Avatar src={n.sender?.avatar} name={displayName(n.sender)} size={44} />
            <span
              aria-hidden="true"
              className={cx('absolute -bottom-0.5 -right-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-surface-1', FAMILY_CLASS[copy.family])}
            >
              <Glyph size={12} filled={copy.glyph === 'heart'} />
            </span>
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block text-sm leading-snug', unread ? 'text-text-1' : 'text-text-2')}>
          {!system && n.sender ? <span className="font-semibold text-text-1">{displayName(n.sender)} </span> : null}
          {text}
        </span>
        {n.title && n.title !== text ? <span className="mt-0.5 block truncate text-xs text-text-2">{n.title}</span> : null}
        <span className="mt-1 flex items-center gap-2 text-xs text-text-3">
          <time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
          {unread ? <span className="font-semibold text-brand-text">New</span> : null}
        </span>
      </span>
    </>
  );

  const rowCls = cx(
    'flex min-h-11 flex-1 items-start gap-3 rounded-sm p-3 text-left transition-colors dur-1',
    href && 'hover:bg-surface-2',
  );

  return (
    <li className={cx('flex items-start pr-1 transition-colors dur-2', unread && 'bg-brand-soft/40')}>
      {href ? (
        <Link
          to={href}
          viewTransition
          className={rowCls}
          onClick={() => {
            if (unread) onRead();
          }}
        >
          {body}
        </Link>
      ) : (
        <div className={rowCls}>{body}</div>
      )}
      <span className="flex items-center gap-1 self-center">
        {unread ? <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand" /> : null}
        <Menu items={items} label="Notification options" size={44} />
      </span>
    </li>
  );
}

function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card padded={false} aria-busy="true" aria-label="Loading notifications">
      <ul className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-11 w-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-20" />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Notifications() {
  const qc = useQueryClient();
  const toast = useToast();

  const query = useInfiniteQuery({
    queryKey: ['notifications'],
    initialPageParam: 1,
    refetchInterval: 60_000,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/notifications', {
        params: { page: pageParam, limit: 20 },
      });
      return data as Page;
    },
    getNextPageParam: (last, all) => (last.hasNextPage ? all.length + 1 : undefined),
  });

  const sentinelRef = useInfiniteScroll(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, !!query.hasNextPage);

  /** Flip the read flag locally so the dot and badge react before the server does. */
  const patchRead = (ids: Set<string> | 'all') => {
    qc.setQueryData<InfiniteData<Page>>(['notifications'], (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              notifications: (p.notifications || []).map((n) =>
                ids === 'all' || ids.has(n._id) ? { ...n, isRead: true, read: true } : n,
              ),
            })),
          }
        : old,
    );
  };

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/notifications/${id}/read`);
    },
    onMutate: (id) => patchRead(new Set([id])),
    onError: (e) => toast.error(errMsg(e, 'Could not mark this notification as read.')),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.post('/notifications/mark-read', { ids, all: true });
    },
    onMutate: () => patchRead('all'),
    onSuccess: () => toast.success('All caught up'),
    onError: (e) => toast.error(errMsg(e, 'Could not mark notifications as read.')),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/notifications/${id}`);
    },
    onMutate: (id) => {
      qc.setQueryData<InfiniteData<Page>>(['notifications'], (old) =>
        old
          ? { ...old, pages: old.pages.map((p) => ({ ...p, notifications: (p.notifications || []).filter((n) => n._id !== id) })) }
          : old,
      );
    },
    onSuccess: () => toast.success('Notification removed'),
    onError: (e) => toast.error(errMsg(e, 'Could not delete this notification.')),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const notifications = useMemo(() => query.data?.pages.flatMap((p) => p.notifications || []) ?? [], [query.data]);
  const unreadIds = notifications.filter(isUnread).map((n) => n._id);
  const unreadCount = unreadIds.length;
  const busy = markOne.isPending || remove.isPending || markAll.isPending;

  const groups = useMemo(() => {
    const map = new Map<Bucket, AppNotification[]>();
    for (const n of notifications) {
      const b = bucketOf(n.createdAt);
      const list = map.get(b);
      if (list) list.push(n);
      else map.set(b, [n]);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ label: b, items: map.get(b)! }));
  }, [notifications]);

  const subtitle = query.isSuccess
    ? unreadCount > 0
      ? `${unreadCount}${query.hasNextPage && unreadCount === notifications.length ? '+' : ''} unread`
      : 'You are all caught up.'
    : undefined;

  const markAllButton = (size: 'sm' | 'md') => (
    <Button
      variant="ghost"
      size={size}
      icon={<CheckCircle size={18} />}
      disabled={!unreadCount}
      loading={markAll.isPending}
      onClick={() => markAll.mutate(unreadIds)}
    >
      Mark all read
    </Button>
  );

  return (
    <>
      {/* The action lives in the page header on every viewport (top bar on phones); the phone
          row below only repeats the unread count, so there is one "Mark all read" on screen. */}
      <PageHeader title="Notifications" subtitle={subtitle} actions={unreadCount > 0 ? markAllButton('md') : undefined} mobileActions={unreadCount > 0 ? markAllButton('sm') : null} />
      <div className="w-full max-w-form space-y-4">
        {query.isSuccess && notifications.length > 0 && subtitle ? (
          <p className="flex min-h-10 items-center text-sm text-text-2 lg:hidden">{subtitle}</p>
        ) : null}

        {query.isLoading ? <ListSkeleton /> : null}

        {query.isError && !query.isLoading ? (
          <ErrorState title="Notifications unavailable" error={query.error} retry={() => void query.refetch()} />
        ) : null}

        {query.isSuccess && notifications.length === 0 ? (
          <EmptyState
            icon={<Bell size={26} />}
            title="No notifications yet"
            message="Likes, comments, follows and friend requests land here as they happen."
            action={{ label: 'Find people to follow', to: '/discover' }}
          />
        ) : null}

        {groups.map((g) => (
          <section key={g.label} aria-labelledby={`notif-${g.label.replace(/\s/g, '-')}`} className="space-y-2">
            <h2 id={`notif-${g.label.replace(/\s/g, '-')}`} className="type-label px-1 text-text-2">
              {g.label}
            </h2>
            <Card padded={false} className="overflow-hidden">
              <ul className="divide-y divide-line">
                {g.items.map((n) => (
                  <NotificationRow
                    key={n._id}
                    n={n}
                    busy={busy}
                    onRead={() => markOne.mutate(n._id)}
                    onDelete={() => remove.mutate(n._id)}
                  />
                ))}
              </ul>
            </Card>
          </section>
        ))}

        {query.hasNextPage ? (
          <div ref={sentinelRef} className="flex justify-center py-4">
            {query.isFetchingNextPage ? (
              <Spinner />
            ) : (
              <Button variant="ghost" onClick={() => void query.fetchNextPage()}>
                Show older
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
