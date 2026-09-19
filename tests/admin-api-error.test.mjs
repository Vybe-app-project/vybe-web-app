import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Every error body the API can send to the console (docs/api-contract.md
 * "Error shapes", utils/logger.js final handler, middlewares/userWriteLimit.js,
 * app.js global limiter) read through src/lib/apiError.ts, plus the errMsg
 * fix in src/lib/api.ts for the { error: { message } } envelope.
 */
const { apiErrorDetails, describeAdminError, isRateLimited } = await import('../src/lib/apiError.ts');

// api.ts touches localStorage in a try/catch and `location` only inside the
// 401 handler; a bare `location` shim keeps any future top-level read safe.
globalThis.location ??= { pathname: '/', search: '', href: '' };
const { errMsg } = await import('../src/lib/api.ts');

const axiosError = (status, data, headers = {}) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data, headers },
  config: {},
});

test('the final-handler envelope yields code, message and requestId from the body', () => {
  const e = axiosError(404, { error: { code: 'NOT_FOUND', message: 'Route not found', requestId: 'req-3f9a1c2e-77' } }, { 'x-request-id': 'header-id' });
  const d = apiErrorDetails(e);
  assert.equal(d.status, 404);
  assert.equal(d.code, 'NOT_FOUND');
  assert.equal(d.message, 'Route not found');
  assert.equal(d.requestId, 'req-3f9a1c2e-77', 'the body wins over the header');
  assert.equal(d.retryAfterSec, null);
  assert.equal(d.offline, false);
  assert.equal(describeAdminError(e), 'Route not found (NOT_FOUND · request req-3f9a)');
});

test('a route-level { message } picks the request id up from the X-Request-Id header', () => {
  const e = axiosError(404, { message: 'Report not found' }, { 'x-request-id': 'abcdef1234567890' });
  const d = apiErrorDetails(e);
  assert.equal(d.code, null);
  assert.equal(d.message, 'Report not found');
  assert.equal(d.requestId, 'abcdef1234567890');
  assert.equal(describeAdminError(e), 'Report not found (request abcdef12)');
  // { success: false, message } is the same to the reader.
  assert.equal(apiErrorDetails(axiosError(500, { success: false, message: 'Error fetching performance stats' })).message, 'Error fetching performance stats');
  // No id anywhere: just the sentence.
  assert.equal(describeAdminError(axiosError(409, { message: 'This report has no open appeal' })), 'This report has no open appeal');
});

test('a { code, message } body keeps its code (appeal reviewer conflict)', () => {
  const e = axiosError(403, { code: 'APPEAL_REVIEWER_CONFLICT', message: 'The moderator who took the original action cannot decide its appeal' });
  const d = apiErrorDetails(e);
  assert.equal(d.code, 'APPEAL_REVIEWER_CONFLICT');
  assert.equal(d.status, 403);
  assert.equal(describeAdminError(e), 'The moderator who took the original action cannot decide its appeal (APPEAL_REVIEWER_CONFLICT)');
});

test('the global limiter answers text/plain; a 429 is RATE_LIMITED with the Retry-After header', () => {
  const e = axiosError(429, 'Too many requests, please try again later.', { 'retry-after': '42' });
  const d = apiErrorDetails(e);
  assert.equal(d.code, 'RATE_LIMITED');
  assert.equal(d.retryAfterSec, 42);
  assert.equal(d.message, 'Too many requests, please try again later.');
  assert.equal(describeAdminError(e), 'Rate limited. Try again in 42 s.');
  assert.equal(isRateLimited(e), true);
  assert.equal(isRateLimited(axiosError(500, { message: 'x' })), false);
  // A Retry-After HTTP date works too.
  const now = Date.parse('2026-09-19T12:00:00Z');
  const dated = apiErrorDetails(axiosError(429, 'Too many requests', { 'retry-after': new Date(now + 90_000).toUTCString() }), 'x', now);
  assert.equal(dated.retryAfterSec, 90);
  // No header at all still reads as rate limited.
  assert.equal(describeAdminError(axiosError(429, 'Too many requests')), 'Rate limited. Try again in a moment.');
});

test('the per-user write limiter body carries retryAfterSec', () => {
  const e = axiosError(429, { code: 'RATE_LIMITED', message: 'Too many changes. Try again later.', retryAfterSec: 3570 }, { 'retry-after': '3570' });
  const d = apiErrorDetails(e);
  assert.equal(d.code, 'RATE_LIMITED');
  assert.equal(d.retryAfterSec, 3570);
  assert.equal(describeAdminError(e), 'Rate limited. Try again in 60 min.');
});

test('a 426 CLIENT_UPDATE_REQUIRED tells the operator to reload the console', () => {
  const e = axiosError(426, { success: false, code: 'CLIENT_UPDATE_REQUIRED', message: 'Update required', platform: 'web', minVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: null });
  assert.equal(apiErrorDetails(e).code, 'CLIENT_UPDATE_REQUIRED');
  assert.match(describeAdminError(e), /reload/i);
});

test('no response means offline and the fallback message', () => {
  const e = { isAxiosError: true, message: 'Network Error', config: {}, request: {} };
  const d = apiErrorDetails(e, 'Could not load reports');
  assert.equal(d.offline, true);
  assert.equal(d.status, null);
  assert.equal(d.message, 'Could not load reports');
  assert.match(describeAdminError(e, 'Could not load reports'), /Could not load reports\. Check the connection/);
  // A plain Error thrown locally is not "offline"; its own message stands.
  const local = apiErrorDetails(new Error('Choose a moderation action'));
  assert.equal(local.offline, false);
  assert.equal(local.message, 'Choose a moderation action');
  assert.equal(describeAdminError('Already a string'), 'Already a string');
  assert.equal(apiErrorDetails(null).status, null);
  assert.equal(apiErrorDetails(undefined, 'fallback').message, 'fallback');
});

test('validator errors[] and HTML bodies are handled', () => {
  assert.equal(apiErrorDetails(axiosError(400, { errors: [{ msg: 'Invalid value', path: 'decision' }] })).message, 'Invalid value');
  assert.equal(apiErrorDetails(axiosError(502, '<html><body>Bad gateway</body></html>'), 'The API did not answer').message, 'The API did not answer');
});

test('errMsg reads the envelope message instead of printing [object Object]', () => {
  const envelope = axiosError(500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.', requestId: 'r1' } });
  assert.equal(errMsg(envelope), 'Something went wrong on our side.');
  assert.doesNotMatch(errMsg(envelope), /object Object/);
  assert.equal(errMsg(axiosError(400, { error: 'Bad input' })), 'Bad input', 'a string error still passes through');
  assert.equal(errMsg(axiosError(404, { message: 'Report not found' })), 'Report not found');
  assert.equal(errMsg({}, 'fallback'), 'fallback');
});
