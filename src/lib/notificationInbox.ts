/**
 * Cache arithmetic for the notifications inbox, kept free of React and
 * TanStack imports so node:test can exercise it. The Layout's realtime
 * subscription (lib/notificationsLive.ts) applies these to the
 * `['notifications']` infinite query and the `['notifications', 'unread-count']`
 * query when the server pushes a `notification` event.
 */

export type InboxNotification = {
  _id: string;
  type?: string;
  read?: boolean;
  isRead?: boolean;
  createdAt: string;
  [k: string]: unknown;
};

export type InboxPage = {
  notifications: InboxNotification[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

export type InboxPages<TPage = InboxPage> = {
  pages: TPage[];
  pageParams: unknown[];
};

export type UnreadCount = { count: number; more: boolean };

export function isUnread(n: Pick<InboxNotification, 'read' | 'isRead'>): boolean {
  return !(n.isRead ?? n.read ?? false);
}

/**
 * Put a freshly pushed notification at the top of the first page. A row the
 * cache already holds (the poll and the socket can race) is replaced in place
 * so nothing is shown twice. With no cache yet there is nothing to patch; the
 * page will fetch when it mounts.
 */
export function prependNotification<TPage extends InboxPage>(
  old: InboxPages<TPage> | undefined,
  incoming: InboxNotification,
): InboxPages<TPage> | undefined {
  if (!old || !old.pages.length) return old;
  const id = String(incoming._id);
  const seen = old.pages.some((p) => (p.notifications || []).some((n) => String(n._id) === id));
  if (seen) {
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        notifications: (p.notifications || []).map((n) => (String(n._id) === id ? { ...n, ...incoming } : n)),
      })),
    };
  }
  const [first, ...rest] = old.pages;
  return {
    ...old,
    pages: [
      {
        ...first,
        notifications: [incoming, ...(first.notifications || [])],
        total: (Number(first.total) || 0) + 1,
      },
      ...rest,
    ],
  };
}

/** The badge reacts before the server is asked again. */
export function bumpUnreadCount(old: UnreadCount | undefined, incoming: Pick<InboxNotification, 'read' | 'isRead'>): UnreadCount {
  const base = old ?? { count: 0, more: false };
  if (!isUnread(incoming)) return base;
  return { ...base, count: base.count + 1 };
}
