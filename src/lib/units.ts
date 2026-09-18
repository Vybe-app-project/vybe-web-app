import { create } from 'zustand';
import { defaultUnitSystem, type UnitSystem } from './unitConversions';

export * from './unitConversions';

/**
 * The person's unit preference (metric or imperial), remembered on this
 * device the same way the theme is. The web goals form spoke kg/cm while the
 * iOS app spoke lb/in and the Hydration page spoke ounces; this is the single
 * switch all three web pages read.
 */
export const UNITS_STORAGE_KEY = 'vybe.units';

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

export const useUnits = create<UnitsState>((set) => ({
  system: read(),
  setSystem: (system) => {
    try {
      localStorage.setItem(UNITS_STORAGE_KEY, system);
    } catch {
      // Not persisted, but still applied for this session.
    }
    set({ system });
  },
}));

export const UNIT_OPTIONS: { key: UnitSystem; label: string; description: string }[] = [
  { key: 'imperial', label: 'lb, ft/in, oz', description: 'Imperial' },
  { key: 'metric', label: 'kg, cm, ml', description: 'Metric' },
];
