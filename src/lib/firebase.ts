import { api } from './api';

/**
 * Web push for the browser client (package P5).
 *
 * The API has sent push through FCM HTTP v1 all along
 * (vybe-backend/utils/notifications.js; `GET /api/capabilities` reports
 * `push: true`), but the web never registered a browser token, so the 18
 * switches on Settings gated nothing here. This module is the missing half:
 * the browser's support state, the FCM registration token, and the two calls
 * that put it on the account.
 *
 * Three things shape the code:
 *
 * - **The SDK is loaded lazily.** `firebase/app` and `firebase/messaging` are
 *   the only two entry points this app uses, and both are reached through
 *   `import()` inside `loadMessaging()`. That keeps ~180 KB of SDK out of the
 *   main chunk for the majority of visits that never turn push on, and it
 *   keeps every pure function below importable by `node --test` without a DOM.
 * - **iOS is a state, not a failure.** Safari only exposes `Notification` and
 *   `PushManager` to a PWA that was added to the Home Screen (16.4+). An
 *   iPhone in a Safari tab therefore fails the capability probe, which would
 *   read as "your browser cannot do this" when the truth is "one more step".
 *   `resolvePushSupport` answers `needs-install` for that case.
 * - **Tokens rotate.** FCM re-issues a registration token whenever the browser
 *   decides to, and the API keeps at most five per account and drops the
 *   oldest (`utils/pushTokens.js`), so a token that was registered once can be
 *   pruned. `refreshPushToken()` re-reads the token on every app start and
 *   re-registers it when it changed or when the last sync is a day old.
 */

/**
 * The public Firebase web app config for vybeapp.fit (project vybe-6ac92).
 *
 * None of this is a secret: the same six values ship in every Firebase web
 * app's bundle and are readable by anyone who loads the page. The service
 * account that signs FCM sends lives only on the server, and the VAPID
 * *private* key only inside Firebase. Analytics is deliberately not wired up
 * (`measurementId` is omitted) — this app uses Firebase for messaging only.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDcrk_Q8hjzUuM9PzBHLH4FC8bezZQCA-Q',
  authDomain: 'vybe-6ac92.firebaseapp.com',
  projectId: 'vybe-6ac92',
  storageBucket: 'vybe-6ac92.firebasestorage.app',
  messagingSenderId: '127745278900',
  appId: '1:127745278900:web:622fa8921b4e876836e8e1',
} as const;

/** The Web Push VAPID public key (application server key) for the same project. */
export const VAPID_PUBLIC_KEY = 'BMlsCyWDC1j52rGDRAxT48F8qtfgrJguwFhK-mxZh8iqXed1S9S5SQaB8L-AhucoP3Cf58viagncGLBo4cDMc2Y';

/** Where the registered token and its last sync are remembered, per browser profile. */
export const PUSH_TOKEN_STORAGE_KEY = 'vybe.push.token';

/** Re-register a token this old even when it has not changed, in case the API pruned it. */
export const PUSH_TOKEN_RESYNC_MS = 24 * 60 * 60 * 1000;

/** Where a click with no better target lands. */
export const PUSH_FALLBACK_LINK = '/notifications';

/* ------------------------------------------------------------------ support state */

export type PushSupport = 'granted' | 'default' | 'denied' | 'unsupported' | 'needs-install';

/** Everything `resolvePushSupport` reads, so the resolution itself is pure and testable. */
export type PushEnvironment = {
  userAgent: string;
  maxTouchPoints: number;
  /** `navigator.standalone`: Safari's "launched from the Home Screen" flag, iOS only. */
  standalone: boolean | undefined;
  /** `(display-mode: standalone)`: every other engine's version of the same question. */
  displayModeStandalone: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  permission: NotificationPermission | undefined;
};

const IOS_UA = /iPad|iPhone|iPod/;

/** iPadOS 13+ claims to be a Mac; the touch points are what give it away. */
export function isIosLike(env: Pick<PushEnvironment, 'userAgent' | 'maxTouchPoints'>): boolean {
  if (IOS_UA.test(env.userAgent)) return true;
  return /Macintosh/.test(env.userAgent) && (env.maxTouchPoints ?? 0) > 1;
}

export function isInstalledPwa(env: Pick<PushEnvironment, 'standalone' | 'displayModeStandalone'>): boolean {
  return env.standalone === true || env.displayModeStandalone === true;
}

/**
 * The five states the UI renders, in the order they have to be checked: the
 * iOS install step first (an iPhone in a tab fails the capability probe for a
 * reason the member can fix), then the capability probe, then the permission.
 */
export function resolvePushSupport(env: PushEnvironment | null): PushSupport {
  if (!env) return 'unsupported';
  if (isIosLike(env) && !isInstalledPwa(env)) return 'needs-install';
  if (!env.serviceWorker || !env.pushManager || !env.notification) return 'unsupported';
  if (env.permission === 'granted') return 'granted';
  if (env.permission === 'denied') return 'denied';
  return 'default';
}

/** The live browser's environment, or null when there is no browser (SSR, node:test). */
export function readPushEnvironment(): PushEnvironment | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  const nav = navigator as Navigator & { standalone?: boolean };
  const hasNotification = typeof window.Notification !== 'undefined';
  let displayModeStandalone = false;
  try {
    displayModeStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    displayModeStandalone = false;
  }
  return {
    userAgent: nav.userAgent || '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone,
    displayModeStandalone,
    serviceWorker: 'serviceWorker' in nav,
    pushManager: 'PushManager' in window,
    notification: hasNotification,
    permission: hasNotification ? window.Notification.permission : undefined,
  };
}

export function pushSupport(): PushSupport {
  return resolvePushSupport(readPushEnvironment());
}

/* ------------------------------------------------------------------ token bookkeeping */

export type PushTokenRecord = { token: string; syncedAt: number };

/** Read the stored record. A bare token string from an older build still counts. */
export function parsePushTokenRecord(raw: string | null | undefined): PushTokenRecord | null {
  if (!raw) return null;
  if (!raw.startsWith('{')) return { token: raw, syncedAt: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<PushTokenRecord> | null;
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token) return null;
    const syncedAt = typeof parsed.syncedAt === 'number' && Number.isFinite(parsed.syncedAt) ? parsed.syncedAt : 0;
    return { token: parsed.token, syncedAt };
  } catch {
    return null;
  }
}

export function serializePushTokenRecord(record: PushTokenRecord): string {
  return JSON.stringify({ token: record.token, syncedAt: record.syncedAt } satisfies PushTokenRecord);
}

/**
 * Whether `PUT /users/push-token` has to run: a token we have never sent, a
 * token that rotated, or a registration old enough that the API may have
 * dropped it to stay under its five-per-account cap.
 */
export function shouldSyncPushToken(
  record: PushTokenRecord | null,
  token: string,
  now: number,
  ttlMs: number = PUSH_TOKEN_RESYNC_MS,
): boolean {
  if (!token) return false;
  if (!record || record.token !== token) return true;
  return now - record.syncedAt >= ttlMs;
}

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const pushTokenStore = {
  read: (): PushTokenRecord | null => parsePushTokenRecord(readStorage(PUSH_TOKEN_STORAGE_KEY)),
  write: (token: string, now: number = Date.now()): void => {
    try {
      localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, serializePushTokenRecord({ token, syncedAt: now }));
    } catch {
      // A private window with storage denied still gets push for this session.
    }
  },
  clear: (): void => {
    try {
      localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    } catch {
      // Nothing to do; the token is already unusable to us.
    }
  },
};

/* ------------------------------------------------------------------ links */

/**
 * Where a push should land. The API's data allowlist
 * (utils/notifications.js PUSH_DATA_FIELDS) carries no link today, so this
 * reads one if a future send adds it and otherwise opens the inbox, whose
 * rows already deep-link correctly. Only same-origin paths are honoured: a
 * notification must never be able to navigate the app somewhere else.
 */
export function pushLinkOf(data: Record<string, unknown> | null | undefined): string {
  const raw = data && typeof data === 'object' ? (data as { link?: unknown; url?: unknown }) : {};
  const candidate = typeof raw.link === 'string' && raw.link ? raw.link : typeof raw.url === 'string' ? raw.url : '';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return PUSH_FALLBACK_LINK;
  return candidate;
}

/* ------------------------------------------------------------------ the SDK, lazily */

type MessagingSdk = typeof import('firebase/messaging');
type LoadedMessaging = { sdk: MessagingSdk; messaging: Awaited<ReturnType<MessagingSdk['getMessaging']>> };

let messagingPromise: Promise<LoadedMessaging | null> | null = null;

async function loadMessaging(): Promise<LoadedMessaging | null> {
  const [app, sdk] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!(await sdk.isSupported())) return null;
  const instance = app.getApps().length ? app.getApp() : app.initializeApp(FIREBASE_CONFIG);
  return { sdk, messaging: sdk.getMessaging(instance) };
}

/**
 * The `Messaging` instance, or null on a browser the SDK does not support.
 * Resolved once and reused; a failure (a blocked gstatic fetch, a browser
 * that throws inside `isSupported`) resolves to null rather than rejecting,
 * because every caller treats "no messaging" the same way.
 */
export async function getMessagingSafe(): Promise<LoadedMessaging | null> {
  if (!messagingPromise) {
    messagingPromise = loadMessaging().catch((error) => {
      console.warn('Firebase messaging unavailable', error);
      return null;
    });
  }
  return messagingPromise;
}

/* ------------------------------------------------------------------ the registration */

let swRegistration: ServiceWorkerRegistration | null = null;

/** Handed the registration by `useRegisterSW`'s `onRegisteredSW` in App.tsx. */
export function setPushRegistration(registration: ServiceWorkerRegistration | undefined | null): void {
  if (registration) swRegistration = registration;
}

async function resolveRegistration(explicit?: ServiceWorkerRegistration | null): Promise<ServiceWorkerRegistration | null> {
  if (explicit) return explicit;
  if (swRegistration) return swRegistration;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    swRegistration = (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    swRegistration = null;
  }
  return swRegistration;
}

/* ------------------------------------------------------------------ enable / disable */

export type EnablePushResult = { state: PushSupport; token: string | null };

/**
 * Ask for permission, mint a registration token against the app's own
 * service worker, and put it on the account. The result carries the state the
 * card should render next; only a genuinely unexpected failure (the API
 * refusing the token) throws, so the caller can toast it.
 */
export async function enablePush(registration?: ServiceWorkerRegistration | null): Promise<EnablePushResult> {
  const before = pushSupport();
  if (before !== 'default' && before !== 'granted') return { state: before, token: null };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { state: permission === 'denied' ? 'denied' : 'default', token: null };

  const loaded = await getMessagingSafe();
  const serviceWorkerRegistration = await resolveRegistration(registration);
  if (!loaded || !serviceWorkerRegistration) return { state: 'unsupported', token: null };

  const token = await loaded.sdk.getToken(loaded.messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration });
  if (!token) return { state: 'granted', token: null };

  await api.put('/users/push-token', { token });
  pushTokenStore.write(token);
  return { state: 'granted', token };
}

/**
 * Take this device off the account. Best-effort on purpose: the switch has to
 * settle whatever the network does, and a token the API still holds is
 * harmless once `deleteToken` has invalidated it with FCM.
 */
export async function disablePush(): Promise<void> {
  const record = pushTokenStore.read();
  pushTokenStore.clear();
  if (record) {
    try {
      await api.delete('/users/push-token', { data: { token: record.token } });
    } catch {
      // The token is forgotten locally either way.
    }
  }
  const loaded = await getMessagingSafe();
  if (!loaded) return;
  try {
    await loaded.sdk.deleteToken(loaded.messaging);
  } catch {
    // Nothing left to do; FCM will stop delivering once the token expires.
  }
}

/**
 * Sign-out's version of the above. `logout()` navigates to /login on the next
 * line, which aborts any in-flight XHR, so the delete goes out as a keepalive
 * fetch carrying the bearer explicitly — the same reasoning as
 * `revokeSession()` in lib/api.ts. Synchronous and fire-and-forget: signing
 * out must never wait on the network.
 */
export function forgetPushTokenOnSignOut(bearer: string | null, baseUrl: string): void {
  const record = pushTokenStore.read();
  pushTokenStore.clear();
  void getMessagingSafe()
    .then((loaded) => loaded?.sdk.deleteToken(loaded.messaging))
    .catch(() => undefined);
  if (!record || !bearer) return;
  try {
    void fetch(`${baseUrl.replace(/\/$/, '')}/users/push-token`, {
      method: 'DELETE',
      keepalive: true,
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: record.token }),
    }).catch(() => undefined);
  } catch {
    // fetch can throw synchronously in exotic embeds; still sign out.
  }
}

/**
 * App start, permission already granted, a token already registered from this
 * browser: read the current token and re-register it if it rotated or the
 * last sync has aged out. A rotated token's predecessor is removed so the
 * account's five slots are not spent on this one device.
 */
export async function refreshPushToken(registration?: ServiceWorkerRegistration | null): Promise<string | null> {
  if (pushSupport() !== 'granted') return null;
  const record = pushTokenStore.read();
  if (!record) return null;

  const loaded = await getMessagingSafe();
  const serviceWorkerRegistration = await resolveRegistration(registration);
  if (!loaded || !serviceWorkerRegistration) return null;

  const token = await loaded.sdk.getToken(loaded.messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration });
  if (!token) return null;
  if (!shouldSyncPushToken(record, token, Date.now())) return token;

  await api.put('/users/push-token', { token });
  pushTokenStore.write(token);
  if (record.token !== token) {
    try {
      await api.delete('/users/push-token', { data: { token: record.token } });
    } catch {
      // The API drops the oldest of five on its own.
    }
  }
  return token;
}

/* ------------------------------------------------------------------ foreground */

export type ForegroundPush = { title: string; body: string; link: string; data: Record<string, string> };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The shape the toast needs, from whatever the SDK handed us. */
export function foregroundPushOf(payload: unknown): ForegroundPush {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const notification = record.notification && typeof record.notification === 'object' ? (record.notification as Record<string, unknown>) : {};
  const data = record.data && typeof record.data === 'object' ? (record.data as Record<string, string>) : {};
  return { title: text(notification.title), body: text(notification.body), link: pushLinkOf(data), data };
}

/**
 * A push that arrives while a Vybe window is visible: FCM hands it to the
 * page instead of the tray, and the app announces it itself. Returns the
 * unsubscribe.
 */
export function onForegroundMessage(callback: (push: ForegroundPush) => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void getMessagingSafe().then((loaded) => {
    if (!loaded || cancelled) return;
    stop = loaded.sdk.onMessage(loaded.messaging, (payload) => callback(foregroundPushOf(payload)));
  });
  return () => {
    cancelled = true;
    stop?.();
    stop = null;
  };
}
