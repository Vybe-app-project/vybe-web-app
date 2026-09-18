import { Tabs } from './ui';
import { UNIT_OPTIONS, useUnits, type UnitSystem } from '../lib/units';

/**
 * Metric / imperial switch. One preference drives the goals form (kg/cm vs
 * lb/ft-in), the Hydration page (ml vs oz) and the Health tiles, so the web
 * no longer talks kilograms on one page and ounces on the next.
 */
export function UnitsControl({ className, label = 'Units', size = 'md' }: { className?: string; label?: string; size?: 'sm' | 'md' }) {
  const system = useUnits((s) => s.system);
  const setSystem = useUnits((s) => s.setSystem);
  return (
    <Tabs
      variant="segmented"
      size={size}
      aria-label={label}
      className={className}
      tabs={UNIT_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
      value={system}
      onChange={(k: string) => setSystem(k as UnitSystem)}
    />
  );
}
