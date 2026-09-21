/**
 * "Continue with Google" and "Continue with Apple" on the web, without a
 * third-party script.
 *
 * The deployed CSP is `script-src 'self'` with no `frame-src` of its own
 * (so `default-src 'self'` applies) and `connect-src` limited to the API
 * hosts. Google Identity Services (`https://accounts.google.com/gsi/client`)
 * and Sign in with Apple JS (`https://appleid.cdn-apple.com/…`) are both
 * blocked by that policy, and so is the GIS iframe. Rather than ask for four
 * new CSP hosts to render two buttons, this is the **redirect flow**: a
 * top-level navigation to the provider's authorize endpoint, which no CSP
 * directive governs, and the identity token comes back in the URL fragment
 * of our own `/login`.
 *
 * The API takes the token on the routes it already has
 * (`controllers/authController.js`):
 *
 *   Google  POST /api/auth/google/mobile  { idToken }
 *   Apple   POST /api/auth/apple/mobile   { identityToken }
 *
 * Both answer `200 { token, user }` — byte-identical to `POST /auth/login` —
 * so the session is stored exactly the way the email path stores it. There is
 * no web-specific route and no `platform` field on either: `/auth/oauthSign`
 * is the only route that reads `platform` (`'ios' | 'android' | 'web'`), and
 * it answers `201 { token, user, alreadyExists? }`. The two `/mobile` routes
 * are the narrower, better-behaved pair, so they are what the web posts to.
 *
 * Both buttons stay hidden until `capabilities.googleOAuth` / `appleOAuth`
 * say the server has credentials AND this build has the matching client id.
 *
 * Import-free on purpose: tests/auth-oauth-dob.test.mjs transpiles this file
 * and imports the result directly. Nothing here touches `import.meta.env`;
 * the client ids are passed in by the caller.
 */

export type OAuthProvider = 'google' | 'apple';

/** Where the provider sends the browser back. One registered URI per provider. */
export const OAUTH_REDIRECT_PATH = '/login';

/** The pending flow, kept in sessionStorage across the round trip. */
export const OAUTH_STATE_KEY = 'vybe.oauth';

/** A flow older than this is stale: the fragment is ignored and the entry dropped. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const APPLE_AUTH_ENDPOINT = 'https://appleid.apple.com/auth/authorize';

export const OAUTH_LABELS: Readonly<Record<OAuthProvider, string>> = Object.freeze({
  google: 'Continue with Google',
  apple: 'Continue with Apple',
});

/** The build-time ids the owner configures; read by the page, never by this module. */
export const OAUTH_ENV_KEYS: Readonly<Record<OAuthProvider, string>> = Object.freeze({
  google: 'VITE_GOOGLE_CLIENT_ID',
  apple: 'VITE_APPLE_SERVICES_ID',
});

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type OAuthPending = {
  provider: OAuthProvider;
  state: string;
  nonce: string;
  /** Where to land once the session exists; already validated by postLoginTarget. */
  returnTo: string;
  startedAt: number;
};

/** A placeholder id from a half-filled .env is no id at all (the API applies the same rule). */
const PLACEHOLDER = /^(?:placeholder|replace.*|change.*|your.*|insert.*|set.*|todo|tbd|unset|null|undefined|none)$/i;

export function usableClientId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER.test(trimmed) || /^<.*>$/.test(trimmed)) return null;
  return trimmed;
}

/** 32 hex characters from the platform CSPRNG; falls back only where crypto is absent. */
export function randomToken(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
}

/**
 * The authorize URL.
 *
 * Google: OpenID Connect implicit, `response_type=id_token`, so the token
 * arrives in the fragment and no code exchange (and no server route) is
 * needed. `prompt=select_account` because a shared computer must be able to
 * pick a different account.
 *
 * Apple: `response_type=code id_token`. Apple requires `response_mode=form_post`
 * whenever a scope is requested, and the API refuses a first Apple sign-in
 * without a verified email — which needs the `email` scope. So the Apple
 * button needs a server-side return route to receive that POST; until the
 * owner ships one, `capabilities.appleOAuth` stays false and the button is
 * never drawn. The URL is built here so the flow is one line away.
 */
export function authorizeUrl(input: {
  provider: OAuthProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const { provider, clientId, redirectUri, state, nonce } = input;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    nonce,
  });
  if (provider === 'google') {
    params.set('response_type', 'id_token');
    params.set('scope', 'openid email profile');
    params.set('prompt', 'select_account');
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }
  params.set('response_type', 'code id_token');
  params.set('scope', 'name email');
  params.set('response_mode', 'form_post');
  return `${APPLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** The absolute redirect URI the owner registers with the provider. */
export const redirectUriFor = (origin: string): string => `${origin.replace(/\/+$/, '')}${OAUTH_REDIRECT_PATH}`;

/**
 * Everything the caller needs to start a flow: the URL to navigate to and
 * the entry to remember first. Returns null when this build has no client id
 * for the provider, so a button is never wired to a broken URL.
 */
export function startOAuth(input: {
  provider: OAuthProvider;
  clientId: unknown;
  origin: string;
  returnTo: string;
  now?: number;
}): { url: string; pending: OAuthPending } | null {
  const clientId = usableClientId(input.clientId);
  if (!clientId) return null;
  const pending: OAuthPending = {
    provider: input.provider,
    state: randomToken(),
    nonce: randomToken(),
    returnTo: input.returnTo || '/',
    startedAt: input.now ?? Date.now(),
  };
  return {
    url: authorizeUrl({
      provider: input.provider,
      clientId,
      redirectUri: redirectUriFor(input.origin),
      state: pending.state,
      nonce: pending.nonce,
    }),
    pending,
  };
}

export function rememberOAuth(storage: StorageLike | null | undefined, pending: OAuthPending): void {
  try {
    storage?.setItem(OAUTH_STATE_KEY, JSON.stringify(pending));
  } catch {
    // Without storage the state cannot be checked on return, so the flow
    // simply will not complete; nothing is signed in on a guess.
  }
}

/**
 * Whether the buttons were there last time.
 *
 * The capability query cannot answer on the first frame, so a build that
 * carries client ids has to decide whether to hold their space while it
 * waits. Holding it is right when they will appear and wrong when they will
 * not, and only the last answer knows which. One boolean, on a signed-out
 * page: never data, only geometry.
 */
export const OAUTH_SEEN_KEY = 'vybe.oauthSeen';

export function rememberProviderAnswer(storage: StorageLike | null | undefined, any: boolean): void {
  try {
    storage?.setItem(OAUTH_SEEN_KEY, any ? '1' : '0');
  } catch {
    // Without storage the first paint simply reserves; see below.
  }
}

/** true / false as last seen, null when this browser has never asked. */
export function lastProviderAnswer(storage: StorageLike | null | undefined): boolean | null {
  try {
    const raw = storage?.getItem(OAUTH_SEEN_KEY);
    return raw === '1' ? true : raw === '0' ? false : null;
  } catch {
    return null;
  }
}

export function forgetOAuth(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(OAUTH_STATE_KEY);
  } catch {
    // Nothing to clear.
  }
}

function readPending(storage: StorageLike | null | undefined): OAuthPending | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(OAUTH_STATE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthPending>;
    if (parsed?.provider !== 'google' && parsed?.provider !== 'apple') return null;
    if (typeof parsed.state !== 'string' || !parsed.state) return null;
    return {
      provider: parsed.provider,
      state: parsed.state,
      nonce: typeof parsed.nonce === 'string' ? parsed.nonce : '',
      returnTo: typeof parsed.returnTo === 'string' && parsed.returnTo ? parsed.returnTo : '/',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
  } catch {
    return null;
  }
}

export type OAuthReturn =
  | { kind: 'token'; provider: OAuthProvider; idToken: string; returnTo: string }
  | { kind: 'error'; provider: OAuthProvider | null; message: string };

/** The provider's own `error` codes, in words a person can act on. */
export function providerErrorCopy(code: string): string {
  if (code === 'access_denied' || code === 'user_cancelled_authorize') return 'Sign-in was cancelled. Nothing changed.';
  if (code === 'invalid_client' || code === 'unauthorized_client') return 'This site is not set up with that provider yet. Sign in with your email instead.';
  if (code === 'redirect_uri_mismatch') return 'That provider is not configured for this address. Sign in with your email instead.';
  return 'Sign-in with that provider did not finish. Try again, or use your email.';
}

/**
 * Read the provider's answer out of the URL and retire the pending entry.
 *
 * The `state` must match the one this tab stored, and the flow must be
 * younger than ten minutes; a fragment that fails either check is ignored
 * outright rather than posted to the API. Null means "this is an ordinary
 * visit to /login", which is the common case.
 */
export function readOAuthReturn(
  hash: string | null | undefined,
  storage: StorageLike | null | undefined,
  now: number = Date.now(),
): OAuthReturn | null {
  const raw = (hash ?? '').replace(/^[#?]/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const idToken = params.get('id_token');
  const error = params.get('error');
  const state = params.get('state');
  if (!idToken && !error) return null;

  const pending = readPending(storage);
  forgetOAuth(storage);
  if (!pending) return { kind: 'error', provider: null, message: 'That sign-in could not be verified. Start again from this page.' };
  if (!state || state !== pending.state) {
    return { kind: 'error', provider: pending.provider, message: 'That sign-in could not be verified. Start again from this page.' };
  }
  if (pending.startedAt && now - pending.startedAt > OAUTH_STATE_TTL_MS) {
    return { kind: 'error', provider: pending.provider, message: 'That sign-in took too long. Try again.' };
  }
  if (error) return { kind: 'error', provider: pending.provider, message: providerErrorCopy(error) };
  return { kind: 'token', provider: pending.provider, idToken: idToken as string, returnTo: pending.returnTo };
}

/**
 * The route and body for a provider token. Google's key is `idToken`,
 * Apple's is `identityToken` — the names the validators bind
 * (`routes/auth.js` boundedIdentityToken).
 */
export function oauthSignInRequest(provider: OAuthProvider, idToken: string, locale?: string | null): { path: string; body: Record<string, string> } {
  const body: Record<string, string> = provider === 'google' ? { idToken } : { identityToken: idToken };
  if (locale) body.locale = locale;
  return { path: provider === 'google' ? '/auth/google/mobile' : '/auth/apple/mobile', body };
}

/** The API's own refusals, in the words the sign-in form should print. */
export function oauthApiErrorCopy(error: unknown, provider: OAuthProvider): string {
  const response = (error as { response?: { status?: number; data?: unknown } } | undefined)?.response;
  const status = response?.status;
  const name = provider === 'google' ? 'Google' : 'Apple';
  const data = response?.data && typeof response.data === 'object' ? (response.data as { message?: unknown }) : {};
  const message = typeof data.message === 'string' && data.message ? data.message : null;
  if (status === 503) return `${name} sign-in is not switched on for this server. Sign in with your email instead.`;
  if (status === 401) return `${name} could not verify that sign-in. Try again, or use your email.`;
  if (status === 429) return 'Too many sign-in attempts. Try again in a few minutes.';
  if (status === 403) return message ?? 'This account is currently unavailable.';
  return message ?? `Could not finish signing in with ${name}.`;
}
