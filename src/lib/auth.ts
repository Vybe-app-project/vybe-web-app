import { useEffect } from 'react';
import { create } from 'zustand';
import { api, tokenStore, adminApi, revokeSession } from './api';
import { disposeSocket } from './socket';

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
  isVerified?: boolean;
  isTrainer?: boolean;
  isCoach?: boolean;
  isPremium?: boolean;
  followersCount?: number;
  followingCount?: number;
  [k: string]: any;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  admin: any | null;
  adminLoading: boolean;
  bootstrap: () => Promise<void>;
  bootstrapAdmin: () => Promise<void>;
  setUser: (u: User | null) => void;
  /**
   * Re-read the session user from the API. The stored user carries signed
   * media URLs (avatar, cover) that expire after a while; components mounting
   * later with the stale copy would show initials instead of the photo.
   * Throttled so a page full of avatars failing at once costs one request.
   */
  refreshUser: (options?: { force?: boolean }) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  logout: () => void;
  adminLogout: () => void;
  /** Drop the local admin session only; used when the API has already revoked it. */
  forgetAdminSession: () => void;
};

const USER_REFRESH_THROTTLE_MS = 30_000;
let lastUserRefreshAt = 0;
let userRefreshInFlight: Promise<void> | null = null;

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  admin: null,
  adminLoading: true,

  bootstrap: async () => {
    if (!tokenStore.get()) return set({ user: null, loading: false });
    try {
      const { data } = await api.get('/users/me');
      lastUserRefreshAt = Date.now();
      set({ user: data.user || data, loading: false });
    } catch {
      tokenStore.clear();
      set({ user: null, loading: false });
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
      set({ admin: data.admin || data, adminLoading: false });
    } catch {
      tokenStore.clearAdmin();
      set({ admin: null, adminLoading: false });
    }
  },

  setUser: (u) => set({ user: u }),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.token);
    set({ user: data.user, loading: false });
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
    // bumps the account's tokenVersion, which the API checks on every
    // request, so every outstanding token dies -- not only this tab's.
    // Best-effort and fire-and-forget: signing out must never be blocked by
    // the network, and a failed revocation still leaves the user signed out
    // locally, which is the pre-existing behaviour. revokeSession() carries
    // the token explicitly and survives the navigation below; see api.ts.
    revokeSession('/auth/logout', tokenStore.get());
    // The shared realtime socket authenticated with this token; drop it so it
    // cannot keep a revoked session "online" or hold a live room open.
    disposeSocket();
    tokenStore.clear();
    set({ user: null });
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
