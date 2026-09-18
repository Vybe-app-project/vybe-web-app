import { format, formatDistanceToNowStrict } from 'date-fns';

/**
 * Stream shapes and formatting shared by the Live list page and the room.
 * Field names follow the backend LiveStream model and its toJSON transform
 * (viewers, likes, gifts and the session fields never reach the client).
 */

export const CATEGORY_OPTIONS = [
  { value: 'workout', label: 'Workout' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'strength', label: 'Strength' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'motivation', label: 'Motivation' },
  { value: 'q&a', label: 'Q&A' },
  { value: 'general', label: 'General' },
];

export const categoryLabel = (v?: string) =>
  CATEGORY_OPTIONS.find((o) => o.value === v)?.label || (v ? v.charAt(0).toUpperCase() + v.slice(1) : '');

export type StreamUser = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
};

export type StreamStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';

export type Stream = {
  _id: string;
  title: string;
  description?: string;
  category?: string;
  status?: StreamStatus;
  thumbnail?: string;
  host?: StreamUser | string;
  moderators?: Array<StreamUser | string>;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  maximumEndsAt?: string;
  duration?: number;
  currentViewers?: number;
  peakViewers?: number;
  totalViews?: number;
  likeCount?: number;
  commentCount?: number;
  isLiked?: boolean;
  tags?: string[];
  settings?: { visibility?: string; allowComments?: boolean; allowGifts?: boolean; maxViewers?: number };
};

export type StreamComment = {
  _id: string;
  text: string;
  createdAt?: string;
  user?: StreamUser;
};

export const ago = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

export const at = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, "EEE d MMM 'at' h:mm a");
};

export const hostOf = (s?: Stream | null): StreamUser | null => (s && s.host && typeof s.host === 'object' ? s.host : null);
export const hostId = (s?: Stream | null): string => {
  if (!s?.host) return '';
  return typeof s.host === 'string' ? s.host : s.host._id;
};
export const hostName = (s?: Stream | null) => {
  const h = hostOf(s);
  return h?.fullName?.trim() || h?.username || 'Host';
};
export const viewersOf = (s: Stream) => s.currentViewers ?? 0;
export const likesOf = (s: Stream) => s.likeCount ?? 0;
export const chatAllowed = (s?: Stream | null) => s?.settings?.allowComments !== false;
export const giftsAllowed = (s?: Stream | null) => s?.settings?.allowGifts !== false;

export const userIdOf = (user: { _id?: string; id?: string } | null | undefined): string => String(user?._id || user?.id || '');
export const commenterName = (c: StreamComment) => c.user?.fullName?.trim() || c.user?.username || 'Viewer';
