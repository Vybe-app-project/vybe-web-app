import { create } from 'zustand';
import type { AxiosError } from 'axios';
import { api, tokenStore, adminApi, revokeSession, signOutReason } from './api';
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
  /**
   * The session could not be verified with the API (offline, or the API is
   * down) and `user` was restored from the local snapshot. The shell paints and
   * says so; bootstrap runs again when the connection returns.
   */
  sessionStale: boolean;
  admin: any | null;
  adminLoading: boolean;
  bootstrap: () => Promise<void>;
  bootstrapAdmin: () => Promise<void>;
  setUser: (u: User | null) => void;
  login: (email: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  /** End this device's session only. */
  logout: () => void;
  /** End every session on every device (POST /auth/logout-all), then this one. */
  logoutEverywhere: () => void;
  adminLogout: () => void;
  /** Drop the local admin session only; used when the API has already revoked it. */
  forgetAdminSession: () => void;
};

/** A 401/403 means the session itself is bad; anything else is the network or the server. */
const isSessionRejected = (error: unknown): boolean => {
  const status = (error as AxiosError | undefined)?.response?.status;
  return status === 401 || status === 403;
};

const remember = (u: User | null) => {
  if (u && u._id && u.username) tokenStore.setUser({ _id: u._id, username: u.username, fullName: u.fullName, avatar: u.avatar });
};

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  sessionStale: false,
  admin: null,
  adminLoading: true,

  bootstrap: async () => {
    if (!tokenStore.get()) return set({ user: null, loading: false, sessionStale: false });
    try {
      const { data } = await api.get('/users/me');
      const user = (data.user || data) as User;
      remember(user);
      set({ user, loading: false, sessionStale: false });
    } catch (error) {
      if (isSessionRejected(error)) {
        // The interceptor has already dropped the token and is redirecting.
        tokenStore.clear();
        return set({ user: null, loading: false, sessionStale: false });
      }
      // Offline, or the API is unreachable: this is not a sign-in problem, so
      // the token stays and the shell paints from the snapshot. Before this,
      // any failure here cleared the token and every offline reload landed on
      // the sign-in page with "Unable to verify your sign-in".
      const snapshot = tokenStore.getUser();
      const current = get().user;
      set({
        user: current ?? (snapshot ? (snapshot as User) : null),
        loading: false,
        sessionStale: true,
      });
    }
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

  setUser: (u) => {
    remember(u);
    set({ user: u });
  },

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.token);
    remember(data.user);
    set({ user: data.user, loading: false, sessionStale: false });
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
    // The shared realtime socket authenticated with this token; drop it so it
    // cannot keep a revoked session "online" or hold a live room open.
    disposeSocket();
    tokenStore.clear();
    set({ user: null, sessionStale: false });
    location.href = '/login';
  },

  logoutEverywhere: () => {
    revokeSession('/auth/logout-all', tokenStore.get());
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
