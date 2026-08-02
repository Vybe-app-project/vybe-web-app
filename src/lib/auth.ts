import { create } from 'zustand';
import { api, tokenStore, adminApi } from './api';

export type User = {
  _id: string;
  username: string;
  fullName?: string;
  email?: string;
  profilePicture?: string;
  bio?: string;
  isVerified?: boolean;
  isTrainer?: boolean;
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
    const { data } = await adminApi.post('/admins/login', { email, password });
    tokenStore.setAdmin(data.token);
    set({ admin: data.admin || data.user, adminLoading: false });
  },

  logout: () => {
    tokenStore.clear();
    set({ user: null });
    location.href = '/login';
  },

  adminLogout: () => {
    tokenStore.clearAdmin();
    set({ admin: null });
    location.href = '/admin/login';
  },
}));
