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
    user: null, loading: true, bootstrapError: null,
    admin: null, adminLoading: true, adminBootstrapError: null,
  });
  api.defaults.adapter = async (config) => result({ user }, config);
  adminApi.defaults.adapter = async (config) => result({ success: true, data: { admin } }, config);
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
  useAuth.getState().setUser(nextUser);
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
  useAuth.getState().setUser(nextUser);
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
  assert.equal(location.href, '/login');
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
