/**
 * Push-switch and email-preference vocabulary for the Settings page, mirrored
 * from the API (vybe-backend/services/notificationDelivery.js
 * DEFAULT_NOTIFICATION_SETTINGS and NOTIFICATION_TYPE_SETTINGS;
 * services/emailPreferences.js EMAIL_PREFERENCE_DEFAULTS;
 * services/returnLoop.js validateHydrationTimes).
 *
 * Import-free on purpose: tests/notification-settings.test.mjs transpiles this
 * file in memory and imports it directly, and compares the key list with the
 * backend checkout when one is present. src/lib/hooks.ts re-exports everything
 * here so existing import paths keep working.
 */

/* ------------------------------------------------------------------ push switches */

/** The 18 booleans of `GET /notifications/settings` `settings`, in the API's order. */
export const NOTIFICATION_SETTING_KEYS = [
  'pauseAll',
  'messagesFromFollowing',
  'messagesFromOthers',
  'newFollowers',
  'workoutPosts',
  'likes',
  'comments',
  'friendRequests',
  'planShares',
  'gymCommunity',
  'rhythm',
  'events',
  'mentions',
  'weeklyRecap',
  'sessions',
  'checkins',
  'hydration',
  'achievements',
] as const;

export type NotificationSettingKey = (typeof NOTIFICATION_SETTING_KEYS)[number];
export type NotificationSettings = Record<NotificationSettingKey, boolean>;

/** The API defaults: only pauseAll, messagesFromOthers and hydration start off. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  pauseAll: false,
  messagesFromFollowing: true,
  messagesFromOthers: false,
  newFollowers: true,
  workoutPosts: true,
  likes: true,
  comments: true,
  friendRequests: true,
  planShares: true,
  gymCommunity: true,
  rhythm: true,
  events: true,
  mentions: true,
  weeklyRecap: true,
  sessions: true,
  checkins: true,
  hydration: false,
  achievements: true,
};

/** Keep only the exact boolean keys the API accepts, defaults filled in. */
export function pickNotificationSettings(raw: unknown): NotificationSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return NOTIFICATION_SETTING_KEYS.reduce((acc, key) => {
    const value = source[key];
    acc[key] = typeof value === 'boolean' ? value : DEFAULT_NOTIFICATION_SETTINGS[key];
    return acc;
  }, {} as NotificationSettings);
}

export type NotificationSettingGroup = {
  id: 'activity' | 'messages' | 'community' | 'rhythm' | 'reminders';
  title: string;
  keys: readonly NotificationSettingKey[];
};

/**
 * How the Settings card groups the 17 switches under `pauseAll`. Every key
 * except `pauseAll` sits in exactly one group (pinned by the test).
 */
export const NOTIFICATION_SETTING_GROUPS: readonly NotificationSettingGroup[] = [
  { id: 'activity', title: 'Activity', keys: ['newFollowers', 'friendRequests', 'likes', 'comments', 'mentions', 'workoutPosts'] },
  { id: 'messages', title: 'Messages', keys: ['messagesFromFollowing', 'messagesFromOthers'] },
  { id: 'community', title: 'Community and gyms', keys: ['gymCommunity', 'events', 'planShares', 'sessions'] },
  { id: 'rhythm', title: 'Training rhythm and recaps', keys: ['rhythm', 'weeklyRecap', 'achievements'] },
  { id: 'reminders', title: 'Reminders', keys: ['checkins', 'hydration'] },
];

export type SettingLabel = { title: string; hint: string };

/**
 * Row copy. The title doubles as the Switch's accessible name, so the eight
 * titles that shipped before Wave E stay verbatim. Hints say what the API
 * actually gates (NOTIFICATION_TYPE_SETTINGS), one sentence each.
 */
export const NOTIFICATION_LABELS: Record<NotificationSettingKey, SettingLabel> = {
  pauseAll: {
    title: 'Pause all notifications',
    hint: 'Stops every push except notices about your own account.',
  },
  messagesFromFollowing: {
    title: 'Messages from people you follow',
    hint: 'Direct messages and group chats from accounts connected to you.',
  },
  messagesFromOthers: {
    title: 'Messages from everyone else',
    hint: 'Direct messages and group chats from accounts not connected to you.',
  },
  newFollowers: { title: 'New followers', hint: 'When someone follows you.' },
  workoutPosts: { title: 'Workout posts', hint: 'New posts, workouts, plans and meals from people you follow.' },
  likes: { title: 'Likes', hint: 'When someone likes your post, comment, workout or plan, or reacts to your story.' },
  comments: {
    title: 'Comments',
    hint: 'When someone comments on or replies to your post, workout, plan or meal, or replies to your story.',
  },
  friendRequests: { title: 'Friend requests', hint: 'Incoming and accepted follow and friend requests.' },
  planShares: { title: 'Shared plans', hint: 'When someone shares a meal plan with you or copies one of your plans.' },
  gymCommunity: {
    title: 'Gym community',
    hint: 'When someone joins your gym community, your membership changes, or you trained at the same time as someone you follow.',
  },
  rhythm: { title: 'Weekly rhythm', hint: 'Your weekly rhythm summary and milestones.' },
  events: { title: 'Gym events', hint: 'Reminders, changes, cancellations and waitlist updates for events you joined.' },
  mentions: { title: 'Mentions', hint: 'When someone mentions you in a comment.' },
  weeklyRecap: { title: 'Recaps', hint: 'When your weekly or monthly recap is ready.' },
  sessions: {
    title: 'Together sessions',
    hint: 'Invites, a heads-up ten minutes before, start and cancellation notices, and the summary afterwards.',
  },
  checkins: {
    title: 'Check-ins from Vybe',
    hint: 'A welcome note, two check-ins in your first week, and a note if you have been away for a while.',
  },
  hydration: {
    title: 'Water check-ins',
    hint: 'A reminder at the times you choose, skipped when you logged water in the last two hours or reached today’s goal.',
  },
  achievements: { title: 'Achievements', hint: 'When you earn an achievement.' },
};

/* ------------------------------------------------------------------ hydration times */

/** `hydrationReminders` on the settings body: 1-3 sorted `HH:MM` times, or null when off. */
export type HydrationReminders = { times: string[] } | null;

export const HYDRATION_TIMES_MAX = 3;

/** 24-hour `HH:MM`; the same pattern the API validates with (services/returnLoop.js CLOCK_PATTERN). */
export const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `<input type="time">` may emit `HH:MM:SS`; the API only accepts `HH:MM`. */
export function normalizeClock(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) return trimmed;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export const HYDRATION_TIMES_ERRORS = {
  empty: 'Add at least one time, or remove them all to turn water check-ins off.',
  tooMany: `Up to ${HYDRATION_TIMES_MAX} times a day.`,
  /** A row that was added and never filled; `<input type="time">` emits '' or a valid HH:MM, nothing else. */
  blank: 'Pick a time for each reminder, or remove the empty row.',
  format: 'Enter each time as a 24-hour clock time, like 09:00.',
  duplicate: 'Each time can only be used once.',
} as const;

/**
 * A failed check names the sentence and, when one row is at fault (blank or
 * malformed), that row's index so the editor can mark the field itself.
 * Duplicate and too-many belong to the set, so they carry no index.
 */
export type HydrationTimesResult = { value: string[]; error?: never; index?: never } | { error: string; index?: number; value?: never };

/**
 * The API's four shape rules for `hydrationReminders.times`, checked before
 * the request: one to three entries, `HH:MM`, distinct. The value comes back
 * sorted, as the API stores it. Quiet-hours and timezone checks stay on the
 * server; their 400s are worded for the web by hydrationSaveErrorMessage.
 */
export function validateHydrationTimes(input: readonly string[]): HydrationTimesResult {
  const times = input.map((time) => normalizeClock(time));
  if (times.length === 0) return { error: HYDRATION_TIMES_ERRORS.empty };
  if (times.length > HYDRATION_TIMES_MAX) return { error: HYDRATION_TIMES_ERRORS.tooMany };
  const blank = times.findIndex((time) => time === '');
  if (blank !== -1) return { error: HYDRATION_TIMES_ERRORS.blank, index: blank };
  const malformed = times.findIndex((time) => !CLOCK_RE.test(time));
  if (malformed !== -1) return { error: HYDRATION_TIMES_ERRORS.format, index: malformed };
  if (new Set(times).size !== times.length) return { error: HYDRATION_TIMES_ERRORS.duplicate };
  return { value: [...times].sort() };
}

/**
 * "09:00", "09:00 and 13:00", "06:00, 12:00 and 18:00": the saved times as a
 * person would list them.
 */
export function listClockTimes(times: readonly string[]): string {
  if (times.length <= 1) return times[0] ?? '';
  return `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
}

/**
 * The toast after a save. A save while the switch was off turns Water
 * check-ins on in the same request, and the toast says so rather than
 * letting the switch flip silently.
 */
export function hydrationSavedToast(times: readonly string[], turnedOn: boolean): string {
  if (turnedOn && times.length > 0) return `Water check-ins on at ${listClockTimes(times)}`;
  return 'Water check-in times saved';
}

/** `{ times }` from the API body, or null when absent, empty or unusable. */
export function pickHydrationReminders(raw: unknown): HydrationReminders {
  if (!raw || typeof raw !== 'object') return null;
  const times = (raw as { times?: unknown }).times;
  if (!Array.isArray(times)) return null;
  const valid = times.filter((time): time is string => typeof time === 'string' && CLOCK_RE.test(time));
  if (valid.length === 0) return null;
  return { times: [...new Set(valid)].sort().slice(0, HYDRATION_TIMES_MAX) };
}

/* ------------------------------------------------------------------ the settings body */

export type QuietHours = { start: string; end: string } | null;

/**
 * The sentence under the times editor when the phone has set quiet hours:
 * the API refuses a water check-in inside the window (HYDRATION_TIME_IN_QUIET_HOURS),
 * so the member has to be able to read the window on this page.
 */
export function quietHoursHint(quietHours: QuietHours): string | null {
  if (!quietHours) return null;
  return `Quiet hours are ${quietHours.start} to ${quietHours.end}. Pick times outside them.`;
}

/** The subset of a parsed API error this module reads; typed structurally to stay import-free. */
export type HydrationSaveFailure = { code?: string | null; message: string; body?: unknown };

export const HYDRATION_TIMEZONE_MESSAGE = 'Water check-ins need your timezone. Reload this page so Vybe can save it, then try again.';

/**
 * The web's own sentence for the two hydration 400s the API can still send
 * after the shape checks above (controllers/notificationController.js):
 *
 * - HYDRATION_TIME_IN_QUIET_HOURS carries `time`; the window comes from the
 *   same settings query, so the sentence names it (the API's sentence does
 *   not, and has no terminal period).
 * - TIMEZONE_REQUIRED: the API says "Update the app", written for the phone.
 *   On the web lib/accountPreferences sends the zone at sign-in and on every
 *   return to the tab, so a reload is what actually fixes it.
 *
 * Anything else keeps the API's sentence.
 */
export function hydrationSaveErrorMessage(failure: HydrationSaveFailure, quietHours: QuietHours): string {
  if (failure.code === 'HYDRATION_TIME_IN_QUIET_HOURS') {
    const body = (failure.body && typeof failure.body === 'object' ? failure.body : {}) as { time?: unknown };
    const time = typeof body.time === 'string' && CLOCK_RE.test(body.time) ? body.time : null;
    const window = quietHours ? ` (${quietHours.start} to ${quietHours.end})` : '';
    const subject = time ?? 'One of these times';
    return `${subject} is inside your quiet hours${window}. Pick a time outside them.`;
  }
  if (failure.code === 'TIMEZONE_REQUIRED') return HYDRATION_TIMEZONE_MESSAGE;
  return failure.message;
}

/** The whole `GET /notifications/settings` body; quiet hours are read, never written, by this page. */
export type NotificationSettingsResponse = {
  settings: NotificationSettings;
  quietHours: QuietHours;
  quietHoursTimezone: string | null;
  hydrationReminders: HydrationReminders;
};

export const EMPTY_NOTIFICATION_SETTINGS_RESPONSE: NotificationSettingsResponse = {
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  quietHours: null,
  quietHoursTimezone: null,
  hydrationReminders: null,
};

function pickQuietHours(raw: unknown): QuietHours {
  if (!raw || typeof raw !== 'object') return null;
  const { start, end } = raw as { start?: unknown; end?: unknown };
  if (typeof start !== 'string' || typeof end !== 'string' || !CLOCK_RE.test(start) || !CLOCK_RE.test(end)) return null;
  return { start, end };
}

/** Read a GET or PUT answer; a legacy body that is only the switches still works. */
export function pickNotificationSettingsResponse(data: unknown): NotificationSettingsResponse {
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const hasSettingsKey = body.settings && typeof body.settings === 'object';
  return {
    settings: pickNotificationSettings(hasSettingsKey ? body.settings : body),
    quietHours: pickQuietHours(body.quietHours),
    quietHoursTimezone: typeof body.quietHoursTimezone === 'string' && body.quietHoursTimezone ? body.quietHoursTimezone : null,
    hydrationReminders: pickHydrationReminders(body.hydrationReminders),
  };
}

/* ------------------------------------------------------------------ email preferences */

/**
 * Email preferences are a separate store on the API
 * (GET/PUT /users/email-preferences -> settings.emailNotifications), not a
 * view over the push switches; the keys overlap on purpose, the values do not.
 * Nine kinds in the API's order; `productUpdates` is the one that starts off.
 */
export const EMAIL_SETTING_KEYS = [
  'newFollowers',
  'workoutPosts',
  'likes',
  'comments',
  'friendRequests',
  'weeklyRecap',
  'checkins',
  'achievements',
  'productUpdates',
] as const;
export type EmailSettingKey = (typeof EMAIL_SETTING_KEYS)[number];
export type EmailSettings = Record<EmailSettingKey, boolean>;

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  newFollowers: true,
  workoutPosts: true,
  likes: true,
  comments: true,
  friendRequests: true,
  weeklyRecap: true,
  checkins: true,
  achievements: true,
  productUpdates: false,
};

export function pickEmailSettings(raw: unknown): EmailSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return EMAIL_SETTING_KEYS.reduce((acc, key) => {
    const value = source[key];
    acc[key] = typeof value === 'boolean' ? value : DEFAULT_EMAIL_SETTINGS[key];
    return acc;
  }, {} as EmailSettings);
}

/** The "Pause all email" row; `emailPaused` on the API body. */
export const EMAIL_PAUSE_LABEL: SettingLabel = {
  title: 'Pause all email',
  hint: 'Stops every email below. Sign-in codes, password resets and account notices still arrive.',
};

/** Row copy for the nine kinds. `productUpdates` is marketing and says so. */
export const EMAIL_LABELS: Record<EmailSettingKey, SettingLabel> = {
  newFollowers: { title: 'New followers', hint: 'When someone follows you.' },
  workoutPosts: { title: 'Workout posts', hint: 'New posts from people you follow.' },
  likes: { title: 'Likes', hint: 'When someone likes your post or comment.' },
  comments: { title: 'Comments', hint: 'When someone comments on your post.' },
  friendRequests: { title: 'Friend requests', hint: 'Incoming and accepted follow and friend requests.' },
  weeklyRecap: { title: 'Recaps', hint: 'When your weekly or monthly recap is ready.' },
  checkins: { title: 'Check-ins from Vybe', hint: 'A welcome note, first-week check-ins, and a note if you have been away for a while.' },
  achievements: { title: 'Achievements', hint: 'When you earn an achievement.' },
  productUpdates: { title: 'Marketing and product updates', hint: 'Occasional news about Vybe. Off unless you turn it on.' },
};
