import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/* ------------------------------------------------------------------ *
 * Shared domain types used across the consumer pages.
 * ------------------------------------------------------------------ */

export type PublicUser = {
  _id: string;
  username: string;
  fullName?: string;
  avatar?: string;
  bio?: string;
  isVerified?: boolean;
  isTrainer?: boolean;
  isCoach?: boolean;
  isPremium?: boolean;
  location?: string;
  fields?: string[];
  coverPicture?: string;
  followersCount?: number;
  followingCount?: number;
  isFollowing?: boolean;
  followStatus?: 'none' | 'following' | 'requested' | string;
  friendStatus?: string;
  canViewContent?: boolean;
  createdAt?: string;
  stats?: {
    workouts?: number;
    caloriesBurned?: number;
    followers?: number;
    following?: number;
    totalLikes?: number;
    totalComments?: number;
    totalPosts?: number;
  };
  settings?: { privacy?: string };
  [k: string]: any;
};

export type PostMedia = {
  _id?: string;
  type: 'image' | 'video';
  url: string;
  key?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
};

export type PostComment = {
  _id: string;
  text: string;
  createdAt: string;
  likes?: string[];
  user?: PublicUser | null;
};

export type Post = {
  _id: string;
  content?: string;
  medias?: PostMedia[];
  hashtags?: string[];
  likes?: string[];
  comments?: PostComment[];
  author?: PublicUser | null;
  isBookmarked?: boolean;
  createdAt: string;
  views?: number;
  category?: string;
  community?: { _id: string; name?: string } | null;
};

export type PagedPosts = {
  posts: Post[];
  total?: number;
  page?: number;
  hasNextPage?: boolean;
};

export type AppNotification = {
  _id: string;
  type: string;
  title?: string;
  body?: string;
  message?: string;
  isRead?: boolean;
  read?: boolean;
  createdAt: string;
  sender?: PublicUser | null;
  data?: Record<string, any>;
};

export const NOTIFICATION_SETTING_KEYS = [
  'pauseAll',
  'messagesFromFollowing',
  'messagesFromOthers',
  'newFollowers',
  'workoutPosts',
  'likes',
  'comments',
  'friendRequests',
] as const;

export type NotificationSettingKey = (typeof NOTIFICATION_SETTING_KEYS)[number];
export type NotificationSettings = Record<NotificationSettingKey, boolean>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  pauseAll: false,
  messagesFromFollowing: true,
  messagesFromOthers: false,
  newFollowers: true,
  workoutPosts: true,
  likes: true,
  comments: true,
  friendRequests: true,
};

/** Keep only the exact boolean keys the API accepts. */
export function pickNotificationSettings(raw: any): NotificationSettings {
  const source = raw && typeof raw === 'object' ? raw : {};
  return NOTIFICATION_SETTING_KEYS.reduce((acc, key) => {
    acc[key] =
      typeof source[key] === 'boolean'
        ? source[key]
        : DEFAULT_NOTIFICATION_SETTINGS[key];
    return acc;
  }, {} as NotificationSettings);
}

/* ------------------------------------------------------------------ *
 * Password / username policy (mirrors the API validators).
 * ------------------------------------------------------------------ */

export type PasswordRule = { id: string; label: string; ok: boolean };

export function passwordRules(pw: string): PasswordRule[] {
  return [
    { id: 'len', label: '12–128 characters', ok: pw.length >= 12 && pw.length <= 128 },
    { id: 'lower', label: 'One lowercase letter', ok: /[a-z]/.test(pw) },
    { id: 'upper', label: 'One uppercase letter', ok: /[A-Z]/.test(pw) },
    { id: 'number', label: 'One number', ok: /[0-9]/.test(pw) },
    {
      id: 'symbol',
      label: 'One symbol (!@#$…)',
      ok: /[^A-Za-z0-9]/.test(pw),
    },
  ];
}

export const isPasswordValid = (pw: string) => passwordRules(pw).every((r) => r.ok);

export const USERNAME_RE = /^[A-Za-z0-9._]{3,30}$/;

export function usernameError(value: string): string | null {
  if (!value) return 'Username is required';
  if (value.length < 3) return 'Username must be at least 3 characters';
  if (value.length > 30) return 'Username must be at most 30 characters';
  if (!USERNAME_RE.test(value))
    return 'Only letters, numbers, periods and underscores are allowed';
  return null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: string) => EMAIL_RE.test(v.trim());

/* ------------------------------------------------------------------ *
 * Small utility hooks.
 * ------------------------------------------------------------------ */

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Fires `onHit` when the returned ref enters the viewport. */
export function useInfiniteScroll(
  onHit: () => void,
  enabled: boolean,
): (node: HTMLElement | null) => void {
  const cb = useRef(onHit);
  cb.current = onHit;

  return useCallback(
    (node: HTMLElement | null) => {
      if (!node || !enabled) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) cb.current();
        },
        { rootMargin: '400px 0px' },
      );
      observer.observe(node);
      return () => observer.disconnect();
    },
    [enabled],
  );
}

/** Countdown helper for OTP resend throttling. */
export function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return [left, setLeft];
}

/* ------------------------------------------------------------------ *
 * Media upload helper — POST /upload/image (multipart, field "image").
 * ------------------------------------------------------------------ */

export type UploadedMedia = {
  url: string;
  key: string;
  type: 'image' | 'video';
  size?: number;
};

export async function uploadImage(
  file: File,
  purpose: 'posts' | 'avatars' | 'groups' = 'posts',
): Promise<UploadedMedia> {
  const form = new FormData();
  form.append('image', file);
  const { data } = await api.post(`/upload/image?type=${purpose}`, form);
  const key = data.key || data.storageReference;
  return {
    url: data.url || key,
    key,
    type: String(data.type || file.type).startsWith('video') ? 'video' : 'image',
    size: data.size,
  };
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

/* ------------------------------------------------------------------ *
 * Formatting helpers.
 * ------------------------------------------------------------------ */

export function timeAgo(iso?: string | number | Date): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function compactNumber(n?: number): string {
  const value = Number(n || 0);
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** Extract `#tags` from free text so the API receives a normalised list. */
export function extractHashtags(text: string): string[] {
  const found = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  return [...new Set(found.map((t) => t.slice(1).toLowerCase()))].slice(0, 30);
}

export const displayName = (u?: PublicUser | null) =>
  u?.fullName?.trim() || u?.username || 'Vybe user';

export const followerCount = (u?: PublicUser | null) =>
  u?.followersCount ?? u?.stats?.followers ?? 0;

export const followingCount = (u?: PublicUser | null) =>
  u?.followingCount ?? u?.stats?.following ?? 0;

export const postCount = (u?: PublicUser | null) => u?.stats?.totalPosts ?? 0;
