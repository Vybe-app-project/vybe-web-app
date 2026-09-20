/**
 * What each notification type says and how it is drawn, keyed on the API's
 * `Notification.type` enum (vybe-backend/models/Notification.js). Import-free
 * so tests/notifications.test.mjs can load it and check that every enum value
 * is covered: the previous table used keys the API never emits (friend_accept,
 * comment_like, workout_post, mention) and lacked most real ones, so an
 * accepted friend request rendered as "<Name> sent you an update" with no
 * glyph.
 *
 * Mirrors the mobile app's ACTIVITIES/CATEGORIES table
 * (vybe-app-mobile/src/utils/notificationList.ts) so both clients read the
 * same event the same way.
 */

/** The API enum, in the model's order. tests/notifications.test.mjs checks it against the backend when that checkout is present. */
export const NOTIFICATION_TYPES = [
  'follow',
  'follow_request',
  'follow_request_accepted',
  'friend_request',
  'friend_request_accepted',
  'post_like',
  'post_comment',
  'post_comment_like',
  'workout_like',
  'workout_comment',
  'workout_plan_like',
  'workout_plan_comment',
  'meal_comment',
  'meal_plan_shared',
  'meal_plan_like',
  'meal_plan_copied',
  'weekly_plan_like',
  'weekly_plan_copied',
  'new_post',
  'new_workout',
  'new_workout_plan',
  'new_meal',
  'message',
  'new_group_chat',
  'gym_member_joined',
  'gym_membership_update',
  'system',
  'security',
  'account',
  'session_invite',
  'session_starting',
  'session_started',
  'session_cancelled',
  'session_summary',
  'weekly_recap',
  'monthly_recap',
  'welcome_note',
  'first_week_checkin',
  'hydration_reminder',
  'dormancy_touch',
  'achievement_earned',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Which small glyph sits on the avatar. Resolved to an icon component by the page. */
export type NotificationGlyph =
  | 'droplet'
  | 'trophy'
  | 'heart'
  | 'comment'
  | 'user-plus'
  | 'user-check'
  | 'users'
  | 'inbox'
  | 'dumbbell'
  | 'utensils'
  | 'clipboard'
  | 'image'
  | 'copy'
  | 'share'
  | 'building'
  | 'shield'
  | 'bell'
  | 'settings';

/** The four badge fills plus the neutral one, same split as mobile. */
export type NotificationFamily = 'people' | 'content' | 'like' | 'conversation' | 'system';

export type NotificationCopy = {
  /** Sentence fragment after the actor's name ("liked your post"); the full sentence for system rows. */
  text: string;
  glyph: NotificationGlyph;
  family: NotificationFamily;
};

const ACTIVITY: Record<NotificationType, NotificationCopy> = {
  follow: { text: 'started following you', glyph: 'user-plus', family: 'people' },
  follow_request: { text: 'requested to follow you', glyph: 'user-plus', family: 'people' },
  follow_request_accepted: { text: 'accepted your follow request', glyph: 'user-check', family: 'people' },
  friend_request: { text: 'sent you a friend request', glyph: 'users', family: 'people' },
  friend_request_accepted: { text: 'accepted your friend request', glyph: 'user-check', family: 'people' },
  post_like: { text: 'liked your post', glyph: 'heart', family: 'like' },
  post_comment: { text: 'commented on your post', glyph: 'comment', family: 'conversation' },
  post_comment_like: { text: 'liked your comment', glyph: 'heart', family: 'like' },
  workout_like: { text: 'liked your workout', glyph: 'heart', family: 'like' },
  workout_comment: { text: 'commented on your workout', glyph: 'comment', family: 'conversation' },
  workout_plan_like: { text: 'liked your workout plan', glyph: 'heart', family: 'like' },
  workout_plan_comment: { text: 'commented on your workout plan', glyph: 'comment', family: 'conversation' },
  meal_comment: { text: 'commented on your meal', glyph: 'comment', family: 'conversation' },
  meal_plan_shared: { text: 'shared a meal plan with you', glyph: 'share', family: 'content' },
  meal_plan_like: { text: 'liked your meal plan', glyph: 'heart', family: 'like' },
  meal_plan_copied: { text: 'copied your meal plan', glyph: 'copy', family: 'content' },
  weekly_plan_like: { text: 'liked your weekly plan', glyph: 'heart', family: 'like' },
  weekly_plan_copied: { text: 'copied your weekly plan', glyph: 'copy', family: 'content' },
  new_post: { text: 'shared a new post', glyph: 'image', family: 'content' },
  new_workout: { text: 'shared a new workout', glyph: 'dumbbell', family: 'content' },
  new_workout_plan: { text: 'shared a new workout plan', glyph: 'clipboard', family: 'content' },
  new_meal: { text: 'shared a new meal', glyph: 'utensils', family: 'content' },
  message: { text: 'sent you a message', glyph: 'inbox', family: 'conversation' },
  new_group_chat: { text: 'added you to a group chat', glyph: 'users', family: 'conversation' },
  gym_member_joined: { text: 'joined your gym community', glyph: 'building', family: 'people' },
  gym_membership_update: { text: 'updated your gym membership', glyph: 'building', family: 'people' },
  // No actor: the server supplies `message`; these are the fallbacks.
  // Together sessions (services/sessionJobs.js): the host is the sender; rows link to /session/:sessionId.
  session_invite: { text: 'invited you to train together', glyph: 'users', family: 'people' },
  session_starting: { text: 'is about to start a session', glyph: 'dumbbell', family: 'people' },
  session_started: { text: 'started a session', glyph: 'dumbbell', family: 'people' },
  session_cancelled: { text: 'cancelled a session', glyph: 'users', family: 'people' },
  session_summary: { text: 'Your session is saved.', glyph: 'dumbbell', family: 'system' },
  // Recaps and the return loop (services/recaps.js, services/returnLoopJobs.js): the member is the sender, so no name prefix.
  weekly_recap: { text: 'Your weekly recap is ready.', glyph: 'clipboard', family: 'system' },
  monthly_recap: { text: 'Your monthly recap is ready.', glyph: 'clipboard', family: 'system' },
  welcome_note: { text: 'Welcome to Vybe.', glyph: 'bell', family: 'system' },
  first_week_checkin: { text: 'A check-in from Vybe.', glyph: 'dumbbell', family: 'system' },
  hydration_reminder: { text: 'Time for some water.', glyph: 'droplet', family: 'system' },
  dormancy_touch: { text: 'Your place is saved whenever you are ready.', glyph: 'bell', family: 'system' },
  achievement_earned: { text: 'You earned a badge.', glyph: 'trophy', family: 'system' },
  system: { text: 'Vybe has an update for you.', glyph: 'bell', family: 'system' },
  security: { text: 'There was a security event on your account.', glyph: 'shield', family: 'system' },
  account: { text: 'Your account was updated.', glyph: 'settings', family: 'system' },
};

/** Rows with no human actor: rendered without a name, on a neutral badge. */
export const SYSTEM_TYPES: ReadonlySet<string> = new Set(['system', 'security', 'account']);

export function isSystemNotification(type: string | undefined | null): boolean {
  return SYSTEM_TYPES.has(String(type || '').toLowerCase());
}

const GENERIC: NotificationCopy = { text: 'sent you an update', glyph: 'bell', family: 'system' };

/** Copy and glyph for a type; unknown types get a generic bell rather than nothing. */
export function notificationCopy(type: string | undefined | null): NotificationCopy {
  const key = String(type || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return (ACTIVITY as Record<string, NotificationCopy>)[key] ?? GENERIC;
}

export type NotificationLike = {
  type?: string;
  body?: string;
  message?: string;
  sender?: { _id?: string } | null;
  data?: Record<string, unknown> | null;
};

/** The sentence shown after (or instead of) the actor's name. Server copy wins. */
export function notificationText(n: NotificationLike): string {
  const supplied = (n.body || n.message || '').trim();
  return supplied || notificationCopy(n.type).text;
}

const idOf = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && '_id' in (v as object)) return String((v as { _id: unknown })._id);
  return null;
};

/**
 * Canonical destination for a notification. Posts live at `/p/:postId`,
 * threads at `/messages/:roomId`, requests at `/friends`. System rows go to
 * Settings (a password change to the Password card), never to the user's
 * own public profile.
 */
export function notificationHref(n: NotificationLike): string | null {
  const type = String(n.type || '').toLowerCase();
  const d = (n.data || {}) as Record<string, unknown>;

  if (isSystemNotification(type)) {
    const href = typeof d.href === 'string' && d.href.startsWith('/') && !d.href.startsWith('//') ? d.href : null;
    if (href) return href;
    // "Your Vybe data is ready" (services/dataExport.js) sets no href; it belongs on the Download-your-data card.
    if (d.notificationType === 'data_export_ready') return '/settings#data';
    if (type === 'security') return '/settings#password';
    if (type === 'account') return '/settings#account';
    return null;
  }

  const postId = idOf(d.postId) || idOf(d.post);
  if (postId) return `/p/${postId}`;

  if (type === 'message' || type === 'new_group_chat' || d.roomId || d.chatRoom || d.room || d.chatRoomId) {
    const room = idOf(d.roomId) || idOf(d.chatRoom) || idOf(d.room) || idOf(d.chatRoomId);
    return room ? `/messages/${room}` : '/messages';
  }
  if (type === 'friend_request' || type === 'follow_request') return '/friends';

  const workoutId = idOf(d.workoutId) || idOf(d.workout);
  if (workoutId && (type === 'workout_like' || type === 'workout_comment' || type === 'new_workout')) return `/workouts/${workoutId}`;
  const mealId = idOf(d.mealId) || idOf(d.meal);
  if (mealId && (type === 'meal_comment' || type === 'new_meal')) return `/meals/${mealId}`;
  if (type.startsWith('meal_plan_') || type.startsWith('weekly_plan_')) return '/meals/plans';
  if (type === 'new_workout_plan' || type.startsWith('workout_plan_')) return '/workouts';
  if (type.startsWith('gym_')) return '/communities';

  // Together sessions carry { kind: 'session', sessionId, senderId } (services/sessionJobs.js routingData).
  const sessionId = idOf(d.sessionId);
  if (sessionId && type.startsWith('session_')) return `/session/${sessionId}`;
  // Return-loop touches and badges name their destination by type; they carry no entity id worth a deep link.
  if (type === 'achievement_earned') return '/achievements';
  if (type === 'hydration_reminder') return '/health/water';
  if (type === 'first_week_checkin') return '/workouts';
  if (type === 'welcome_note' || type === 'dormancy_touch') return '/';

  // weekly_recap / monthly_recap rows carry { kind: 'recap', recapId, recapKind,
  // periodKey, userId } with the member as sender; the recap viewer is the
  // destination, not their own profile.
  const recapId = idOf(d.recapId);
  if (recapId) return `/recaps/${recapId}`;

  const senderId = idOf(n.sender?._id) || idOf(d.sender) || idOf(d.senderId) || idOf(d.userId) || idOf(d.followerId);
  if (senderId) return `/u/${senderId}`;
  return null;
}
