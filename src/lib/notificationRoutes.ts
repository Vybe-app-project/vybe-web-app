/**
 * Where a notification row takes you, and how its sentence reads. Kept pure
 * so node:test can pin the routes: workout likes and comments used to have
 * no destination at all, and the sentence read "Alex Someone liked …".
 */

export type NotificationLike = {
  type: string;
  message?: string;
  body?: string;
  sender?: { _id?: string; fullName?: string; username?: string } | null;
  data?: Record<string, unknown>;
};

const idOf = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && '_id' in (v as object)) return String((v as { _id: unknown })._id);
  return null;
};

const TYPE_TEXT: Record<string, string> = {
  post_like: 'liked your post',
  comment_like: 'liked your comment',
  post_comment: 'commented on your post',
  comment: 'commented on your post',
  comment_reply: 'replied to your comment',
  follow: 'started following you',
  follow_request: 'requested to follow you',
  follow_accept: 'accepted your follow request',
  follow_request_accepted: 'accepted your follow request',
  friend_request: 'sent you a friend request',
  friend_accept: 'accepted your friend request',
  friend_request_accepted: 'accepted your friend request',
  message: 'sent you a message',
  workout_post: 'shared a new workout',
  workout_like: 'liked your workout',
  workout_comment: 'commented on your workout',
  workout_plan_like: 'liked your workout plan',
  workout_plan_comment: 'commented on your workout plan',
  new_workout: 'shared a workout',
  new_workout_plan: 'shared a workout plan',
  new_post: 'shared a post',
  new_meal: 'shared a meal',
  mention: 'mentioned you',
};

export const senderName = (n: NotificationLike): string =>
  n.sender?.fullName?.trim() || n.sender?.username || 'Vybe user';

/**
 * The sentence after the sender's name. Server copy may already start with
 * the name ("Alex liked your workout.") or with the old "Someone …"; both are
 * reduced to the predicate so the row never reads "Alex Someone liked".
 */
export function notificationSentence(n: NotificationLike): string {
  const raw = (n.body || n.message || '').trim();
  if (!raw) return TYPE_TEXT[n.type] || 'sent you an update';
  const name = n.sender ? senderName(n) : '';
  if (name && raw.toLowerCase().startsWith(name.toLowerCase())) {
    return raw.slice(name.length).replace(/^[\s,:]+/, '');
  }
  const someone = raw.match(/^(Someone you follow|Someone|A creator you follow)\s+(.*)$/i);
  if (someone) return someone[2];
  return raw;
}

/** Canonical destinations: posts at `/p/:id`, workouts at `/workouts/:id`, plans at `/workouts/plans/:id`. */
export function notificationHref(n: NotificationLike): string | null {
  const d = n.data || {};
  const postId = idOf(d.postId) || idOf(d.post);
  if (postId) return `/p/${postId}`;

  const workoutId = idOf(d.workoutId) || idOf(d.workout);
  if (workoutId) {
    return n.type === 'workout_comment' ? `/workouts/${workoutId}#comments` : `/workouts/${workoutId}`;
  }
  const planId = idOf(d.workoutPlanId) || idOf(d.workoutPlan) || idOf(d.planId);
  if (planId) return `/workouts/plans/${planId}`;
  const mealId = idOf(d.mealId) || idOf(d.meal);
  if (mealId) return `/meals/${mealId}`;

  if (n.type === 'message' || d.roomId || d.chatRoom || d.room) {
    const room = idOf(d.roomId) || idOf(d.chatRoom) || idOf(d.room);
    return room ? `/messages/${room}` : '/messages';
  }
  if (n.type === 'friend_request' || n.type === 'follow_request') return '/friends';

  // weekly_recap / monthly_recap rows carry { kind: 'recap', recapId, ... } and
  // also the member's own userId; the recap viewer is the destination, not
  // their own profile.
  const recapId = idOf(d.recapId);
  if (recapId) return `/recaps/${recapId}`;

  const senderId = idOf(n.sender?._id) || idOf(d.sender) || idOf(d.senderId) || idOf(d.userId) || idOf(d.followerId);
  if (senderId) return `/u/${senderId}`;
  return null;
}
