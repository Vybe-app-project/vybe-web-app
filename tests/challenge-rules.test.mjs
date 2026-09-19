/**
 * src/lib/challengeRules.ts mirrors the API's challenge guardrails
 * (services/challengeGuardrails.js + utils/challengeMutation.js at 4e22914).
 * Rows come from tests/v2-be-guardrails.challenges.test.js. Dates are UTC
 * ("Z") so a DST transition on the test machine cannot move a boundary.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = await import('../src/lib/challengeRules.ts');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MESSAGE = 'Vybe does not run challenges scored on body weight.';

test('the module stays import-free so it can be loaded straight from source', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/lib/challengeRules.ts'), 'utf8'), /^\s*import\s/m);
  assert.equal(rules.CHALLENGE_MAX_DAYS_DEFAULT, 365);
  assert.deepEqual([...rules.WEIGHT_SCORED_TYPES], ['weight_loss']);
  assert.deepEqual([...rules.WEIGHT_SCORED_UNITS], ['pounds']);
});

test('isWeightScored covers the type and the unit', () => {
  assert.equal(rules.isWeightScored({ type: 'weight_loss', goalUnit: 'custom' }), true);
  assert.equal(rules.isWeightScored({ type: 'custom', goalUnit: 'pounds' }), true);
  assert.equal(rules.isWeightScored({ type: 'workout', goalUnit: 'workouts' }), false);
  assert.equal(rules.isWeightScored(undefined), false);
  assert.equal(rules.isWeightScored(null), false);
  assert.equal(rules.isWeightScored({}), false);
});

test('checkChallengeType refuses weight_loss on type and pounds on goalUnit with the exact body', () => {
  assert.deepEqual(rules.checkChallengeType({ type: 'weight_loss' }), { code: 'CHALLENGE_TYPE_UNAVAILABLE', field: 'type', message: MESSAGE });
  assert.deepEqual(rules.checkChallengeType({ type: 'weight_loss', goalUnit: 'pounds' }), { code: 'CHALLENGE_TYPE_UNAVAILABLE', field: 'type', message: MESSAGE });
  assert.deepEqual(rules.checkChallengeType({ type: 'custom', goalUnit: 'pounds' }), { code: 'CHALLENGE_TYPE_UNAVAILABLE', field: 'goalUnit', message: MESSAGE });
  assert.equal(rules.checkChallengeType({ type: 'workout', goalUnit: 'workouts' }), null);
  assert.equal(rules.checkChallengeType({ title: 'renamed' }), null);
  assert.equal(rules.checkChallengeType(undefined), null);
  assert.equal(rules.checkChallengeType(null), null);
});

const start = new Date('2026-10-01T00:00:00.000Z');

test('checkEndDate: the server table', () => {
  const rows = [
    ['missing', { startDate: start }, 'endDate is required'],
    ['null', { startDate: start, endDate: null }, 'endDate is required'],
    ['empty string', { startDate: start, endDate: '' }, 'endDate is required'],
    ['garbage', { startDate: start, endDate: 'someday' }, 'endDate must be a valid date'],
    ['invalid Date instance', { startDate: start, endDate: new Date('nope') }, 'endDate must be a valid date'],
    ['equal to start', { startDate: start, endDate: start.toISOString() }, 'endDate must be after startDate'],
    ['before start', { startDate: start, endDate: new Date(start.getTime() - DAY) }, 'endDate must be after startDate'],
    ['366 days out', { startDate: start, endDate: new Date(start.getTime() + 366 * DAY) }, 'endDate must be within 365 days of startDate'],
  ];
  for (const [label, input, message] of rows) {
    assert.deepEqual(rules.checkEndDate(input), { code: 'VALIDATION', field: 'endDate', message }, label);
  }
  assert.equal(rules.checkEndDate({ startDate: start, endDate: new Date(start.getTime() + 365 * DAY) }), null);
  assert.equal(rules.checkEndDate({ startDate: start.toISOString(), endDate: new Date(start.getTime() + HOUR).toISOString() }), null);
  assert.equal(rules.checkEndDate({ startDate: 'never', endDate: start }), null);
  assert.equal(rules.checkEndDate({ endDate: start }), null);
  assert.deepEqual(rules.checkEndDate(), { code: 'VALIDATION', field: 'endDate', message: 'endDate is required' });
  // The max-days argument mirrors CHALLENGE_MAX_DAYS.
  const month = { startDate: start, endDate: new Date(start.getTime() + 31 * DAY) };
  assert.equal(rules.checkEndDate(month), null);
  assert.deepEqual(rules.checkEndDate(month, 30), { code: 'VALIDATION', field: 'endDate', message: 'endDate must be within 30 days of startDate' });
});

test('the T00:00:00 / T23:59:59 trap: 365 calendar days in the pickers is over the line, 364 is not', () => {
  const s = new Date('2026-10-01T00:00:00Z');
  assert.equal(rules.checkEndDate({ startDate: s, endDate: new Date('2027-10-01T23:59:59Z') }).message, 'endDate must be within 365 days of startDate');
  assert.equal(rules.checkEndDate({ startDate: s, endDate: new Date('2027-09-30T23:59:59Z') }), null);
});

test('checkCreateWindow mirrors the normaliser bounds as field errors', () => {
  const now = new Date('2026-09-19T12:00:00Z');
  const ok = { startDate: new Date(now.getTime() - HOUR), endDate: new Date(now.getTime() + 30 * DAY), now };
  assert.equal(rules.checkCreateWindow(ok), null);
  assert.deepEqual(rules.checkCreateWindow({ ...ok, startDate: new Date(now.getTime() - 25 * HOUR) }), { field: 'startDate', message: 'Pick today or a later date.' });
  // A date-only picker sends local midnight; yesterday's midnight is past the 24 h line, so the copy must not offer it.
  const yesterdayMidnight = new Date(2026, 8, 18, 0, 0, 0);
  const noonToday = new Date(2026, 8, 19, 12, 0, 0);
  assert.equal(rules.checkCreateWindow({ ...ok, startDate: yesterdayMidnight, now: noonToday })?.field, 'startDate');
  assert.equal(rules.checkCreateWindow({ ...ok, startDate: new Date(2026, 8, 19, 0, 0, 0), now: noonToday }), null);
  assert.equal(rules.checkCreateWindow({ ...ok, startDate: new Date(now.getTime() - 23 * HOUR) }), null);
  assert.deepEqual(rules.checkCreateWindow({ ...ok, endDate: new Date(now.getTime() - HOUR) }), { field: 'endDate', message: 'Pick an end date in the future.' });
  assert.deepEqual(rules.checkCreateWindow({ ...ok, endDate: now }), { field: 'endDate', message: 'Pick an end date in the future.' });
  assert.deepEqual(rules.checkCreateWindow({ ...ok, endDate: new Date(now.getTime() + 367 * DAY) }), { field: 'endDate', message: 'Pick an end date within a year from today.' });
  assert.equal(rules.checkCreateWindow({ ...ok, endDate: new Date(now.getTime() + 366 * DAY) }), null);
  // Defaults `now` to the clock.
  assert.equal(rules.checkCreateWindow({ startDate: new Date(), endDate: new Date(Date.now() + DAY) }), null);
});

test('humanEndDateMessage turns the six server strings into sentences and leaves the rest alone', () => {
  assert.equal(rules.humanEndDateMessage('endDate is required'), 'Pick an end date.');
  assert.equal(rules.humanEndDateMessage('endDate must be a valid date'), 'Pick a valid end date.');
  assert.equal(rules.humanEndDateMessage('endDate must be after startDate'), 'End date must be after the start.');
  assert.equal(rules.humanEndDateMessage('endDate must be within 365 days of startDate'), 'Keep the challenge to 365 days or fewer.');
  assert.equal(rules.humanEndDateMessage('endDate must be within 30 days of startDate'), 'Keep the challenge to 30 days or fewer.');
  assert.equal(rules.humanEndDateMessage('endDate must be after the start date and in the future'), 'Pick an end date after the start and in the future.');
  assert.equal(rules.humanEndDateMessage('An active challenge with participants can only be extended'), 'People have joined, so the end date can only move later.');
  assert.equal(rules.humanEndDateMessage('something else'), 'something else');
});

test('mapChallengeError: route bodies, the envelope, 426/429, and never a raw programmer string', () => {
  const fallback = 'Could not create the challenge';
  assert.deepEqual(
    rules.mapChallengeError({ success: false, code: 'CHALLENGE_TYPE_UNAVAILABLE', field: 'type', message: MESSAGE }, fallback),
    { kind: 'field', field: 'type', message: MESSAGE, code: 'CHALLENGE_TYPE_UNAVAILABLE' },
  );
  assert.equal(rules.mapChallengeError({ success: false, code: 'CHALLENGE_TYPE_UNAVAILABLE', field: 'goalUnit', message: MESSAGE }, fallback).field, 'goalUnit');
  assert.deepEqual(
    rules.mapChallengeError({ success: false, code: 'VALIDATION', field: 'endDate', message: 'endDate is required' }, fallback),
    { kind: 'field', field: 'endDate', message: 'Pick an end date.', code: 'VALIDATION' },
  );
  assert.equal(rules.mapChallengeError({ success: false, code: 'VALIDATION', field: 'endDate', message: 'endDate must be within 365 days of startDate' }, fallback).message, 'Keep the challenge to 365 days or fewer.');

  const extend = rules.mapChallengeError({ success: false, message: 'An active challenge with participants can only be extended' }, fallback);
  assert.equal(extend.kind, 'field');
  assert.equal(extend.field, 'endDate');
  assert.equal(extend.message, 'People have joined, so the end date can only move later.');
  assert.equal(rules.mapChallengeError({ success: false, message: 'endDate must be after the start date and in the future' }, fallback).field, 'endDate');

  const range = rules.mapChallengeError({ success: false, message: 'Challenge is outside its active date range' }, fallback);
  assert.equal(range.kind, 'form');
  assert.match(range.message, /not running/);
  assert.deepEqual(rules.mapChallengeError({ success: false, message: 'workout challenges do not support pounds progress' }, fallback), {
    kind: 'field',
    field: 'goalUnit',
    message: 'That unit is not tracked for this type. Pick another unit.',
  });
  assert.equal(rules.mapChallengeError({ success: false, message: 'title must not be empty' }, fallback).field, 'title');
  assert.equal(rules.mapChallengeError({ success: false, message: 'description must be 2000 characters or fewer' }, fallback).field, 'description');
  assert.equal(rules.mapChallengeError({ success: false, message: 'goal must be a finite number between 0 and 1000000000' }, fallback).field, 'goal');
  assert.equal(rules.mapChallengeError({ success: false, message: 'type is not supported' }, fallback).field, 'type');
  assert.equal(rules.mapChallengeError({ success: false, message: 'category is not supported' }, fallback).field, 'category');
  assert.equal(rules.mapChallengeError({ success: false, message: 'goalUnit is not supported' }, fallback).field, 'goalUnit');
  assert.deepEqual(rules.mapChallengeError({ success: false, message: 'Challenge dates must run from today through at most one year' }, fallback), {
    kind: 'field',
    field: 'endDate',
    message: 'Start today or later and end within a year from today.',
  });
  assert.equal(rules.mapChallengeError({ success: false, message: 'maxParticipants must be an integer from 1 to 10000' }, fallback).field, 'maxParticipants');
  assert.equal(rules.mapChallengeError({ success: false, message: 'maxParticipants must be an integer between the current participant count and 10000' }, fallback).field, 'maxParticipants');
  assert.equal(rules.mapChallengeError({ success: false, message: 'goalUnitLabel must be 30 characters or fewer' }, fallback).field, 'goalUnitLabel');
  assert.equal(rules.mapChallengeError({ success: false, message: 'tags must be an array with no more than 20 entries' }, fallback).field, 'tags');
  assert.equal(rules.mapChallengeError({ success: false, message: 'rewards must be 500 characters or fewer' }, fallback).field, 'rewards');

  const forms = [
    ['Challenge is not active', /closed/],
    ['You are not participating in this challenge', /Join the challenge first/],
    ['Tracked challenge progress must use auto-update', /Use Sync/],
    ['This challenge requires manual progress updates', /by hand/],
    ['Progress must be a finite number between 0 and 1000000000', /0 or more/],
    ['Only the owner can update this challenge', /Only the creator/],
    ['Only the owner can delete this challenge', /Only the creator/],
    ['Challenge not found', /not available/],
    ['A completed challenge cannot be reactivated', /cannot be reopened/],
  ];
  for (const [message, pattern] of forms) {
    const m = rules.mapChallengeError({ success: false, message }, fallback);
    assert.equal(m.kind, 'form', message);
    assert.match(m.message, pattern, message);
    assert.notEqual(m.message, message);
  }

  assert.deepEqual(rules.mapChallengeError({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r' } }, fallback), { kind: 'form', message: fallback, code: 'NOT_FOUND' });
  assert.match(rules.mapChallengeError({ error: { code: 'BAD_REQUEST', message: 'x' } }, fallback).message, /could not be read/);
  assert.match(rules.mapChallengeError({ success: false, code: 'CLIENT_UPDATE_REQUIRED', message: 'Update' }, fallback).message, /^Reload/);
  assert.match(rules.mapChallengeError({ code: 'RATE_LIMITED', message: 'slow down', retryAfterSec: 5 }, fallback).message, /5 seconds/);

  for (const raw of ['A challenge object is required', 'A challenge update object is required', 'At least one challenge field is required', 'Challenge field cannot be updated: type', 'Challenge field is not supported: foo', 'Error creating challenge']) {
    assert.deepEqual(rules.mapChallengeError({ success: false, message: raw }, fallback), { kind: 'form', message: fallback }, raw);
  }
  assert.deepEqual(rules.mapChallengeError(undefined, fallback), { kind: 'form', message: fallback });
  assert.deepEqual(rules.mapChallengeError([{ title: 'x' }], fallback), { kind: 'form', message: fallback });
});
