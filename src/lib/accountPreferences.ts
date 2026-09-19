import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { mergeAccount, useAuth, type User } from './auth';
import { applyAccessibility } from './accessibility';
import { hydrateUnits, setUnitsPersister, type UnitSystem } from './units';
import { browserTimeZone, timezoneSyncDecision } from './timezoneSync';
import type { SettingsPatch } from './accountTypes';
import { useToast } from '../components/ui';

/**
 * Keeps the signed-in account and this browser in step, both ways:
 *
 *   server -> browser  `settings.units` hydrates the units store (no write
 *                      back), `settings.accessibility` becomes the <html>
 *                      attributes styles.css reads.
 *   browser -> server  a member-initiated units change goes through
 *                      `PUT /users/settings { units }` (reverted with a toast
 *                      on failure); the browser's IANA zone is sent as
 *                      `settings.timezone` at sign-in and when the tab comes
 *                      back into view, only when it differs from what the
 *                      account has and from what this session already sent.
 *
 * Mounted once in App as <AccountPreferencesSync /> next to <SessionRefresh />.
 * It never writes for an account with `pendingDeletion` (every ordinary route
 * answers 401 for it, and the interceptor would sign the person out).
 */

const TZ_SENT_KEY = 'vybe.tzSent';

let lastSentZone: string | null = null;
let timezoneInFlight: Promise<void> | null = null;

const readSentZone = (): string | null => {
  if (lastSentZone) return lastSentZone;
  try {
    return sessionStorage.getItem(TZ_SENT_KEY);
  } catch {
    return null;
  }
};

const rememberSentZone = (zone: string) => {
  lastSentZone = zone;
  try {
    sessionStorage.setItem(TZ_SENT_KEY, zone);
  } catch {
    // Memory alone still stops the loop for this page load.
  }
};

/** Store the account a settings PUT answered with, keeping hasPassword and the ['me'] query in step. */
function useApplyAccount() {
  const qc = useQueryClient();
  return (next: User) => {
    const merged = mergeAccount(useAuth.getState().user, next);
    useAuth.getState().setUser(merged);
    if (qc.getQueryData(['me'])) qc.setQueryData(['me'], merged);
  };
}

async function putSettings(patch: SettingsPatch): Promise<User> {
  const { data } = await api.put('/users/settings', patch);
  return (data.user || data) as User;
}

export function useAccountPreferencesSync() {
  const toast = useToast();
  const applyAccount = useApplyAccount();
  const userId = useAuth((s) => s.user?._id ?? null);
  const pendingDeletion = useAuth((s) => s.user?.pendingDeletion === true);
  const units = useAuth((s) => s.user?.settings?.units);
  const timezone = useAuth((s) => s.user?.settings?.timezone);
  const reduceMotion = useAuth((s) => s.user?.settings?.accessibility?.reduceMotion);
  const largeText = useAuth((s) => s.user?.settings?.accessibility?.largeText);

  // Units: the account's choice wins on sign-in; a change made here is saved.
  useEffect(() => {
    if (!userId) {
      setUnitsPersister(null);
      return;
    }
    hydrateUnits(units);
  }, [userId, units]);

  useEffect(() => {
    if (!userId || pendingDeletion) {
      setUnitsPersister(null);
      return;
    }
    setUnitsPersister((system: UnitSystem, previous: UnitSystem) => {
      putSettings({ units: system })
        .then(applyAccount)
        .catch((e) => {
          hydrateUnits(previous);
          toast.error(e, 'Could not save your units.', { key: 'units-save' });
        });
    });
    return () => setUnitsPersister(null);
    // applyAccount and toast are stable enough for a registration; re-register on session change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, pendingDeletion]);

  // Accessibility: the account flags become <html> attributes; signed out, the OS preference stands alone.
  useEffect(() => {
    applyAccessibility(userId ? { reduceMotion, largeText } : null);
  }, [userId, reduceMotion, largeText]);

  // Timezone: at sign-in and on every return to the tab, when it would change something.
  useEffect(() => {
    if (!userId) {
      lastSentZone = null;
      return;
    }
    const sync = () => {
      const decision = timezoneSyncDecision({
        browserZone: browserTimeZone(),
        storedZone: useAuth.getState().user?.settings?.timezone,
        lastSentZone: readSentZone(),
        visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
        pendingDeletion: useAuth.getState().user?.pendingDeletion === true,
      });
      if (decision.action !== 'put' || timezoneInFlight) return;
      const zone = decision.zone;
      rememberSentZone(zone);
      timezoneInFlight = putSettings({ timezone: zone })
        .then(applyAccount)
        .catch(() => {
          // Silent: nothing the person can act on, and the next foreground tries again.
          lastSentZone = null;
          try {
            sessionStorage.removeItem(TZ_SENT_KEY);
          } catch {
            // Nothing to undo.
          }
        })
        .finally(() => {
          timezoneInFlight = null;
        });
    };
    sync();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, timezone, pendingDeletion]);
}

/** Mount once inside the providers; renders nothing. */
export function AccountPreferencesSync() {
  useAccountPreferencesSync();
  return null;
}
