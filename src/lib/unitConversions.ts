/**
 * Unit conversions for body stats and hydration. Import-free on purpose so
 * tests/units.test.mjs can load it straight from source (see
 * tests/password-reset.test.mjs for the pattern).
 *
 * The API is metric (kg, cm, kg/week) and hydration is stored in oz/ml/cups
 * per log; this module only changes what the person sees and types.
 */

export type UnitSystem = 'metric' | 'imperial';

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const ML_PER_FL_OZ = 29.5735;

const round = (value: number, digits: number) => {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
};

export const kgToLb = (kg: number) => round(kg / KG_PER_LB, 1);
export const lbToKg = (lb: number) => round(lb * KG_PER_LB, 2);
export const cmToIn = (cm: number) => round(cm / CM_PER_IN, 1);
export const inToCm = (inches: number) => round(inches * CM_PER_IN, 1);
export const ozToMl = (oz: number) => Math.round(oz * ML_PER_FL_OZ);
export const mlToOz = (ml: number) => round(ml / ML_PER_FL_OZ, 1);

/** Whole feet and remaining inches (rounded to the nearest inch) for a height in cm. */
export const cmToFeetInches = (cm: number): { feet: number; inches: number } => {
  const totalInches = Math.round(cm / CM_PER_IN);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
};

export const feetInchesToCm = (feet: number, inches: number) => round((feet * 12 + inches) * CM_PER_IN, 1);

/** "5 ft 11 in" */
export const formatFeetInches = (cm: number) => {
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet} ft ${inches} in`;
};

/** Weight for display in the chosen system, e.g. 81.6 kg -> "180 lb". */
export const formatWeight = (kg: number, system: UnitSystem) =>
  system === 'imperial' ? `${kgToLb(kg).toLocaleString(undefined, { maximumFractionDigits: 1 })} lb` : `${round(kg, 1).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;

export const weightUnit = (system: UnitSystem) => (system === 'imperial' ? 'lb' : 'kg');
export const heightUnit = (system: UnitSystem) => (system === 'imperial' ? 'ft/in' : 'cm');
export const paceUnit = (system: UnitSystem) => (system === 'imperial' ? 'lb / week' : 'kg / week');
export const volumeUnit = (system: UnitSystem) => (system === 'imperial' ? 'oz' : 'ml');

/** Weight shown in the chosen unit; the API value stays kg. */
export const displayWeight = (kg: number, system: UnitSystem) => (system === 'imperial' ? kgToLb(kg) : round(kg, 1));
export const parseWeight = (shown: number, system: UnitSystem) => (system === 'imperial' ? lbToKg(shown) : shown);

/** Hydration amounts: stored oz, shown as oz or ml. */
export const displayVolume = (oz: number, system: UnitSystem) => (system === 'imperial' ? round(oz, 1) : ozToMl(oz));

/**
 * Validation ranges the goals form applies, in the shown unit. The API
 * enforces the metric ones (20-500 kg, 80-260 cm, 0-2 kg/week).
 */
export const goalRanges = (system: UnitSystem) =>
  system === 'imperial'
    ? { weight: { min: 44, max: 1102 }, heightIn: { min: 31, max: 102 }, pace: { min: 0, max: 4.4 } }
    : { weight: { min: 20, max: 500 }, heightIn: { min: 80, max: 260 }, pace: { min: 0, max: 2 } };

/** US-style locales default to imperial; everything else to metric. */
export const defaultUnitSystem = (locale: string | undefined): UnitSystem =>
  /^en-(US|LR|MM)$/i.test(locale ?? '') ? 'imperial' : 'metric';

/* ------------------------------------------------------------------ distance (progression hub) */

/** Distances on the wire are kilometres (workout records: longestDistanceKm, history distanceKm). */
export const KM_PER_MI = 1.609344;

export const kmToMi = (km: number) => round(km / KM_PER_MI, 1);
export const miToKm = (mi: number) => round(mi * KM_PER_MI, 2);
export const distanceUnit = (system: UnitSystem) => (system === 'imperial' ? 'mi' : 'km');
