/**
 * Date of birth at sign-up (`services/ageGate.js`).
 *
 * `POST /auth/register-password` takes `birthDate` as the ISO calendar day
 * `'YYYY-MM-DD'` and nothing else — no `Date`, no timestamp, no `DD/MM/YYYY`.
 * It is optional on the deployed server (`AGE_GATE_REQUIRE_BIRTHDATE` is
 * off, decision D-08 is still at its default), and an account under the
 * minimum age is refused with `400 { code: 'AGE_REQUIREMENT', field:
 * 'birthDate' }`. This module is the client half of that rule, so the block
 * happens before a request is spent and the copy is ours rather than the
 * server's.
 *
 * Nothing derived is stored anywhere: the date goes to the API and the API
 * recomputes the band whenever it needs one. `ageBandFor` is here only so
 * the wizard can word the block, and it mirrors the server's four literal
 * bands exactly.
 *
 * There is no route that writes `birthDate` after registration — not
 * `PUT /users/me` (allow-list: fullName, username, bio, website, location),
 * not `PUT /users/settings` (allow-list rejects unknown keys outright), not
 * `/api/me/*`. So Settings can show the date and nothing more.
 *
 * Import-free on purpose: tests/auth-oauth-dob.test.mjs transpiles this file
 * and imports the result directly.
 */

/** `services/ageGate.js` DEFAULT_MINIMUM_AGE; the server's `MINIMUM_AGE` env can raise it. */
export const MINIMUM_AGE = 13;
/** `services/ageGate.js` MAX_AGE_YEARS: older than this is a typo, not a person. */
export const MAX_AGE_YEARS = 120;

/** The server's own wording, so a client refusal and a server refusal read the same. */
export const BIRTH_DATE_MESSAGES = Object.freeze({
  missing: 'Enter your date of birth',
  malformed: 'Enter your date of birth as YYYY-MM-DD',
  implausible: 'Enter a valid date of birth',
});

export const AGE_REQUIREMENT_MESSAGE = 'Vybe is not available for your age yet.';
export const AGE_REQUIREMENT_CODE = 'AGE_REQUIREMENT';

/* The block. Neutral: it states the rule, not a judgement, and offers the
   one door that is left — support, who can answer a question about it. */
export const UNDER_MIN_TITLE = 'Vybe is not available for your age yet';
export const UNDER_MIN_BODY = 'You need to be at least 13 to have a Vybe account. Nothing has been created and the date you entered has not been sent anywhere.';
export const UNDER_MIN_SUPPORT = 'Contact support';
export const UNDER_MIN_SUPPORT_HREF = '/support';

/** The field label and the sentence under it. Asked once, never shown to anyone else. */
export const BIRTH_DATE_LABEL = 'Date of birth';
export const BIRTH_DATE_HINT = 'Only you can see this. It is used to keep Vybe age-appropriate and cannot be changed later.';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Today as the server sees a calendar day. */
export const todayIso = (now: Date = new Date()): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** The oldest date the server will take, for the field's `min`. */
export const oldestIso = (now: Date = new Date()): string =>
  `${now.getFullYear() - MAX_AGE_YEARS}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export type BirthDateProblem = 'missing' | 'malformed' | 'implausible';

/**
 * What is wrong with this value, in the server's own vocabulary. An empty
 * value is `missing` only when the caller asks for it: the field is optional
 * today, so an untouched field is not an error.
 */
export function birthDateProblem(value: unknown, options: { required?: boolean; now?: Date } = {}): BirthDateProblem | null {
  const now = options.now ?? new Date();
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return options.required ? 'missing' : null;
  const match = ISO_DATE.exec(raw);
  if (!match) return 'malformed';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return 'malformed';
  if (day < 1 || day > daysInMonth(year, month)) return 'malformed';
  if (raw > todayIso(now)) return 'implausible';
  if (raw < oldestIso(now)) return 'implausible';
  return null;
}

/** The problem as the sentence to show under the field. */
export function birthDateError(value: unknown, options: { required?: boolean; now?: Date } = {}): string | null {
  const problem = birthDateProblem(value, options);
  return problem ? BIRTH_DATE_MESSAGES[problem] : null;
}

/** Whole years completed on `now`, by the calendar; null when the value is not a date. */
export function ageOn(value: unknown, now: Date = new Date()): number | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = ISO_DATE.exec(raw);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = now.getFullYear() - year;
  const beforeBirthday = now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

/** The refusal the wizard applies itself, so no under-13 date is ever sent. */
export function isUnderMinimum(value: unknown, now: Date = new Date(), minimumAge: number = MINIMUM_AGE): boolean {
  const age = ageOn(value, now);
  return age !== null && age < minimumAge;
}

export type AgeBand = 'under_min' | '13_15' | '16_17' | 'adult';

/** `services/ageGate.js` ageBandFor, verbatim. Null when there is no date. */
export function ageBandFor(value: unknown, now: Date = new Date(), minimumAge: number = MINIMUM_AGE): AgeBand | null {
  const age = ageOn(value, now);
  if (age === null) return null;
  if (age < minimumAge) return 'under_min';
  if (age < 16) return '13_15';
  if (age < 18) return '16_17';
  return 'adult';
}

/**
 * The server's 400 for this field, as `{ underMinimum, message }`. Both the
 * `AGE_REQUIREMENT` refusal and the `VALIDATION` one name `field:
 * 'birthDate'`, so either can be put under the input rather than in a page
 * banner.
 */
export function birthDateApiError(error: unknown): { underMinimum: boolean; message: string } | null {
  const response = (error as { response?: { status?: number; data?: unknown } } | undefined)?.response;
  if (response?.status !== 400) return null;
  const body = response.data && typeof response.data === 'object' ? (response.data as { code?: unknown; field?: unknown; message?: unknown }) : {};
  if (body.field !== 'birthDate') return null;
  const message = typeof body.message === 'string' && body.message ? body.message : BIRTH_DATE_MESSAGES.malformed;
  return { underMinimum: body.code === AGE_REQUIREMENT_CODE, message };
}

/**
 * `GET /users/me` omits `birthDate` entirely when it was never given (a
 * Mongoose unset path), so "missing" is key absence and not a null. Returns
 * the `YYYY-MM-DD` day for a stored ISO timestamp, or null.
 */
export function storedBirthDate(user: unknown): string | null {
  const value = (user as { birthDate?: unknown } | null | undefined)?.birthDate;
  if (typeof value !== 'string' || !value) return null;
  const day = value.slice(0, 10);
  return ISO_DATE.test(day) ? day : null;
}
