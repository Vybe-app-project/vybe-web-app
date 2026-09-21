/**
 * `GET /api/food/barcode/:gtin` — the barcode lookup behind the scan button
 * in the food search header (`capabilities.foodBarcode`).
 *
 * The server answers one of two envelopes and never a bare food:
 *
 *   found  { found: true,  source, food, attribution, cached, fetchedAt?, searched }
 *   miss   { found: false, code, attribution, cached, reason?, searched }
 *
 * `food` is USDA-shaped (`services/openFoodFacts.js` toFoodSearchResult), so
 * it drops straight into the food-search row model: macros live in
 * `foodNutrients` under the USDA ids, the serving is `servingSize` +
 * `servingSizeUnit`, and household measures are `foodPortions`.
 *
 * Attribution is not optional. Open Food Facts data is ODbL and the contract
 * (docs/api-contract.md, "Barcode lookup") hands the client the sentence and
 * the link to print: `attribution.text` with `attribution.url` on a hit and
 * `attribution.contributeUrl` on a miss. Rendering the food without the line
 * would be a licence breach, so `attributionOf` never invents one and the UI
 * shows whatever the server sent, verbatim.
 *
 * Import-free on purpose: tests/meals-barcode.test.mjs transpiles this file
 * and imports the result directly.
 */

/** Lengths `services/openFoodFacts.js` normalizeGtin accepts. */
export const GTIN_LENGTHS = [8, 12, 13, 14] as const;

/** The server's own words for a code that is not one of those lengths. */
export const GTIN_INVALID_HINT = 'A barcode is 8, 12, 13 or 14 digits.';

/**
 * Spaces and dashes out, digits only, one of the four lengths — the same rule
 * the server applies, so a typo is caught before a request is spent on it.
 * Returns null for anything the server would refuse with `GTIN_INVALID`.
 */
export function normalizeGtin(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  return (GTIN_LENGTHS as readonly number[]).includes(digits.length) ? digits : null;
}

/* ------------------------------------------------------------------ wire */

export type BarcodeNutrient = {
  nutrientId?: number;
  nutrientName: string;
  unitName?: string;
  value: number;
};

/** The USDA-shaped food a hit carries; the same row model as `GET /food/search`. */
export type BarcodeFood = {
  gtin?: string;
  description: string;
  brandName?: string;
  brandOwner?: string;
  dataType?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodPortions?: Array<{ label: string; gramWeight: number }>;
  foodNutrients?: BarcodeNutrient[];
  imageUrl?: string;
  image?: { source?: string; url?: string; attribution?: string };
  provenance?: { source?: string; sourceLabel?: string; licence?: string };
};

/**
 * `attribution` on both envelopes. A hit carries `url` (the product page), a
 * miss carries `contributeUrl` (add it to Open Food Facts); a local or USDA
 * hit may carry a null `url` and no licence at all.
 */
export type BarcodeAttribution = {
  text?: string | null;
  url?: string | null;
  contributeUrl?: string | null;
  licence?: string | null;
  licenceUrl?: string | null;
  sourceLabel?: string | null;
};

export type BarcodeTier = 'local' | 'usda' | 'cache' | 'openfoodfacts';

export type BarcodeHit = {
  found: true;
  source: string;
  food: BarcodeFood;
  attribution: BarcodeAttribution;
  cached: boolean;
  fetchedAt?: string;
  searched: BarcodeTier[];
};

export type BarcodeMiss = {
  found: false;
  code: string;
  attribution: BarcodeAttribution;
  cached: boolean;
  /** The only value the server sends today; absent on an ordinary miss. */
  reason?: string;
  searched: BarcodeTier[];
};

export type BarcodeAnswer = BarcodeHit | BarcodeMiss;

/** The one `reason` the API emits: no live tier is configured on this deployment. */
export const REASON_PROVIDER_NOT_CONFIGURED = 'provider_not_configured';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

const attributionOf = (v: unknown): BarcodeAttribution => {
  if (!isRecord(v)) return {};
  return {
    text: text(v.text),
    url: text(v.url),
    contributeUrl: text(v.contributeUrl),
    licence: text(v.licence),
    licenceUrl: text(v.licenceUrl),
    sourceLabel: text(v.sourceLabel),
  };
};

const tiersOf = (v: unknown): BarcodeTier[] =>
  (Array.isArray(v) ? v : []).filter((t): t is BarcodeTier => t === 'local' || t === 'usda' || t === 'cache' || t === 'openfoodfacts');

/**
 * Read either envelope. Anything that is not one of them — an older server, a
 * proxy error page — reads as null, and the caller shows the "couldn't look
 * that up" state rather than a food with no name.
 */
export function parseBarcodeAnswer(body: unknown, sentCode = ''): BarcodeAnswer | null {
  if (!isRecord(body)) return null;
  if (body.found === true) {
    const food = isRecord(body.food) ? (body.food as BarcodeFood) : null;
    if (!food || typeof food.description !== 'string' || !food.description.trim()) return null;
    return {
      found: true,
      source: text(body.source) ?? 'openfoodfacts',
      food,
      attribution: attributionOf(body.attribution),
      cached: body.cached === true,
      ...(text(body.fetchedAt) ? { fetchedAt: String(body.fetchedAt) } : {}),
      searched: tiersOf(body.searched),
    };
  }
  if (body.found === false) {
    return {
      found: false,
      code: text(body.code) ?? sentCode,
      attribution: attributionOf(body.attribution),
      cached: body.cached === true,
      ...(text(body.reason) ? { reason: String(body.reason) } : {}),
      searched: tiersOf(body.searched),
    };
  }
  return null;
}

/**
 * The attribution sentence and its link, exactly as the server worded them.
 * A hit links to the product page, a miss to the contribute form; an entry
 * with no text at all yields null and nothing is printed (a local food).
 */
export function attributionLine(answer: BarcodeAnswer | null | undefined): { text: string; href: string | null; licence: string | null } | null {
  const a = answer?.attribution;
  if (!a) return null;
  const sentence = a.text ?? a.sourceLabel ?? null;
  if (!sentence) return null;
  const href = (answer?.found ? a.url : a.contributeUrl) ?? null;
  return { text: sentence, href, licence: a.licence ?? null };
}

/* -------------------------------------------------- reading the payload */

/**
 * USDA nutrient ids, the same four `nutritionFromFood` reads on the search
 * rows. The barcode payload carries no flat `calories`/`protein` pair — the
 * macros are rows in `foodNutrients` — so the preview in the scan sheet
 * has to pull them out the same way.
 */
export const BARCODE_NUTRIENT_IDS = Object.freeze({ calories: 1008, protein: 1003, carbs: 1005, fat: 1004 });

export type BarcodeMacros = { calories: number; protein: number; carbs: number; fat: number };

/** The four macros of one base serving, rounded to a tenth as the log does. */
export function barcodeMacros(food: BarcodeFood | null | undefined): BarcodeMacros {
  const byId = new Map<number, number>();
  for (const n of food?.foodNutrients ?? []) {
    if (typeof n?.nutrientId === 'number' && typeof n.value === 'number') byId.set(n.nutrientId, n.value);
  }
  const pick = (id: number) => Math.round((byId.get(id) ?? 0) * 10) / 10;
  return {
    calories: pick(BARCODE_NUTRIENT_IDS.calories),
    protein: pick(BARCODE_NUTRIENT_IDS.protein),
    carbs: pick(BARCODE_NUTRIENT_IDS.carbs),
    fat: pick(BARCODE_NUTRIENT_IDS.fat),
  };
}

/**
 * What one serving of this row is, in words: the household measure the
 * label prints where there is one, else the numeric serving, else the
 * per-100 g basis. Never a bare "1 serving" when the payload said more.
 */
export function servingTextOf(food: BarcodeFood | null | undefined): string {
  const household = typeof food?.householdServingFullText === 'string' ? food.householdServingFullText.trim() : '';
  if (household) return household;
  if (typeof food?.servingSize === 'number' && food.servingSize > 0) {
    return `${food.servingSize}${food.servingSizeUnit ? ` ${food.servingSizeUnit}` : ''}`;
  }
  return '1 serving';
}

/* ------------------------------------------------------------------ copy */

export const SCAN_LABEL = 'Scan a barcode';
export const SCAN_TITLE = 'Scan a barcode';
export const SCAN_HINT = 'Point the camera at the barcode on the packet. It scans on its own.';
export const TYPE_CODE_LABEL = 'Type the barcode';
export const TYPE_CODE_HINT = 'The digits printed under the bars. 8, 12, 13 or 14 of them.';
export const LOOKUP_LABEL = 'Look it up';
export const SCANNING = 'Looking for a barcode…';
export const LOOKING_UP = 'Looking up that code…';
export const CREATE_FOOD = 'Create food';
export const NOT_FOUND_TITLE = 'No product for that code';
export const CAMERA_UNAVAILABLE = 'This browser cannot scan a barcode, so type the digits instead.';
export const CAMERA_BLOCKED = 'Camera access was refused, so type the digits instead.';

/** Copy for a miss. `provider_not_configured` is a server state, not a bad code. */
export function missCopy(answer: BarcodeMiss): string {
  if (answer.reason === REASON_PROVIDER_NOT_CONFIGURED) {
    return 'Barcode lookup is not switched on for this server yet. You can still add the food yourself.';
  }
  return 'That barcode is not in the food database yet. Create the food once and it is yours from then on.';
}

/**
 * The server's errors, as one sentence each. 429 carries `retryAfterSec`, so
 * the wait is quoted rather than guessed; 503 is upstream, not the code.
 */
export function lookupErrorCopy(error: unknown, fallback = 'Could not look up that barcode.'): string {
  const response = (error as { response?: { status?: number; data?: unknown } } | undefined)?.response;
  const status = response?.status;
  const data = isRecord(response?.data) ? response!.data as Record<string, unknown> : {};
  const code = text(data.code);
  if (status === 400 && code === 'GTIN_INVALID') return GTIN_INVALID_HINT;
  if (status === 429) {
    const wait = Number(data.retryAfterSec);
    const seconds = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : null;
    return seconds ? `Too many lookups. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.` : 'Too many lookups. Try again in a moment.';
  }
  if (status === 503) return text(data.message) ?? 'Could not reach the food database. Try again in a moment, or type the macros yourself.';
  return text(data.message) ?? fallback;
}
