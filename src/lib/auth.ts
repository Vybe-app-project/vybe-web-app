import { useEffect } from 'react';
import { create } from 'zustand';
import { api, tokenStore, adminApi, revokeSession, signOutReason, isSessionRejected } from './api';
import { onSessionChange, sessionEpoch, verifyConsumerToken } from './consumerSession';
import { disposeSocket } from './socket';
import { purgeRevokedWorkoutDrafts } from './workoutDrafts';

export type User = {
  _id: string;
  username: string;
  fullName?: string;
  email?: string;
  avatar?: string;
  coverPicture?: string;
  bio?: string;
  /** Auth policy only; the staff-granted public badge is isIdentityVerified. */
  isVerified?: boolean;
  isIdentityVerified?: boolean;
  isTrainer?: boolean;
  isCoach?: boolean;
  isPremium?: boolean;
  followersCount?: number;
  followingCount?: number;
  [k: string]: any;
};
export type LoginOptions = { remember?: boolean };
type AuthState = {
  user: User | null;
  verifiedToken: string | null;
  loading: boolean;
  bootstrapError: string | null;
  sessionStale: boolean;
  sessionRejected: boolean;
  admin: any | null;
  adminLoading: boolean;
  adminBootstrapError: string | null;
  bootstrap: (options?: { preserveVerified?: boolean }) => Promise<void>;
  bootstrapAdmin: () => Promise<void>;
  refreshUser: (options?: { force?: boolean }) => Promise<void>;
  setUser: (u: User | null) => void;
  login: (email: string, password: string, options?: LoginOptions) => Promise<void>;
  acceptSession: (user: User, token: string, options?: LoginOptions) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  logout: () => void;
  logoutEverywhere: () => void;
  adminLogout: () => void;
  forgetAdminSession: () => void;
};
const hasIdentity = (value: unknown): value is { _id: string } =>
  typeof value === 'object' && value !== null && '_id' in value && typeof value._id === 'string' && !!value._id;
const isUser = (value: unknown): value is User =>
  hasIdentity(value) && 'username' in value && typeof value.username === 'string';
type Check = { token: string; epoch: number; promise: Promise<void> };
let userCheck: Check | null = null;
let adminCheck: Check | null = null;
let loginAttempt = 0;
let adminLoginAttempt = 0;
let refreshed: { token: string; epoch: number; at: number } | null = null;
const USER_REFRESH_THROTTLE_MS = 30_000;
const recoveryMessage = 'Your saved sign-in is still on this device. Check your connection and try again.';

export const useAuth = create<AuthState>((set, get) => ({
  user: null, verifiedToken: null, loading: true, bootstrapError: null,
  sessionStale: false, sessionRejected: false,
  admin: null, adminLoading: true, adminBootstrapError: null,

  bootstrap: ({ preserveVerified = false } = {}) => {
    const token = tokenStore.get();
    const epoch = sessionEpoch();
    if (!token) {
      verifyConsumerToken(null);
      set({ user: null, verifiedToken: null, loading: true, bootstrapError: null, sessionStale: false });
      return purgeRevokedWorkoutDrafts().then(() => {
        if (sessionEpoch() === epoch && !tokenStore.get()) set({ loading: false });
      });
    }
    if (userCheck?.token === token && userCheck.epoch === epoch) return userCheck.promise;
    const ownsCheck = () => tokenStore.get() === token && sessionEpoch() === epoch;
    if (get().verifiedToken !== token) set({ user: null, verifiedToken: null, loading: true, bootstrapError: null });
    const promise = (async () => {
      try {
        const { data } = await api.get('/users/me', { sessionVerification: true });
        if (!ownsCheck()) return;
        const user: unknown = data?.user ?? data;
        if (!isUser(user)) throw new Error('Session response has no user identity.');
        // The same credential returning a different principal must not reuse private queries.
        if (get().user && get().user!._id !== user._id) {
          tokenStore.clear(true);
          return;
        }
        verifyConsumerToken(token);
        await tokenStore.setUser(user, token);
        if (!ownsCheck()) return;
        refreshed = { token, epoch, at: Date.now() };
        set({ user, verifiedToken: token, loading: false, bootstrapError: null, sessionStale: false, sessionRejected: false });
      } catch (error) {
        if (!ownsCheck()) return;
        if (isSessionRejected(error)) {
          tokenStore.clear(true);
          return;
        }
        // A refresh outage must not tear down an already-verified editor and
        // lose input that a storage failure has left only in memory.
        if (preserveVerified && get().verifiedToken === token) return;
        verifyConsumerToken(null);
        const snapshot = await tokenStore.getUser();
        if (!ownsCheck()) return;
        set({
          user: snapshot, verifiedToken: null, loading: false, sessionStale: true,
          bootstrapError: snapshot ? null : recoveryMessage,
        });
      }
    })().finally(() => {
      if (userCheck?.promise === promise) userCheck = null;
    });
    userCheck = { token, epoch, promise };
    return promise;
  },

  refreshUser: async ({ force = false } = {}) => {
    const token = tokenStore.get();
    if (!token || !get().user) return;
    if (!force && refreshed?.token === token && refreshed.epoch === sessionEpoch()
        && Date.now() - refreshed.at < USER_REFRESH_THROTTLE_MS) return;
    await get().bootstrap({ preserveVerified: true });
  },

  bootstrapAdmin: () => {
    const token = tokenStore.getAdmin();
    const epoch = sessionEpoch('admin');
    if (!token) {
      set({ admin: null, adminLoading: false, adminBootstrapError: null });
      return Promise.resolve();
    }
    if (adminCheck?.token === token && adminCheck.epoch === epoch) return adminCheck.promise;
    const ownsCheck = () => tokenStore.getAdmin() === token && sessionEpoch('admin') === epoch;
    set({ adminLoading: true, adminBootstrapError: null });
    const promise = (async () => {
      try {
        const { data } = await adminApi.get('/admins/me', { sessionVerification: true });
        if (!ownsCheck()) return;
        const admin: unknown = data?.data?.admin ?? data?.admin ?? data;
        if (!hasIdentity(admin)) throw new Error('Session response has no administrator identity.');
        set({ admin, adminLoading: false, adminBootstrapError: null });
      } catch {
        if (!ownsCheck()) return;
        set({ adminLoading: false, adminBootstrapError: 'Your administrator sign-in is still in this tab. Check your connection and try again.' });
      }
    })().finally(() => {
      if (adminCheck?.promise === promise) adminCheck = null;
    });
    adminCheck = { token, epoch, promise };
    return promise;
  },

  setUser: (user) => {
    if (!user) {
      if (tokenStore.get()) return;
      verifyConsumerToken(null);
      set({ user: null, verifiedToken: null, loading: false, bootstrapError: null });
      return;
    }
    if (get().verifiedToken !== tokenStore.get() || !get().verifiedToken || get().user?._id !== user._id) return;
    void tokenStore.setUser(user, get().verifiedToken);
    set({ user });
  },

  login: async (email, password, { remember = true }: LoginOptions = {}) => {
    const attempt = ++loginAttempt;
    const epoch = sessionEpoch();
    const { data } = await api.post('/auth/login', { email, password, remember });
    if (attempt !== loginAttempt || epoch !== sessionEpoch()) throw new Error('Your account changed. Sign in again to continue.');
    await get().acceptSession(data.user, data.token, { remember });
  },
  acceptSession: async (user, token, { remember = true }: LoginOptions = {}) => {
    if (typeof token !== 'string' || !token || !isUser(user)) throw new Error('Sign-in did not return a valid session.');
    tokenStore.set(token, remember ? 'local' : 'session');
    const newEpoch = sessionEpoch();
    verifyConsumerToken(token);
    await tokenStore.setUser(user, token);
    if (newEpoch !== sessionEpoch() || tokenStore.get() !== token) return;
    set({ user, verifiedToken: token, loading: false, bootstrapError: null, sessionStale: false, sessionRejected: false });
  },

  adminLogin: async (email, password) => {
    const attempt = ++adminLoginAttempt;
    const epoch = sessionEpoch('admin');
    const { data: body } = await adminApi.post('/admins/login', { email, password });
    if (attempt !== adminLoginAttempt || epoch !== sessionEpoch('admin')) throw new Error('Your administrator account changed.');
    const payload = body?.data && typeof body.data === 'object' ? body.data : body;
    const token: unknown = payload?.token;
    const admin = payload?.admin ?? payload?.user;
    if (typeof token !== 'string' || !token || !hasIdentity(admin)) throw new Error(body?.message || 'Sign-in did not return an admin session.');
    tokenStore.setAdmin(token);
    set({ admin, adminLoading: false, adminBootstrapError: null });
  },

  logout: () => {
    revokeSession('/auth/logout', tokenStore.get());
    disposeSocket();
    tokenStore.clear();
    location.href = '/login';
  },
  logoutEverywhere: () => {
    revokeSession('/auth/logout-all', tokenStore.get());
    disposeSocket();
    tokenStore.clear();
    signOutReason.set('signed-out-all');
    location.href = '/login';
  },
  adminLogout: () => {
    revokeSession('/admins/logout', tokenStore.getAdmin());
    tokenStore.clearAdmin();
    location.href = '/admin/login';
  },
  forgetAdminSession: () => { tokenStore.clearAdmin(); },
}));

onSessionChange((kind, rejected, external) => {
  if (kind === 'admin') {
    useAuth.setState({ admin: null, adminLoading: false, adminBootstrapError: null });
    return;
  }
  disposeSocket();
  useAuth.setState({
    user: null, verifiedToken: null, loading: external && !!tokenStore.get(),
    bootstrapError: null, sessionStale: false, sessionRejected: rejected,
  });
  if (external) queueMicrotask(() => { void useAuth.getState().bootstrap(); });
});

export const SESSION_STALE_AFTER_MS = 10 * 60 * 1000;
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
