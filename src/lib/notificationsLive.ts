import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from './socket';
import { bumpUnreadCount, prependNotification, type InboxNotification, type InboxPages, type UnreadCount } from './notificationInbox';

export const NOTIFICATIONS_KEY = ['notifications'] as const;
export const UNREAD_COUNT_KEY = ['notifications', 'unread-count'] as const;

/**
 * Live inbox. The server emits `notification` to the recipient's sockets the
 * moment a record is saved (models/Notification.js post-save hook), with the
 * sender populated. Until this hook existed no client code listened for it and
 * no socket was opened outside Messages and Live, so the bell and the inbox
 * only moved on the 60 s poll.
 *
 * Mounted once, in Layout, for the whole signed-in session. The shared socket
 * is an enhancement: with none, the polling queries still work.
 */
export function useLiveNotifications(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    if (!socket) return;

    const onNotification = (incoming: InboxNotification) => {
      if (!incoming || !incoming._id) return;
      qc.setQueryData<InboxPages>(NOTIFICATIONS_KEY, (old) => prependNotification(old, incoming));
      qc.setQueryData<UnreadCount>(UNREAD_COUNT_KEY, (old) => bumpUnreadCount(old, incoming));
      // Reconcile with the server shortly after: exact count, server ordering.
      void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    };

    // Anything that happened while the socket was down arrives on the next poll
    // at the latest; a reconnect asks straight away. The very first connect of
    // a page load skips the refetch (the queries have just run) unless they
    // failed, which is the case when the page was opened while the API was
    // unreachable and the socket only connects once it is back.
    let everConnected = socket.connected;
    const onConnect = () => {
      void qc.invalidateQueries({
        queryKey: NOTIFICATIONS_KEY,
        ...(everConnected ? {} : { predicate: (query) => query.state.status === 'error' }),
      });
      everConnected = true;
    };

    socket.on('notification', onNotification);
    socket.on('connect', onConnect);
    return () => {
      socket.off('notification', onNotification);
      socket.off('connect', onConnect);
    };
  }, [enabled, qc]);
}
