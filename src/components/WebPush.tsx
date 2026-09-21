import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useToast } from './ui';
import { useAuth } from '../lib/auth';
import { NOTIFICATIONS_KEY, UNREAD_COUNT_KEY } from '../lib/notificationsLive';
import { onForegroundMessage, refreshPushToken } from '../lib/firebase';

/**
 * The signed-in half of web push. Mounted once at the root, renders nothing.
 *
 * Two jobs.
 *
 * **Keep the registration current.** FCM rotates a browser's token whenever
 * it likes, and the API keeps only five per account, dropping the oldest, so
 * a token registered months ago can quietly stop being one of the five.
 * `refreshPushToken()` re-reads it on every start and re-registers when it
 * changed or aged out. It is a no-op unless permission is already granted
 * AND this browser registered a token before, so nothing here can prompt
 * anybody: the permission request only ever happens on the card in Settings,
 * at the moment somebody asks for it.
 *
 * **Announce a push that lands while Vybe is open.** FCM hands those to the
 * page instead of the tray (its worker checks for a visible client first), so
 * without this they vanish. The toast carries the same title and body the
 * tray would have shown and a View action for the target; the inbox and the
 * bell are invalidated either way, so the count moves even when the toast is
 * ignored. One toast key, so a burst replaces rather than stacks.
 */
export function WebPush() {
  const signedIn = useAuth((s) => !!s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!signedIn) return;
    void refreshPushToken().catch(() => undefined);
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return undefined;
    return onForegroundMessage((push) => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      const message = push.body ? `${push.title} — ${push.body}` : push.title;
      if (!message) return;
      toast.info(message, {
        key: 'web-push',
        action: { label: 'View', onClick: () => navigate(push.link) },
      });
    });
  }, [signedIn, qc, toast, navigate]);

  return null;
}
