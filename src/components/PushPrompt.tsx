import { useState } from 'react';
import { Button } from './ui';
import { PUSH_DEVICE_COPY, dismissPushPrompt, pushPromptDismissed, usePushDevice } from '../lib/pushDevice';

/**
 * The second, quieter place to turn notifications on: the top of
 * /notifications, which is where somebody is when they are thinking about
 * notifications at all.
 *
 * Only while the browser has never been asked — a denied permission cannot
 * be re-asked from the page, and a device that already has them does not
 * need telling. Dismissing hides it for the session, not forever: the card
 * in Settings is the permanent home, this is a nudge, and a nudge that
 * cannot be waved away becomes an advert.
 */
export function PushPrompt() {
  const { state, busy, enable } = usePushDevice();
  const [dismissed, setDismissed] = useState(() => pushPromptDismissed());

  if (state !== 'default' || dismissed) return null;

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
      <Button variant="link" size="sm" loading={busy} onClick={enable}>
        {PUSH_DEVICE_COPY.default.action}
      </Button>
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          dismissPushPrompt();
          setDismissed(true);
        }}
      >
        Not now
      </Button>
    </div>
  );
}
