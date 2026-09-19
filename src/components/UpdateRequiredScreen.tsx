import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, useFocusTrap, useLockBody } from './ui';
import { isTextEntryActive, reloadForUpdate, shouldAutoReload, useClientPolicy, type UpdateRequiredNotice } from '../lib/clientPolicy';

/**
 * The 426 screen. The API answered CLIENT_UPDATE_REQUIRED: this bundle is
 * below the floor the operator set (CLIENT_MIN_VERSION_WEB), and every route
 * but capabilities/version will keep refusing it. The web is always on the
 * newest build after a reload, so the one action is "Reload Vybe". It runs by
 * itself after a few seconds, and says so, unless:
 *  - the person was typing when the 426 arrived (a reload would discard the
 *    text, so the button waits for them), or
 *  - this tab already reloaded for a 426 within the last minute (then the
 *    floor is above the newest build and reloading again would loop; the
 *    honest next step is to wait for the deploy).
 * No dismiss: nothing behind it works.
 */

const DEFAULT_MESSAGE = 'This version of Vybe is out of date. Update to keep logging and messaging. Your workouts are saved.';
const NEXT_STEP_AUTO = 'A newer version of Vybe is ready. Vybe will reload in a moment to pick it up. You stay signed in.';
const NEXT_STEP_MANUAL = 'A newer version of Vybe is ready. Reloading picks it up and keeps you signed in.';
const LOOP_HINT = 'If this keeps happening, Vybe is still being updated. Try again in a few minutes.';
/** Long enough to hear the three sentences before the page goes (WCAG 2.2.1); the button is there for anyone who does not want to wait. */
const AUTO_RELOAD_DELAY_MS = 6_000;

type ReloadMode = 'auto' | 'manual' | 'loop';

const subscribe = (listener: () => void) => useClientPolicy.subscribe(listener);
const readNotice = () => useClientPolicy.getState().updateRequired;

/**
 * The latch, read live. zustand's own hook renders a store's INITIAL state
 * under react-dom/server (useSyncExternalStore's server snapshot), which
 * would hide a latched notice from the render tests; the same snapshot on
 * both sides shows what is actually latched.
 */
function useUpdateRequiredNotice(): UpdateRequiredNotice | null {
  return useSyncExternalStore(subscribe, readNotice, readNotice);
}

/** Decided once per mount, before the focus trap moves focus off whatever the person was typing in. */
function decideReloadMode(): ReloadMode {
  if (!shouldAutoReload()) return 'loop';
  return isTextEntryActive() ? 'manual' : 'auto';
}

export function UpdateRequiredScreen() {
  const notice = useUpdateRequiredNotice();
  return notice ? <UpdateRequiredDialog message={notice.message} /> : null;
}

function UpdateRequiredDialog({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode] = useState<ReloadMode>(decideReloadMode);
  const [reloading, setReloading] = useState(false);
  useLockBody(true);
  useFocusTrap(true, ref);

  useEffect(() => {
    if (mode !== 'auto') return;
    const timer = window.setTimeout(() => {
      setReloading(true);
      void reloadForUpdate();
    }, AUTO_RELOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const reload = () => {
    setReloading(true);
    void reloadForUpdate();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
      aria-describedby="update-required-body"
      tabIndex={-1}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-scrim p-4 outline-none"
    >
      <div className="w-full max-w-md rounded-lg border border-line bg-surface-1 p-6 text-text-1 shadow-3">
        <h1 id="update-required-title" className="type-heading text-xl">
          Reload Vybe
        </h1>
        <div id="update-required-body" className="mt-3 space-y-2 text-sm text-text-2">
          <p>{message || DEFAULT_MESSAGE}</p>
          <p>{mode === 'auto' ? NEXT_STEP_AUTO : NEXT_STEP_MANUAL}</p>
          {mode === 'loop' ? <p>{LOOP_HINT}</p> : null}
        </div>
        <div className="mt-6">
          <Button type="button" variant="primary" size="lg" block autoFocus loading={reloading} onClick={reload}>
            Reload Vybe
          </Button>
        </div>
      </div>
    </div>
  );
}
