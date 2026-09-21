import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/ui';
import { disablePush, enablePush, pushSupport, pushTokenStore, type PushSupport } from './firebase';

/**
 * The state and the words behind the "Notifications on this device" card and
 * the quiet prompt on /notifications.
 *
 * The permission is asked for at the moment of use, never at sign-up. A
 * browser prompt that arrives before anybody has decided they want
 * notifications is the fastest way to a permanent `denied`, which cannot be
 * undone from inside the page — only in browser settings, where almost
 * nobody goes.
 */

export const PUSH_DEVICE_TITLE = 'Notifications on this device';

export const PUSH_DEVICE_COPY = {
  /** No decision yet: the only state with a call to action. */
  default: {
    line: 'Session reminders, kudos and replies while Vybe is closed.',
    action: 'Turn on notifications',
  },
  granted: {
    line: 'On for this device',
    action: 'Turn off',
  },
  /**
   * A denied permission cannot be re-asked from the page — the browser
   * refuses silently — so this state offers no button and says where the
   * switch actually is.
   */
  denied: {
    line: 'Notifications are blocked for vybeapp.fit in your browser settings.',
  },
  unsupported: {
    line: 'This browser cannot show notifications. Everything still lands in your Vybe inbox.',
  },
  /**
   * iOS Safari only gives a site the Notification API once it has been added
   * to the Home Screen (16.4+), so this is a step, not a dead end.
   */
  'needs-install': {
    line: 'Add Vybe to your Home Screen to get notifications on iPhone.',
    how: 'In Safari, tap the share button, choose Add to Home Screen, then open Vybe from there.',
  },
} as const;

export const PUSH_ENABLED_TOAST = 'Notifications are on for this device.';
export const PUSH_DISABLED_TOAST = 'Notifications are off for this device.';
export const PUSH_DISMISSED_TOAST = 'Notifications stay off. You can turn them on in Settings.';

/** Dismissed for this tab's session only: a later visit asks again, once. */
export const PUSH_PROMPT_DISMISSED_KEY = 'vybe.push.prompt-dismissed';

export function pushPromptDismissed(): boolean {
  try {
    return sessionStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissPushPrompt(): void {
  try {
    sessionStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, '1');
  } catch {
    // Without storage the prompt comes back on the next render; harmless.
  }
}

/**
 * What the card renders. The browser's permission is only half the answer:
 * "Turn off" revokes the token but cannot revoke the permission (no API
 * does), so a device that was switched off here still reads `granted`. The
 * card must offer to turn it back on, and turning it back on will not
 * prompt again, so granted-without-a-token is the same state as a browser
 * that has never been asked. Pure, so the five states are unit-testable.
 */
export function pushCardState(support: PushSupport, registered: boolean): PushSupport {
  return support === 'granted' && !registered ? 'default' : support;
}

export type PushDevice = {
  state: PushSupport;
  busy: boolean;
  enable: () => void;
  disable: () => void;
};

/**
 * The live support state plus the two actions. Re-read when the tab comes
 * back: the browser's own site-settings UI can grant or revoke the
 * permission behind the app's back and fires no event the page can hear, so
 * a card that read `Notification.permission` once would go on offering
 * "Turn on notifications" after somebody had already turned it on elsewhere.
 */
const read = (): PushSupport => pushCardState(pushSupport(), pushTokenStore.read() !== null);

export function usePushDevice(): PushDevice {
  const toast = useToast();
  const [state, setState] = useState<PushSupport>('unsupported');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setState(read());
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  const enable = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        const result = await enablePush();
        setState(read());
        if (result.token) toast.success(PUSH_ENABLED_TOAST);
        else if (result.state === 'denied') toast.info(PUSH_DEVICE_COPY.denied.line);
      } catch (error) {
        setState(read());
        toast.error(error, 'Could not turn notifications on.');
      } finally {
        setBusy(false);
      }
    })();
  }, [toast]);

  const disable = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        await disablePush();
        toast.info(PUSH_DISABLED_TOAST);
      } finally {
        setState(read());
        setBusy(false);
      }
    })();
  }, [toast]);

  return { state, busy, enable, disable };
}
