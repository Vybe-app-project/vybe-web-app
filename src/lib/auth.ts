import { create } from 'zustand';
import { api, tokenStore, adminApi, revokeSession } from './api';

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
  login: (email: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  logout: () => void;
  adminLogout: () => void;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  admin: null,
  adminLoading: true,

  bootstrap: async () => {
    if (!tokenStore.get()) return set({ user: null, loading: false });
    try {
      const { data } = await api.get('/users/me');
      set({ user: data.user || data, loading: false });
    } catch {
      tokenStore.clear();
      set({ user: null, loading: false });
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
}));
