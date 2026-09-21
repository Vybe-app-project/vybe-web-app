import { useEffect } from 'react';
import { create } from 'zustand';
import type { AxiosError } from 'axios';
import { api, tokenStore, adminApi, revokeSession, signOutReason } from './api';
import { forgetPushTokenOnSignOut } from './firebase';
import { disposeSocket } from './socket';
import type { AccountFields, HomeGymRef } from './accountTypes';

/**
 * Field names follow the backend `User` model: the photo is `avatar`
 * (there is no `profilePicture` virtual), the cover is `coverPicture`.
 */
export type User = {
  _id: string;
  username: string;
  fullName?: string;
  email?: string;
  avatar?: string;
  coverPicture?: string;
  bio?: string;
  /** Auth policy only (email or provider identity proven); never a badge. */
  isVerified?: boolean;
  /** Staff-granted public "Verified" check. */
  isIdentityVerified?: boolean;
  isTrainer?: boolean;
  isCoach?: boolean;
  followersCount?: number;
  followingCount?: number;
  /** Owner-only account fields from GET /users/me (lib/accountTypes). */
  settings?: AccountFields['settings'];
  hiddenWords?: AccountFields['hiddenWords'];
  pendingDeletion?: AccountFields['pendingDeletion'];
  deletion?: AccountFields['deletion'];
  hasPassword?: AccountFields['hasPassword'];
  /** The viewer's home gym (GET /users/me); absent until set. */
  homeGym?: HomeGymRef | null;
  [k: string]: any;
};

/**
 * PUT /users/settings and PUT /users/me answer the whole account WITHOUT
 * `hasPassword` (only GET /users/me adds it). Storing that answer verbatim
 * would drop the flag, so every settings writer merges through here: the
 * next copy wins, and `hasPassword` is kept from the previous copy of the
 * same account when the new one does not carry it.
 */
export const mergeAccount = (prev: User | null | undefined, next: User): User => {
  if (next.hasPassword !== undefined || !prev || String(prev._id) !== String(next._id) || prev.hasPassword === undefined) return next;
  return { ...next, hasPassword: prev.hasPassword };
};

export type LoginOptions = {
  /** false = a one-day, tab-scoped session for a shared computer. Default true. */
  remember?: boolean;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  /**
   * The session could not be verified with the API (offline, or the API is
   * down) and `user` was restored from the local snapshot. The shell paints and
   * says so; bootstrap runs again when the connection returns.
   */
  sessionStale: boolean;
  admin: any | null;
  adminLoading: boolean;
  /**
   * Set by login() for an account inside its deletion grace period: the token
   * is kept for the lifecycle routes (cancel, status) but `user` stays null,
   * because every other route refuses the account. Login shows the
   * pending-deletion interstitial while this is set.
   */
  pendingDeletion: { scheduledFor: string | null } | null;
  clearPendingDeletion: () => void;
  bootstrap: () => Promise<void>;
  bootstrapAdmin: () => Promise<void>;
  setUser: (u: User | null) => void;
  login: (email: string, password: string, options?: LoginOptions) => Promise<void>;
  /**
   * Store a `{ token, user }` the API already minted. `POST /auth/login`,
   * `/auth/google/mobile` and `/auth/apple/mobile` answer the same shape, so
   * the provider buttons land the session through exactly the path the email
   * form does — including the pending-deletion branch, which every sign-in
   * must honour or the first request after it 401s.
   */
  adoptSession: (payload: { token: string; user: User }, options?: LoginOptions) => void;
  /**
   * Re-read the session user from the API. The stored user carries signed
   * media URLs (avatar, cover) that expire after a while; components mounting
   * later with the stale copy would show initials instead of the photo.
   * Throttled so a page full of avatars failing at once costs one request.
   */
  refreshUser: (options?: { force?: boolean }) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  /** End this device's session only. */
  logout: () => void;
  /** End every session on every device (POST /auth/logout-all), then this one. */
  logoutEverywhere: () => void;
  adminLogout: () => void;
  /** Drop the local admin session only; used when the API has already revoked it. */
  forgetAdminSession: () => void;
};

const USER_REFRESH_THROTTLE_MS = 30_000;
let lastUserRefreshAt = 0;
let userRefreshInFlight: Promise<void> | null = null;

/** A 401/403 means the session itself is bad; anything else is the network or the server. */
const isSessionRejected = (error: unknown): boolean => {
  const status = (error as AxiosError | undefined)?.response?.status;
  return status === 401 || status === 403;
};

/** Identity-only snapshot so an offline reload can paint the shell. */
const rememberSnapshot = (u: User | null) => {
  if (u && u._id && u.username) tokenStore.setUser({ _id: u._id, username: u.username, fullName: u.fullName, avatar: u.avatar });
};

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  sessionStale: false,
  admin: null,
  adminLoading: true,
  pendingDeletion: null,
  clearPendingDeletion: () => set({ pendingDeletion: null }),

  bootstrap: async () => {
    if (!tokenStore.get()) return set({ user: null, loading: false, sessionStale: false });
    try {
      const { data } = await api.get('/users/me');
      lastUserRefreshAt = Date.now();
      const user = (data.user || data) as User;
      rememberSnapshot(user);
      set({ user, loading: false, sessionStale: false });
    } catch (error) {
      // Only an answer from the API can end the session. A 401 has already
      // been handled by the interceptor (token cleared, hand-off to /login
      // with the path preserved); a 403 means unverified or suspended.
      if (isSessionRejected(error)) {
        tokenStore.clear();
        return set({ user: null, loading: false, sessionStale: false });
      }
      // Offline, or the API is unreachable: this is not a sign-in problem, so
      // the token stays and the shell paints from the snapshot; a reload with
      // connectivity back signs the person straight in.
      const snapshot = tokenStore.getUser();
      const current = get().user;
      set({
        user: current ?? (snapshot ? (snapshot as User) : null),
        loading: false,
        sessionStale: true,
      });
    }
  },

  refreshUser: async ({ force = false } = {}) => {
    if (!tokenStore.get() || !get().user) return;
    if (userRefreshInFlight) return userRefreshInFlight;
    if (!force && Date.now() - lastUserRefreshAt < USER_REFRESH_THROTTLE_MS) return;
    userRefreshInFlight = (async () => {
      try {
        const { data } = await api.get('/users/me');
        lastUserRefreshAt = Date.now();
        set({ user: data.user || data });
      } catch {
        // A 401 is handled by the API interceptor; anything else keeps the
        // current copy, which is still the best information we have.
      } finally {
        userRefreshInFlight = null;
      }
    })();
    return userRefreshInFlight;
  },

  bootstrapAdmin: async () => {
    if (!tokenStore.getAdmin()) return set({ admin: null, adminLoading: false });
    try {
      const { data } = await adminApi.get('/admins/me');
      // GET /admins/me answers with the same envelope as login:
      // { success, message, data: { admin } }. Reading `data.admin || data`
      // stored the whole envelope, so after any page reload `admin.role` was
      // undefined and a super admin saw the "Super admin only" callout on the
      // Administrators page. Unwrap every shape the API has used.
      const admin = data?.data?.admin ?? data?.admin ?? data;
      set({ admin: admin && typeof admin === 'object' ? admin : null, adminLoading: false });
    } catch (error) {
      // Only a 401/403 means the session is bad (the 401 has already been
      // handled by the adminApi interceptor). A 429 from the rate limiter or
      // a network failure used to clear the token too, so RequireAdmin
      // bounced a signed-in operator to /admin/login; now the token stays
      // and an empty identity keeps the console mounted until /admins/me
      // answers again through useCurrentAdmin.
      if (isSessionRejected(error)) {
        tokenStore.clearAdmin();
        return set({ admin: null, adminLoading: false });
      }
      set({ admin: get().admin ?? {}, adminLoading: false });
    }
  },

  setUser: (u) => {
    rememberSnapshot(u);
    // Settings writers hand back the account without hasPassword; keep it.
    set((s) => ({ user: u ? mergeAccount(s.user, u) : null }));
  },

  adoptSession: ({ token, user }, { remember = true }: LoginOptions = {}) => {
    tokenStore.set(token, remember ? 'local' : 'session');
    if ((user as User | undefined)?.pendingDeletion === true) {
      set({
        user: null,
        loading: false,
        sessionStale: false,
        pendingDeletion: { scheduledFor: user.deletion?.scheduledFor ?? null },
      });
      return;
    }
    rememberSnapshot(user);
    set({ user, loading: false, sessionStale: false, pendingDeletion: null });
  },

  login: async (email, password, { remember = true }: LoginOptions = {}) => {
    // remember:false asks the API for a one-day token and keeps it in
    // sessionStorage, so closing the tab on a shared computer ends the session.
    const { data } = await api.post('/auth/login', { email, password, remember });
    tokenStore.set(data.token, remember ? 'local' : 'session');
    if (data.user?.pendingDeletion === true) {
      // Grace period: keep the token for the lifecycle routes, but do not sign
      // in -- GuestOnly would redirect into the app and the first request 401s.
      set({
        user: null,
        loading: false,
        sessionStale: false,
        pendingDeletion: { scheduledFor: data.user.deletion?.scheduledFor ?? null },
      });
      return;
    }
    rememberSnapshot(data.user);
    set({ user: data.user, loading: false, sessionStale: false, pendingDeletion: null });
  },

  adminLogin: async (email, password) => {
    const { data: body } = await adminApi.post('/admins/login', { email, password });
    // POST /admins/login answers with an envelope -- { success, message,
    // data: { admin, token } } -- unlike the consumer login, which returns
    // { token, user } at the top level. This read `body.token`, which was
    // always undefined, so it stored an undefined token and no administrator
    // could ever sign in to the console. Accept both shapes and fail loudly
    // rather than "succeeding" with no session.
    const payload = body?.data && typeof body.data === 'object' ? body.data : body;
    const token: unknown = payload?.token;
    const admin = payload?.admin ?? payload?.user;
    if (typeof token !== 'string' || !token || !admin) {
      throw new Error(body?.message || 'Sign-in did not return an admin session.');
    }
    tokenStore.setAdmin(token);
    set({ admin, adminLoading: false });
  },

  logout: () => {
    // Revoke on the server before forgetting the token locally. Sessions are
    // long-lived bearer tokens; clearing localStorage alone left a valid
    // 30-day token alive in whatever browser issued it. POST /auth/logout
    // revokes this token's own session id, so only this device signs out;
    // other devices keep working (logoutEverywhere is the wide version).
    // Best-effort and fire-and-forget: signing out must never be blocked by
    // the network, and a failed revocation still leaves the user signed out
    // locally, which is the pre-existing behaviour. revokeSession() carries
    // the token explicitly and survives the navigation below; see api.ts.
    revokeSession('/auth/logout', tokenStore.get());
    // Take this browser's push token off the account on the way out, or the
    // next person to sign in here inherits the previous account's pushes.
    // Same keepalive reasoning as the revocation above, and best-effort for
    // the same reason: signing out must never wait on the network.
    forgetPushTokenOnSignOut(tokenStore.get());
    // The shared realtime socket authenticated with this token; drop it so it
    // cannot keep a revoked session "online" or hold a live room open.
    disposeSocket();
    tokenStore.clear();
    set({ user: null, sessionStale: false, pendingDeletion: null });
    location.href = '/login';
  },

  logoutEverywhere: () => {
    revokeSession('/auth/logout-all', tokenStore.get());
    forgetPushTokenOnSignOut(tokenStore.get());
    disposeSocket();
    tokenStore.clear();
    set({ user: null, sessionStale: false });
    signOutReason.set('signed-out-all');
    location.href = '/login';
  },

  adminLogout: () => {
    // Same reasoning, via the admin-side route. This matters more for the
    // console, which shares the consumer origin: one leaked admin token is the
    // whole moderation surface.
    revokeSession('/admins/logout', tokenStore.getAdmin());
    tokenStore.clearAdmin();
    set({ admin: null });
    location.href = '/admin/login';
  },

  forgetAdminSession: () => {
    // After a password reset the API has bumped tokenVersion, so any admin
    // token this tab still holds is already dead. Forgetting it here means the
    // next visit to /admin/login shows the form straight away instead of first
    // failing a /admins/me call with the stale bearer.
    tokenStore.clearAdmin();
    set({ admin: null, adminLoading: false });
  },
}));

/** How long a tab may sit hidden before its session user counts as stale. */
export const SESSION_STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Keep the session user fresh while the app is open: on returning to the tab
 * after a long absence and on a slow interval while it stays visible. Signed
 * media URLs in the stored user expire after roughly fifteen minutes, so a
 * tab left alone came back with an avatar that 403'd into initials.
 */
export function useSessionRefresh(onStale?: () => void) {
  const refreshUser = useAuth((s) => s.refreshUser);
  const signedIn = useAuth((s) => !!s.user);
  useEffect(() => {
    if (!signedIn) return;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (away >= SESSION_STALE_AFTER_MS) {
        void refreshUser({ force: true });
        onStale?.();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUser({ force: true });
    }, SESSION_STALE_AFTER_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [signedIn, refreshUser, onStale]);
}
