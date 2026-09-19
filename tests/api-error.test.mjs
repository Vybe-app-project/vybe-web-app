import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * One reader for every API error shape (Wave C1 api-client-core). The API
 * answers the final envelope `{ error: { code, message, requestId } }` on
 * 404s, body-parser failures and every 5xx, and keeps its legacy bodies on
 * the routes; the parser must read all of them, never surface axios's own
 * text, and never throw.
 */
const {
  OFFLINE_COPY,
  SERVER_COPY,
  TIMEOUT_COPY,
  parseApiError,
  rateLimitedCopy,
} = await import('../src/lib/apiError.ts');

const http = (status, data, headers = {}, url = '/posts') => ({
  isAxiosError: true,
  code: status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
  message: `Request failed with status code ${status}`,
  config: { url },
  response: { status, data, headers },
});

test('the final envelope: code, message and requestId are read from body.error', () => {
  const notFound = parseApiError(http(404, { error: { code: 'NOT_FOUND', message: 'Route not found', requestId: 'nf-1' } }));
  assert.equal(notFound.kind, 'http');
  assert.equal(notFound.status, 404);
  assert.equal(notFound.code, 'NOT_FOUND');
  assert.equal(notFound.message, 'Route not found');
  assert.equal(notFound.requestId, 'nf-1');
  assert.equal(notFound.updateRequired, false);

  const server = parseApiError(http(500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.', requestId: 'r-2' } }));
  assert.equal(server.message, 'Something went wrong on our side.');
  assert.equal(server.code, 'INTERNAL_ERROR');
  assert.notEqual(server.message, 'Request failed with status code 500');
  // A 5xx that carried no copy at all gets the same sentence, never axios text.
  assert.equal(parseApiError(http(502, '<html>Bad gateway</html>')).message, SERVER_COPY);
  assert.equal(parseApiError(http(503, {})).message, SERVER_COPY);
});

test('legacy bodies: { message }, the dev-only { error:"<string>" }, validator arrays and per-field maps', () => {
  const unauthorized = parseApiError(http(401, { message: 'Not authorized, no token' }));
  assert.equal(unauthorized.message, 'Not authorized, no token');
  assert.equal(unauthorized.code, null);

  // message wins over the diagnostic string; the string alone is still shown.
  assert.equal(parseApiError(http(500, { success: false, message: 'Could not save', error: 'boom' })).message, 'Could not save');
  assert.equal(parseApiError(http(400, { success: false, error: 'boom' })).message, 'boom');

  const validator = parseApiError(http(400, { errors: [{ msg: 'Enter a valid email', path: 'email' }] }));
  assert.equal(validator.message, 'Enter a valid email');
  assert.equal(validator.field, 'email');

  const perField = parseApiError(http(409, { errors: { username: 'Taken', email: '' } }), 'Could not sign up');
  assert.deepEqual(perField.fieldErrors, { username: 'Taken' });
  assert.equal(perField.field, 'username');
  assert.equal(perField.message, 'Could not sign up', 'no top-level message: the fallback is used');

  const guardrail = parseApiError(http(400, { success: false, code: 'HEALTH_GOAL_GUARDRAIL', message: 'That target is too low.', field: 'targetWeightKg' }));
  assert.equal(guardrail.code, 'HEALTH_GOAL_GUARDRAIL');
  assert.equal(guardrail.field, 'targetWeightKg');
  assert.equal(guardrail.message, 'That target is too low.');
});

test('429: RATE_LIMITED is read or synthesised and the wait comes from the body, then Retry-After', () => {
  const writeLimit = parseApiError(http(429, { code: 'RATE_LIMITED', message: "You've hit the post limit for now. Try again in 3570 s.", retryAfterSec: 3570 }, { 'retry-after': '3570' }));
  assert.equal(writeLimit.code, 'RATE_LIMITED');
  assert.equal(writeLimit.retryAfterSec, 3570);
  assert.equal(writeLimit.message, 'You\u2019re doing that too often. Try again in about 60 minutes.', 'one sentence for every family label, and a wait a person can read');

  // The auth limiter sends { message } and only the header names the wait;
  // on the auth routes the person really was attempting something.
  const login = parseApiError(http(429, { message: 'Too many attempts, please try again later.' }, { 'retry-after': '900' }, '/auth/login'));
  assert.equal(login.code, 'RATE_LIMITED');
  assert.equal(login.retryAfterSec, 900);
  assert.equal(login.message, 'Too many attempts. Try again in about 15 minutes.');
  assert.equal(parseApiError(http(429, {}, { 'retry-after': '60' }, 'https://api.vybeapp.fit/api/admins/login')).message, 'Too many attempts. Try again in 60 seconds.');
  assert.equal(parseApiError(http(429, {}, { 'retry-after': '60' }, '/support/message')).message, 'You\u2019re doing that too often. Try again in 60 seconds.');
  assert.equal(parseApiError({ response: { status: 429, data: {}, headers: {} } }).message, 'You\u2019re doing that too often. Try again in a moment.', 'no config.url at all');

  // Data export spells it retryAfter.
  assert.equal(parseApiError(http(429, { message: 'Slow down', retryAfter: 45 })).retryAfterSec, 45);

  // The global per-IP limiter answers a text/html string.
  const global = parseApiError(http(429, 'Too many requests, please try again later.'));
  assert.equal(global.code, 'RATE_LIMITED');
  assert.equal(global.retryAfterSec, null);
  assert.equal(global.message, 'You\u2019re doing that too often. Try again in a moment.');

  for (const bad of ['0', 'abc', '-3', '', undefined]) {
    assert.equal(parseApiError(http(429, {}, { 'retry-after': bad })).retryAfterSec, null, `Retry-After ${JSON.stringify(bad)}`);
  }
  // AxiosHeaders exposes get(); a plain object is read case-insensitively.
  assert.equal(parseApiError(http(429, {}, { get: (name) => (name === 'retry-after' ? '12' : undefined) })).retryAfterSec, 12);
  assert.equal(parseApiError(http(429, {}, { 'Retry-After': '7' })).retryAfterSec, 7);
});

test('rateLimitedCopy names the wait when it knows it', () => {
  assert.equal(rateLimitedCopy(37), 'You\u2019re doing that too often. Try again in 37 seconds.');
  assert.equal(rateLimitedCopy(37, 'attempts'), 'Too many attempts. Try again in 37 seconds.');
  assert.equal(rateLimitedCopy(0.2), 'You\u2019re doing that too often. Try again in 1 second.');
  assert.equal(rateLimitedCopy(3600), 'You\u2019re doing that too often. Try again in about 60 minutes.');
  assert.equal(rateLimitedCopy(86400), 'You\u2019re doing that too often. Try again in about 24 hours.');
  for (const none of [null, undefined, 0, -1, NaN, Infinity]) {
    assert.equal(rateLimitedCopy(none), 'You\u2019re doing that too often. Try again in a moment.');
  }
});

test('426: only the CLIENT_UPDATE_REQUIRED code marks a build as below the floor', () => {
  const body = { success: false, code: 'CLIENT_UPDATE_REQUIRED', message: 'Why: sets now sync live.', platform: 'web', minVersion: '1.1.0', latestVersion: null, storeUrl: null };
  const gated = parseApiError(http(426, body));
  assert.equal(gated.updateRequired, true);
  assert.equal(gated.code, 'CLIENT_UPDATE_REQUIRED');
  assert.equal(gated.message, 'Why: sets now sync live.');
  assert.deepEqual(gated.body, body);
  assert.equal(parseApiError(http(426, { message: 'Upgrade' })).updateRequired, false);
});

test('transport failures get their own kind and copy, never axios text', () => {
  const offline = parseApiError({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
  assert.equal(offline.kind, 'network');
  assert.equal(offline.message, OFFLINE_COPY);
  assert.equal(offline.status, null);

  const timeout = parseApiError({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' });
  assert.equal(timeout.kind, 'timeout');
  assert.equal(timeout.message, TIMEOUT_COPY);

  const cancelled = parseApiError({ isAxiosError: true, code: 'ERR_CANCELED', message: 'canceled' }, 'fb');
  assert.equal(cancelled.kind, 'cancelled');
  assert.equal(cancelled.message, 'fb');

  // An axios error that somehow has no code and no response is still not copy.
  assert.equal(parseApiError({ isAxiosError: true, message: 'Request failed with status code 500' }, 'fb').message, 'fb');
});

test('the request id falls back to the X-Request-Id header', () => {
  assert.equal(parseApiError(http(500, { error: { code: 'INTERNAL_ERROR', message: 'x' } }, { 'x-request-id': 'hdr-9' })).requestId, 'hdr-9');
  assert.equal(parseApiError(http(400, { message: 'x', requestId: 'top-1' })).requestId, 'top-1');
  assert.equal(parseApiError(http(400, { message: 'x' })).requestId, null);
});

test('junk input never throws; an error the app threw itself keeps its own copy', () => {
  for (const junk of [undefined, null, 'x', 42, [], {}, { response: null }, { response: { status: 'nope' } }, { response: { data: null } }]) {
    const parsed = parseApiError(junk, 'fb');
    assert.equal(parsed.message, 'fb', `input ${JSON.stringify(junk)}`);
    assert.equal(parsed.status, null);
  }
  // Pages throw Error('Give the meal a name') into toast.error: that is copy for a person.
  assert.equal(parseApiError(new Error('Give the meal a name'), 'fb').message, 'Give the meal a name');
  assert.equal(parseApiError(new Error(''), 'fb').message, 'fb');
  assert.equal(parseApiError(new Error('   '), 'fb').message, 'fb');
  // A circular body cannot break it either.
  const loop = { message: 'Loop' };
  loop.self = loop;
  assert.equal(parseApiError(http(400, loop)).message, 'Loop');
});

test('errMsg stays compatible: it is parseApiError().message', async () => {
  const { errMsg } = await import('../src/lib/api.ts');
  assert.equal(errMsg({ response: { data: { message: 'x' } } }), 'x');
  assert.equal(errMsg(undefined, 'fb'), 'fb');
  assert.equal(errMsg(http(500, {})), SERVER_COPY);
  assert.equal(errMsg(http(429, {}, { 'retry-after': '3' })), 'You\u2019re doing that too often. Try again in 3 seconds.');
  assert.equal(errMsg(http(429, {}, { 'retry-after': '3' }, '/auth/register')), 'Too many attempts. Try again in 3 seconds.');
  assert.equal(errMsg({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' }), OFFLINE_COPY);
});
