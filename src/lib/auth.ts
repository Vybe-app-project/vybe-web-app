import axios from 'axios';
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
  bootstrapError: string | null;
  admin: any | null;
  adminLoading: boolean;
  adminBootstrapError: string | null;
  bootstrap: () => Promise<void>;
  bootstrapAdmin: () => Promise<void>;
  setUser: (u: User | null) => void;
  login: (email: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  logout: () => void;
  adminLogout: () => void;
  /** Drop the local admin session only; used when the API has already revoked it. */
  forgetAdminSession: () => void;
};

let userBootstrap: Promise<void> | null = null;
let adminBootstrap: Promise<void> | null = null;

const hasIdentity = (value: unknown): value is { _id: string } =>
  typeof value === 'object' && value !== null && '_id' in value
  && typeof value._id === 'string' && value._id.length > 0;

const isUser = (value: unknown): value is User =>
  hasIdentity(value) && 'username' in value && typeof value.username === 'string';

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  bootstrapError: null,
  admin: null,
  adminLoading: true,
  adminBootstrapError: null,

  bootstrap: () => {
    if (userBootstrap) return userBootstrap;
    const token = tokenStore.get();
    if (!token) {
      set({ user: null, loading: false, bootstrapError: null });
      return Promise.resolve();
    }
    set({ loading: true, bootstrapError: null });
    userBootstrap = (async () => {
      try {
        const { data } = await api.get('/users/me', { sessionVerification: true });
        if (tokenStore.get() !== token) {
          if (!tokenStore.get()) set({ user: null, loading: false, bootstrapError: null });
          return;
        }
        const user: unknown = data?.user ?? data;
        if (!isUser(user)) throw new Error('Session response has no user identity.');
        set({ user, loading: false, bootstrapError: null });
      } catch (error) {
        const current = tokenStore.get();
        if (current && current !== token) return;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401) {
          tokenStore.clear();
          set({ user: null, loading: false, bootstrapError: null });
        } else if (!current) {
          set({ user: null, loading: false, bootstrapError: null });
        } else if (current === token) {
          console.warn('User session verification is unavailable.', { status });
          set({ loading: false, bootstrapError: 'Your saved sign-in is still on this device. Check your connection and try again.' });
        }
      }
    })().finally(() => { userBootstrap = null; });
    return userBootstrap;
  },

  bootstrapAdmin: () => {
    if (adminBootstrap) return adminBootstrap;
    const token = tokenStore.getAdmin();
    if (!token) {
      set({ admin: null, adminLoading: false, adminBootstrapError: null });
      return Promise.resolve();
    }
    set({ adminLoading: true, adminBootstrapError: null });
    adminBootstrap = (async () => {
      try {
        const { data } = await adminApi.get('/admins/me', { sessionVerification: true });
        if (tokenStore.getAdmin() !== token) {
          if (!tokenStore.getAdmin()) set({ admin: null, adminLoading: false, adminBootstrapError: null });
          return;
        }
        const admin: unknown = data?.data?.admin ?? data?.admin ?? data;
        if (!hasIdentity(admin)) throw new Error('Session response has no administrator identity.');
        set({ admin, adminLoading: false, adminBootstrapError: null });
      } catch (error) {
        const current = tokenStore.getAdmin();
        if (current && current !== token) return;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401) {
          tokenStore.clearAdmin();
          set({ admin: null, adminLoading: false, adminBootstrapError: null });
        } else if (!current) {
          set({ admin: null, adminLoading: false, adminBootstrapError: null });
        } else if (current === token) {
          console.warn('Administrator session verification is unavailable.', { status });
          set({ adminLoading: false, adminBootstrapError: 'Your administrator sign-in is still in this tab. Check your connection and try again.' });
        }
      }
    })().finally(() => { adminBootstrap = null; });
    return adminBootstrap;
  },

  setUser: (u) => set({ user: u, loading: false, bootstrapError: null }),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.token);
    set({ user: data.user, loading: false, bootstrapError: null });
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
    set({ admin, adminLoading: false, adminBootstrapError: null });
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
    set({ user: null, loading: false, bootstrapError: null });
    location.href = '/login';
  },

  adminLogout: () => {
    // Same reasoning, via the admin-side route. This matters more for the
    // console, which shares the consumer origin: one leaked admin token is the
    // whole moderation surface.
    revokeSession('/admins/logout', tokenStore.getAdmin());
    tokenStore.clearAdmin();
    set({ admin: null, adminLoading: false, adminBootstrapError: null });
    location.href = '/admin/login';
  },

  forgetAdminSession: () => {
    // After a password reset the API has bumped tokenVersion, so any admin
    // token this tab still holds is already dead. Forgetting it here means the
    // next visit to /admin/login shows the form straight away instead of first
    // failing a /admins/me call with the stale bearer.
    tokenStore.clearAdmin();
    set({ admin: null, adminLoading: false, adminBootstrapError: null });
  },
}));
