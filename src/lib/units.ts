import { create } from 'zustand';
import { defaultUnitSystem, type UnitSystem } from './unitConversions';

export * from './unitConversions';

/**
 * The person's unit preference (metric or imperial), remembered on this
 * device the same way the theme is. The web goals form spoke kg/cm while the
 * iOS app spoke lb/in and the Hydration page spoke ounces; this is the single
 * switch all three web pages read.
 *
 * When signed in the account's `settings.units` is the source of truth:
 * lib/accountPreferences hydrates the store from it at sign-in
 * (`hydrateUnits`, no write-back) and registers a persister that sends a
 * member-initiated change through `PUT /users/settings { units }`
 * (`setUnitsPersister`). Signed out, the device copy stands alone.
 */
export const UNITS_STORAGE_KEY = 'vybe.units';

const writeLocal = (system: UnitSystem) => {
  try {
    localStorage.setItem(UNITS_STORAGE_KEY, system);
  } catch {
    // Not persisted, but still applied for this session.
  }
};

const read = (): UnitSystem => {
  try {
    const stored = localStorage.getItem(UNITS_STORAGE_KEY);
    if (stored === 'metric' || stored === 'imperial') return stored;
  } catch {
    // Storage can be unavailable (privacy mode); fall back to the locale.
  }
  return defaultUnitSystem(typeof navigator !== 'undefined' ? navigator.language : undefined);
};

type UnitsState = {
  system: UnitSystem;
  setSystem: (system: UnitSystem) => void;
};

/** Called after a member-initiated change with the new and the previous system; null when signed out. */
export type UnitsPersister = ((system: UnitSystem, previous: UnitSystem) => void) | null;
let persister: UnitsPersister = null;

/** Registered by lib/accountPreferences while a session exists; only `setSystem` calls it. */
export const setUnitsPersister = (fn: UnitsPersister) => {
  persister = fn;
};

/** Apply the account's saved system (or nothing when it has none) without writing back to the server. */
export const hydrateUnits = (system: UnitSystem | string | null | undefined) => {
  if (system !== 'metric' && system !== 'imperial') return;
  writeLocal(system);
  if (useUnits.getState().system !== system) useUnits.setState({ system });
};

export const useUnits = create<UnitsState>((set, get) => ({
  system: read(),
  setSystem: (system) => {
    const previous = get().system;
    writeLocal(system);
    set({ system });
    if (system !== previous) persister?.(system, previous);
  },
}));

export const UNIT_OPTIONS: { key: UnitSystem; label: string; description: string }[] = [
  { key: 'imperial', label: 'lb, ft/in, oz', description: 'Imperial' },
  { key: 'metric', label: 'kg, cm, ml', description: 'Metric' },
];
