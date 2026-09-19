/**
 * Challenge guardrails, mirrored from the API so the create and edit forms
 * refuse what the server would refuse, with plain copy instead of the
 * server's field-named strings.
 *
 * Sources (backend at 4e22914): services/challengeGuardrails.js
 * (weight-scored refusal, end-date rule) and utils/challengeMutation.js
 * (the create window: start no earlier than yesterday, end in the future and
 * within a year). The server table in tests/v2-be-guardrails.challenges.test.js
 * is ported to tests/challenge-rules.test.mjs.
 *
 * CHALLENGE_MAX_DAYS is an environment variable on the server and no
 * endpoint exposes it, so the documented default (365) lives here. If an
 * operator shortens it, the pre-check passes what the server refuses and the
 * 400 lands inline one round-trip later, still on the end-date field.
 *
 * Import-free on purpose (tests can load it straight from source).
 */

export const CHALLENGE_TYPE_UNAVAILABLE = 'CHALLENGE_TYPE_UNAVAILABLE';
export const CHALLENGE_VALIDATION = 'VALIDATION';
export const CLIENT_UPDATE_REQUIRED = 'CLIENT_UPDATE_REQUIRED';
export const RATE_LIMITED = 'RATE_LIMITED';

export const TYPE_UNAVAILABLE_MESSAGE = 'Vybe does not run challenges scored on body weight.';

export const WEIGHT_SCORED_TYPES: readonly string[] = ['weight_loss'];
export const WEIGHT_SCORED_UNITS: readonly string[] = ['pounds'];

/** Documented default for CHALLENGE_MAX_DAYS; the API does not expose it. */
export const CHALLENGE_MAX_DAYS_DEFAULT = 365;

/** The normaliser's create window (utils/challengeMutation.js): start ≥ now − 24 h, end > now, end ≤ now + 366 d. */
export const CHALLENGE_CREATE_WINDOW = { pastGraceHours: 24, futureMaxDays: 366 } as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** True when the challenge (or payload) is scored on body weight. */
export function isWeightScored(c: { type?: string; goalUnit?: string } | null | undefined): boolean {
  if (!c) return false;
  return (c.type !== undefined && WEIGHT_SCORED_TYPES.includes(c.type)) || (c.goalUnit !== undefined && WEIGHT_SCORED_UNITS.includes(c.goalUnit));
}

export type TypeRefusal = { code: typeof CHALLENGE_TYPE_UNAVAILABLE; field: 'type' | 'goalUnit'; message: string };

/** Refuse a create/patch body that names a weight-scored type or unit; only the keys present are judged. */
export function checkChallengeType(body: { type?: string; goalUnit?: string } | null | undefined): TypeRefusal | null {
  if (!body || typeof body !== 'object') return null;
  if (body.type !== undefined && WEIGHT_SCORED_TYPES.includes(body.type)) {
    return { code: CHALLENGE_TYPE_UNAVAILABLE, field: 'type', message: TYPE_UNAVAILABLE_MESSAGE };
  }
  if (body.goalUnit !== undefined && WEIGHT_SCORED_UNITS.includes(body.goalUnit)) {
    return { code: CHALLENGE_TYPE_UNAVAILABLE, field: 'goalUnit', message: TYPE_UNAVAILABLE_MESSAGE };
  }
  return null;
}

type DateLike = Date | string | number | null | undefined;

const toDate = (value: DateLike): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export type EndDateRefusal = { code: typeof CHALLENGE_VALIDATION; field: 'endDate'; message: string };

const endDateError = (message: string): EndDateRefusal => ({ code: CHALLENGE_VALIDATION, field: 'endDate', message });

/**
 * The end-date rule shared by create and patch, judged on the exact instants
 * to be sent. `startDate` is the request's value on create and the stored
 * one on patch. An unparseable start is not this rule's finding (null); a
 * missing or malformed end always is. Messages are the server's, verbatim;
 * pass them through `humanEndDateMessage` before showing them.
 */
export function checkEndDate(
  { startDate, endDate }: { startDate?: DateLike; endDate?: DateLike } = {},
  maxDays: number = CHALLENGE_MAX_DAYS_DEFAULT,
): EndDateRefusal | null {
  if (endDate === undefined || endDate === null || endDate === '') return endDateError('endDate is required');
  const end = toDate(endDate);
  if (!end) return endDateError('endDate must be a valid date');
  const start = toDate(startDate);
  if (!start) return null;
  if (end <= start) return endDateError('endDate must be after startDate');
  if (end.getTime() - start.getTime() > maxDays * DAY_MS) return endDateError(`endDate must be within ${maxDays} days of startDate`);
  return null;
}

export type CreateWindowRefusal = { field: 'startDate' | 'endDate'; message: string };

/**
 * The normaliser's extra bounds on create, as field errors in plain copy.
 * The server answers all three with one sentence ('Challenge dates must run
 * from today through at most one year'); here each lands on its own field.
 */
export function checkCreateWindow({ startDate, endDate, now = new Date() }: { startDate: Date; endDate: Date; now?: Date }): CreateWindowRefusal | null {
  if (startDate.getTime() < now.getTime() - CHALLENGE_CREATE_WINDOW.pastGraceHours * HOUR_MS) {
    return { field: 'startDate', message: 'Pick a start date no earlier than yesterday.' };
  }
  if (endDate.getTime() <= now.getTime()) return { field: 'endDate', message: 'Pick an end date in the future.' };
  if (endDate.getTime() > now.getTime() + CHALLENGE_CREATE_WINDOW.futureMaxDays * DAY_MS) {
    return { field: 'endDate', message: 'Pick an end date within a year from today.' };
  }
  return null;
}

/** The server's end-date strings as sentences; anything unknown passes through unchanged. */
export function humanEndDateMessage(serverMessage: string): string {
  if (serverMessage === 'endDate is required') return 'Pick an end date.';
  if (serverMessage === 'endDate must be a valid date') return 'Pick a valid end date.';
  if (serverMessage === 'endDate must be after startDate') return 'End date must be after the start.';
  const within = /^endDate must be within (\d+) days/.exec(serverMessage);
  if (within) return `Keep the challenge to ${Number(within[1]).toLocaleString('en-US')} days or fewer.`;
  if (serverMessage === 'endDate must be after the start date and in the future') return 'Pick an end date after the start and in the future.';
  if (serverMessage === 'An active challenge with participants can only be extended') return 'People have joined, so the end date can only move later.';
  return serverMessage;
}

/* ------------------------------------------------------------ error mapper */

export type ChallengeField =
  | 'type'
  | 'goalUnit'
  | 'endDate'
  | 'startDate'
  | 'title'
  | 'description'
  | 'category'
  | 'goal'
  | 'maxParticipants'
  | 'goalUnitLabel'
  | 'tags'
  | 'rewards';

export type ChallengeApiError =
  | { kind: 'field'; field: ChallengeField; message: string; code?: string }
  | { kind: 'form'; message: string; code?: string };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Plain `{ success:false, message }` bodies that name a form field, by the prefix the normaliser writes. */
const FIELD_MESSAGES: Array<[RegExp, ChallengeField, string]> = [
  [/^title must/, 'title', 'Give it a title of 3 to 120 characters.'],
  [/^description must/, 'description', 'Describe the challenge in 10 to 2,000 characters.'],
  [/^goal must/, 'goal', 'Goal must be a positive number.'],
  [/challenges do not support .* progress$/, 'goalUnit', 'That unit is not tracked for this type. Pick another unit.'],
  [/^goalUnit is not supported/, 'goalUnit', 'Choose an option.'],
  [/^type is not supported/, 'type', 'Choose an option.'],
  [/^category is not supported/, 'category', 'Choose an option.'],
  [/^Challenge dates must run/, 'endDate', 'Start no earlier than yesterday and end within a year from today.'],
  [/^maxParticipants must/, 'maxParticipants', 'Between 1 and 10,000, and not below the people already in.'],
  [/^endDate must be after the start date/, 'endDate', humanEndDateMessage('endDate must be after the start date and in the future')],
  [/can only be extended$/, 'endDate', humanEndDateMessage('An active challenge with participants can only be extended')],
  [/^goalUnitLabel/, 'goalUnitLabel', 'Keep the unit under 30 characters.'],
  [/^tags must|^Each tag/, 'tags', 'Up to 20 tags, each 1 to 50 characters.'],
  [/^rewards must/, 'rewards', 'Keep rewards under 500 characters.'],
];

/** Plain bodies from join, progress, sync, edit and delete that concern the whole challenge. */
const FORM_MESSAGES: Array<[RegExp, string]> = [
  [/^Challenge is not active$/, 'This challenge is closed.'],
  [/^Challenge is outside its active date range$/, 'This challenge is not running right now.'],
  [/^You are not participating in this challenge$/, 'Join the challenge first.'],
  [/^Tracked challenge progress must use auto-update$/, 'Progress here comes from your logged activity. Use Sync.'],
  [/^This challenge requires manual progress updates$/, 'Enter your progress by hand for this challenge.'],
  [/^Progress must be a finite number/, 'Enter a progress number of 0 or more.'],
  [/^Only the owner can (update|delete) this challenge$/, 'Only the creator can change this challenge.'],
  [/^Challenge not found$/, 'This challenge is not available.'],
  [/^A completed challenge cannot be reactivated$/, 'A finished challenge cannot be reopened.'],
  [/^Challenge is full$/, 'This challenge is full.'],
  [/^Already participating/, 'You are already in this challenge.'],
];

/**
 * Turn the `response.data` of a failed challenge call into a field message
 * or a form-level sentence. Handles the route bodies
 * `{ success:false, code?, field?, message }`, the final-handler envelope
 * `{ error: { code, message } }`, 426 and 429. Programmer-facing strings
 * ('A challenge object is required', 'Challenge field ...') become the
 * fallback, never the raw text.
 */
export function mapChallengeError(data: unknown, fallback: string): ChallengeApiError {
  const d = asRecord(data);
  if (!d) return { kind: 'form', message: fallback };

  const message = typeof d.message === 'string' ? d.message : '';

  if (d.code === CHALLENGE_TYPE_UNAVAILABLE) {
    const field: ChallengeField = d.field === 'goalUnit' ? 'goalUnit' : 'type';
    return { kind: 'field', field, message: message || TYPE_UNAVAILABLE_MESSAGE, code: CHALLENGE_TYPE_UNAVAILABLE };
  }
  if (d.code === CHALLENGE_VALIDATION && d.field === 'endDate') {
    return { kind: 'field', field: 'endDate', message: humanEndDateMessage(message || 'endDate is required'), code: CHALLENGE_VALIDATION };
  }
  if (d.code === CLIENT_UPDATE_REQUIRED) {
    return { kind: 'form', message: 'Reload the page to get the latest version of Vybe.', code: CLIENT_UPDATE_REQUIRED };
  }
  if (d.code === RATE_LIMITED) {
    const wait = typeof d.retryAfterSec === 'number' && d.retryAfterSec > 0 ? ` Try again in ${Math.ceil(d.retryAfterSec)} seconds.` : ' Try again in a moment.';
    return { kind: 'form', message: `Too many changes at once.${wait}`, code: RATE_LIMITED };
  }

  const envelope = asRecord(d.error);
  if (envelope) {
    const code = typeof envelope.code === 'string' ? envelope.code : undefined;
    if (code === 'BAD_REQUEST') return { kind: 'form', message: 'That request could not be read. Try again.', code };
    if (code === 'PAYLOAD_TOO_LARGE') return { kind: 'form', message: 'That is too much to send at once.', code };
    return { kind: 'form', message: fallback, code };
  }

  for (const [pattern, field, copy] of FIELD_MESSAGES) {
    if (pattern.test(message)) return { kind: 'field', field, message: copy };
  }
  for (const [pattern, copy] of FORM_MESSAGES) {
    if (pattern.test(message)) return { kind: 'form', message: copy };
  }
  return { kind: 'form', message: fallback };
}
