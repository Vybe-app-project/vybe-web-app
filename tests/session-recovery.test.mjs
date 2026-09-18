import assert from 'node:assert/strict';
import { register } from 'node:module';
import { beforeEach, test } from 'node:test';
import { AxiosError } from 'axios';

register('./ts-loader.mjs', import.meta.url);

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

globalThis.localStorage = storage();
globalThis.sessionStorage = storage();
globalThis.location = { pathname: '/', href: '/' };

const { api, adminApi, tokenStore } = await import('../src/lib/api.ts');
const { useAuth } = await import('../src/lib/auth.ts');
const { currentQueryClient } = await import('../src/lib/queryClient.ts');
const { readConsumerToken, readVerifiedConsumerToken } = await import('../src/lib/consumerSession.ts');
const user = { _id: 'user-a', username: 'athlete' };
const admin = { _id: 'admin-a', username: 'moderator' };
const result = (data, config) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
const failure = (config, status) => new AxiosError(
  'Request failed', status ? 'ERR_BAD_RESPONSE' : 'ERR_NETWORK', config, undefined,
  status ? { status, statusText: 'Error', data: {}, headers: {}, config } : undefined,
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  location.pathname = '/';
  location.href = '/';
  useAuth.setState({
    user: null, verifiedToken: null, loading: true, bootstrapError: null, sessionStale: false, sessionRejected: false,
    admin: null, adminLoading: true, adminBootstrapError: null,
  });

  api.defaults.adapter = async (config) => result({ user }, config);
  adminApi.defaults.adapter = async (config) => result({ success: true, data: { admin } }, config);
});

test('workout save cannot swap a verified credential for a different account token', async () => {
  tokenStore.set('verified-owner-session');
  await useAuth.getState().bootstrap();
  assert.equal(useAuth.getState().verifiedToken, 'verified-owner-session');
  let sent = false;
  api.defaults.adapter = async config => { sent = true; return result({}, config); };
  tokenStore.set('different-owner-session');
  await assert.rejects(api.post('/workouts/logs', {}, { workoutSessionToken: useAuth.getState().verifiedToken }), /account changed/);
  assert.equal(sent, false);
});

for (const status of [undefined, 408, 429, 500, 503]) {
  test(`a ${status ?? 'network'} failure retains the consumer session and supports retry`, async () => {
    tokenStore.set('consumer-session');
    api.defaults.adapter = async (config) => { throw failure(config, status); };
    await useAuth.getState().bootstrap();
    assert.equal(tokenStore.get(), 'consumer-session');
    assert.equal(useAuth.getState().user, null);
    assert.equal(useAuth.getState().loading, false);
    assert.match(useAuth.getState().bootstrapError, /try again/);
    assert.equal(location.href, '/');
    api.defaults.adapter = async (config) => result({ user }, config);
    await useAuth.getState().bootstrap();
    assert.deepEqual(useAuth.getState().user, user);
    assert.equal(useAuth.getState().bootstrapError, null);
  });
}

test('an authoritative 401 removes the consumer session', async () => {
  tokenStore.set('consumer-session');
  api.defaults.adapter = async (config) => { throw failure(config, 401); };
  await useAuth.getState().bootstrap();
  assert.equal(tokenStore.get(), null);
  assert.equal(useAuth.getState().loading, false);
  assert.equal(useAuth.getState().bootstrapError, null);
  assert.equal(location.href, '/', 'route guards, not the bootstrap interceptor, own navigation');
});

test('a forbidden request does not masquerade as an expired session', async () => {
  tokenStore.set('consumer-session');
  api.defaults.adapter = async (config) => { throw failure(config, 403); };
  await useAuth.getState().bootstrap();
  assert.equal(tokenStore.get(), 'consumer-session');
  assert.ok(useAuth.getState().bootstrapError);
});

test('malformed success does not authenticate or discard a session', async () => {
  tokenStore.set('consumer-session');
  api.defaults.adapter = async (config) => result({ message: 'maintenance' }, config);
  await useAuth.getState().bootstrap();
  assert.equal(useAuth.getState().user, null);
  assert.equal(tokenStore.get(), 'consumer-session');
  assert.ok(useAuth.getState().bootstrapError);
});

test('StrictMode/concurrent bootstrap calls share one request', async () => {
  tokenStore.set('consumer-session');
  let calls = 0;
  api.defaults.adapter = async (config) => { calls++; return result({ user }, config); };
  await Promise.all([useAuth.getState().bootstrap(), useAuth.getState().bootstrap()]);
  assert.equal(calls, 1);
});

test('an old response cannot overwrite a newly signed-in user', async () => {
  tokenStore.set('old-session');
  let finish;
  api.defaults.adapter = (config) => new Promise((resolve) => { finish = () => resolve(result({ user }, config)); });
  const pending = useAuth.getState().bootstrap();
  await new Promise((resolve) => setImmediate(resolve));
  tokenStore.set('new-session');
  const nextUser = { _id: 'user-b', username: 'runner' };
  api.defaults.adapter = async config => result({ user: nextUser }, config);
  await useAuth.getState().bootstrap();
  finish();
  await pending;
  assert.deepEqual(useAuth.getState().user, nextUser);
  assert.equal(tokenStore.get(), 'new-session');
});

test('an old 401 cannot revoke a newer sign-in', async () => {
  tokenStore.set('old-session');
  let finish;
  api.defaults.adapter = (config) => new Promise((_, reject) => { finish = () => reject(failure(config, 401)); });
  const pending = useAuth.getState().bootstrap();
  await new Promise((resolve) => setImmediate(resolve));
  tokenStore.set('new-session');
  const nextUser = { _id: 'user-b', username: 'runner' };
  api.defaults.adapter = async config => result({ user: nextUser }, config);
  await useAuth.getState().bootstrap();
  finish();
  await pending;
  assert.equal(tokenStore.get(), 'new-session');
  assert.deepEqual(useAuth.getState().user, nextUser);
  assert.equal(location.href, '/');
});

for (const success of [true, false]) {
  test(`removing a credential during startup cannot leave a spinner (${success ? 'success' : 'failure'})`, async () => {
    tokenStore.set('consumer-session');
    let finish;
    api.defaults.adapter = (config) => new Promise((resolve, reject) => {
      finish = () => success ? resolve(result({ user }, config)) : reject(failure(config, 503));
    });
    const pending = useAuth.getState().bootstrap();
    await new Promise((resolve) => setImmediate(resolve));
    tokenStore.clear();
    finish();
    await pending;
    assert.equal(useAuth.getState().user, null);
    assert.equal(useAuth.getState().loading, false);
    assert.equal(useAuth.getState().bootstrapError, null);
  });
}

test('admin retry retains a tab-scoped credential without entering the console', async () => {
  tokenStore.setAdmin('admin-session');
  adminApi.defaults.adapter = async (config) => { throw failure(config, 503); };
  await useAuth.getState().bootstrapAdmin();
  assert.equal(tokenStore.getAdmin(), 'admin-session');
  assert.equal(useAuth.getState().admin, null);
  assert.ok(useAuth.getState().adminBootstrapError);
  adminApi.defaults.adapter = async (config) => result({ success: true, data: { admin } }, config);
  await useAuth.getState().bootstrapAdmin();
  assert.deepEqual(useAuth.getState().admin, admin);
  assert.equal(useAuth.getState().adminBootstrapError, null);
});

test('an invalid admin session is removed, leaving consumer sign-in untouched', async () => {
  tokenStore.set('consumer-session');
  tokenStore.setAdmin('admin-session');
  adminApi.defaults.adapter = async (config) => { throw failure(config, 401); };
  await useAuth.getState().bootstrapAdmin();
  assert.equal(tokenStore.getAdmin(), null);
  assert.equal(tokenStore.get(), 'consumer-session');
  assert.equal(useAuth.getState().adminLoading, false);
  assert.equal(location.href, '/', 'admin bootstrap must not redirect public recovery/support pages');
});

test('an ordinary protected request still redirects when its current credential is rejected', async () => {
  tokenStore.set('consumer-session');
  api.defaults.adapter = async (config) => { throw failure(config, 401); };
  await assert.rejects(api.get('/posts/feed'));
  assert.equal(tokenStore.get(), null);
  assert.equal(location.href, '/login?expired=1');
});

test('an expired consumer credential does not interrupt a valid administrator bootstrap', async () => {
  tokenStore.set('expired-consumer-session');
  tokenStore.setAdmin('valid-admin-session');
  api.defaults.adapter = async (config) => { throw failure(config, 401); };
  await Promise.all([useAuth.getState().bootstrap(), useAuth.getState().bootstrapAdmin()]);
  assert.equal(tokenStore.get(), null);
  assert.equal(tokenStore.getAdmin(), 'valid-admin-session');
  assert.deepEqual(useAuth.getState().admin, admin);
  assert.equal(location.href, '/');
});

for (const remember of [true, false]) {
  test(`remember=${remember} keeps a token-bound minimal snapshot in the same lifetime, not draft authority`, async () => {
    let loginBody;
    api.defaults.adapter = async config => {
      loginBody = JSON.parse(config.data);
      return result({ token: 'mode-session', user: { ...user, email: 'private@example.invalid', avatar: '/api/media/content/avatar-a' } }, config);
    };
    await useAuth.getState().login('fixture@example.invalid', 'fixture-only', { remember });
    assert.equal(loginBody.remember, remember);
    const own = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    assert.equal(readConsumerToken(), 'mode-session');
    assert.equal(own.getItem('vybe.token'), 'mode-session');
    assert.equal(other.getItem('vybe.token'), null);
    assert.equal(other.getItem('vybe.user'), null);
    assert.equal(JSON.parse(own.getItem('vybe.user')).user.email, undefined);
    assert.doesNotMatch(own.getItem('vybe.user'), /mode-session/);
    api.defaults.adapter = async config => { throw failure(config, 503); };
    await useAuth.getState().bootstrap();
    assert.equal(useAuth.getState().user._id, user._id);
    assert.equal(useAuth.getState().sessionStale, true);
    assert.equal(useAuth.getState().verifiedToken, null);
    assert.equal(readVerifiedConsumerToken(), null);
    await assert.rejects(api.post('/workouts/logs', {}, { workoutSessionToken: 'mode-session' }), /account changed/);
    assert.equal(tokenStore.get(), 'mode-session');
    own.setItem('vybe.token', 'different-token');
    await useAuth.getState().bootstrap();
    assert.equal(useAuth.getState().user, null);
    assert.match(useAuth.getState().bootstrapError, /try again/);
  });
}

for (const message of ['This account is currently unavailable', 'Email verification is required', 'Permission denied', 'Gateway forbidden']) {
  test(`403 policy classification: ${message}`, async () => {
    tokenStore.set('consumer-session');
    api.defaults.adapter = async config => {
      const error = failure(config, 403);
      error.response.data = { message };
      throw error;
    };
    await useAuth.getState().bootstrap();
    const rejected = ['This account is currently unavailable', 'Email verification is required'].includes(message);
    assert.equal(tokenStore.get(), rejected ? null : 'consumer-session');
    assert.equal(useAuth.getState().sessionRejected, rejected);
    assert.equal(Boolean(useAuth.getState().bootstrapError), !rejected);
    assert.equal(location.href, '/', 'public pages must not be redirected by bootstrap');
  });
}

test('refresh updates signed-avatar snapshots but a late refresh cannot overwrite a replacement login', async () => {
  tokenStore.set('first-session');
  await useAuth.getState().bootstrap();
  const renewed = { ...user, avatar: '/api/media/content/avatar-renewed' };
  api.defaults.adapter = async config => result({ user: renewed }, config);
  await useAuth.getState().refreshUser({ force: true });
  assert.equal(useAuth.getState().user.avatar, renewed.avatar);
  assert.equal((await tokenStore.getUser()).avatar, renewed.avatar);
  let finish;
  api.defaults.adapter = config => new Promise(resolve => { finish = () => resolve(result({ user }, config)); });
  const pending = useAuth.getState().refreshUser({ force: true });
  await new Promise(resolve => setImmediate(resolve));
  const replacement = { _id: 'user-b', username: 'second' };
  await useAuth.getState().acceptSession(replacement, 'replacement-session', { remember: false });
  finish();
  await pending;
  assert.deepEqual(useAuth.getState().user, replacement);
  assert.equal((await tokenStore.getUser())._id, replacement._id);
  useAuth.getState().setUser(user);
  assert.deepEqual(useAuth.getState().user, replacement, 'old profile callbacks cannot replace the new owner');
  useAuth.getState().setUser(null);
  assert.deepEqual(useAuth.getState().user, replacement, 'an old callback cannot clear a newer signed-in owner');
});

test('a real credential change isolates query clients and late private responses/rollbacks', async () => {
  tokenStore.set('first-session');
  await useAuth.getState().bootstrap();
  const old = currentQueryClient();
  old.setQueryData(['messages'], { private: 'owner-a' });
  let finish;
  api.defaults.adapter = config => new Promise(resolve => { finish = () => resolve(result({ private: 'late-owner-a' }, config)); });
  const pending = api.get('/messages/me/all/recent/rooms');
  await new Promise(resolve => setImmediate(resolve));
  tokenStore.set('second-session', 'session');
  const next = currentQueryClient();
  assert.notEqual(next, old);
  assert.equal(useAuth.getState().user, null);
  assert.equal(next.getQueryData(['messages']), undefined);
  finish();
  await assert.rejects(pending, /account changed/);
  old.setQueryData(['messages'], { private: 'old mutation rollback' });
  assert.equal(next.getQueryData(['messages']), undefined);
});

test('older login responses cannot replace the latest attempt, including a reused token epoch', async () => {
  let first;
  api.defaults.adapter = config => new Promise(resolve => { first = () => resolve(result({ token: 'old-login', user }, config)); });
  const pending = useAuth.getState().login('a@example.invalid', 'fixture-only');
  await new Promise(resolve => setImmediate(resolve));
  const next = { _id: 'user-b', username: 'second' };
  api.defaults.adapter = async config => result({ token: 'latest-login', user: next }, config);
  await useAuth.getState().login('b@example.invalid', 'fixture-only', { remember: false });
  first();
  await assert.rejects(pending, /account changed/);
  assert.deepEqual(useAuth.getState().user, next);
  assert.equal(tokenStore.get(), 'latest-login');
});

test('device/all-device logout keep their explicit endpoints and remove both snapshot stores', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return {}; };
  try {
    for (const everywhere of [false, true]) {
      await useAuth.getState().acceptSession(user, 'fixture-session', { remember: !everywhere });
      if (everywhere) useAuth.getState().logoutEverywhere();
      else useAuth.getState().logout();
      assert.equal(tokenStore.get(), null);
      assert.equal(await tokenStore.getUser(), null);
      assert.equal(localStorage.getItem('vybe.user'), null);
      assert.equal(sessionStorage.getItem('vybe.user'), null);
    }
    assert.deepEqual(calls.map(call => call.url), ['/api/auth/logout', '/api/auth/logout-all']);
    assert.ok(calls.every(call => call.options.keepalive));
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid public login/reset proofs do not revoke an unrelated saved session', async () => {
  tokenStore.set('consumer-session');
  await useAuth.getState().bootstrap();
  api.defaults.adapter = async config => { throw failure(config, 401); };
  for (const endpoint of ['/auth/login', '/auth/reset-password', '/auth/verifyEmailOtp']) {
    await assert.rejects(api.post(endpoint, {}));
    assert.equal(tokenStore.get(), 'consumer-session');
    assert.equal(useAuth.getState().verifiedToken, 'consumer-session');
    assert.equal(location.href, '/');
  }
});

test('a refresh outage preserves an already-verified editor, never promoting a cold snapshot', async () => {
  tokenStore.set('consumer-session');
  await useAuth.getState().bootstrap();
  api.defaults.adapter = async config => { throw failure(config, 503); };
  await useAuth.getState().refreshUser({ force: true });
  assert.equal(useAuth.getState().verifiedToken, 'consumer-session');
  assert.deepEqual(useAuth.getState().user, user);
  useAuth.setState({ user: null, verifiedToken: null });
  await useAuth.getState().bootstrap();
  assert.equal(useAuth.getState().verifiedToken, null);
  assert.equal(useAuth.getState().sessionStale, true);
});

test('finishing an old bootstrap does not release the newer token’s in-flight dedup slot', async () => {
  const finishes = [];
  api.defaults.adapter = config => new Promise(resolve => {
    finishes.push(nextUser => resolve(result({ user: nextUser }, config)));
  });
  tokenStore.set('first-check');
  const first = useAuth.getState().bootstrap();
  await new Promise(resolve => setImmediate(resolve));
  tokenStore.set('second-check', 'session');
  const second = useAuth.getState().bootstrap();
  await new Promise(resolve => setImmediate(resolve));
  finishes[0](user);
  await first;
  const duplicate = useAuth.getState().bootstrap();
  assert.equal(finishes.length, 2);
  assert.equal(useAuth.getState().loading, true);
  const replacement = { _id: 'user-b', username: 'second' };
  finishes[1](replacement);
  await Promise.all([second, duplicate]);
  assert.deepEqual(useAuth.getState().user, replacement);
  assert.equal(useAuth.getState().verifiedToken, 'second-check');
  assert.equal(useAuth.getState().loading, false);
});
