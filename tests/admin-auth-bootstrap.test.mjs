import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * bootstrapAdmin runs on every console load with a stored admin token. It
 * must only forget that token when the API says the session is bad (401 or
 * 403); a 429 from the rate limiter or a network failure used to clear it
 * too, so RequireAdmin bounced a signed-in operator to /admin/login. This
 * exercises the runtime branch with a stubbed adminApi.get, instead of
 * pinning the source text.
 */
const memoryStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
};
globalThis.localStorage ??= memoryStorage();
globalThis.sessionStorage ??= memoryStorage();
// api.ts reads `location` only inside its 401 handler; the stub below never
// runs the interceptors, so a bare shim is enough.
globalThis.location ??= { pathname: '/admin', search: '', href: '' };

const { adminApi, tokenStore } = await import('../src/lib/api.ts');
const { useAuth } = await import('../src/lib/auth.ts');

const TOKEN = 'admin-token-under-test';
const axiosError = (status) => ({
  isAxiosError: true,
  message: status ? `Request failed with status code ${status}` : 'Network Error',
  response: status ? { status, data: { message: 'x' }, headers: {} } : undefined,
  config: {},
});

/** Run bootstrapAdmin with adminApi.get answering as given; returns the store state. */
async function bootstrapWith(answer, { admin = null } = {}) {
  tokenStore.setAdmin(TOKEN);
  useAuth.setState({ admin, adminLoading: true });
  const original = adminApi.get;
  adminApi.get = async () => {
    if (answer instanceof Error || answer?.isAxiosError) throw answer;
    return { data: answer };
  };
  try {
    await useAuth.getState().bootstrapAdmin();
  } finally {
    adminApi.get = original;
  }
  return useAuth.getState();
}

test('a 429 keeps the admin token and leaves the console mounted with an empty identity', async () => {
  const state = await bootstrapWith(axiosError(429));
  assert.equal(tokenStore.getAdmin(), TOKEN, 'the token must survive a rate limit');
  assert.ok(state.admin, 'admin is truthy so RequireAdmin does not redirect');
  assert.equal(state.adminLoading, false);
});

test('a network failure keeps the token too, and keeps the identity already loaded', async () => {
  const known = { _id: 'a1', role: 'SUPER_ADMIN' };
  const state = await bootstrapWith(axiosError(null), { admin: known });
  assert.equal(tokenStore.getAdmin(), TOKEN);
  assert.deepEqual(state.admin, known, 'the loaded identity is not replaced by {}');
  assert.equal(state.adminLoading, false);
  // Without a loaded identity an empty object stands in.
  const fresh = await bootstrapWith(axiosError(null));
  assert.deepEqual(fresh.admin, {});
});

test('a 500 is not a session verdict either', async () => {
  const state = await bootstrapWith(axiosError(500));
  assert.equal(tokenStore.getAdmin(), TOKEN);
  assert.ok(state.admin);
});

for (const status of [401, 403]) {
  test(`a ${status} clears the admin token and the identity`, async () => {
    const state = await bootstrapWith(axiosError(status), { admin: { _id: 'a1', role: 'ADMIN' } });
    assert.equal(tokenStore.getAdmin(), null, 'the session is bad; forget it');
    assert.equal(state.admin, null);
    assert.equal(state.adminLoading, false);
  });
}

test('a successful /admins/me unwraps every envelope the API has used', async () => {
  const me = { _id: 'a1', role: 'SUPER_ADMIN', email: 'root@example.com' };
  assert.deepEqual((await bootstrapWith({ success: true, data: { admin: me } })).admin, me, '{ data: { admin } }');
  assert.deepEqual((await bootstrapWith({ admin: me })).admin, me, '{ admin }');
  assert.deepEqual((await bootstrapWith(me)).admin, me, 'bare');
  assert.equal(tokenStore.getAdmin(), TOKEN);
});

test('without a stored token nothing is fetched and the identity is null', async () => {
  tokenStore.clearAdmin();
  useAuth.setState({ admin: { _id: 'stale' }, adminLoading: true });
  let called = false;
  const original = adminApi.get;
  adminApi.get = async () => { called = true; return { data: {} }; };
  try {
    await useAuth.getState().bootstrapAdmin();
  } finally {
    adminApi.get = original;
  }
  assert.equal(called, false);
  assert.equal(useAuth.getState().admin, null);
  assert.equal(useAuth.getState().adminLoading, false);
});
