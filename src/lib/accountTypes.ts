/**
 * The account-settings contract of `GET /users/me` and `PUT /users/settings`
 * (API 4e22914). Import-free so hooks.ts and auth.ts can both use it and so
 * tests can load it straight from source.
 *
 * Shapes mirror the backend exactly:
 *   controllers/userController.js  SETTINGS_KEYS (the PUT allow-list)
 *   models/extensions/user/safety.js        hiddenWords, settings.health, settings.commentDefault
 *   models/extensions/user/preferences.js   settings.units / locale / timezone / accessibility
 *   models/extensions/user/data-lifecycle.js pendingDeletion, deletion
 *   models/extensions/user/workout-preferences.js settings.workout (progressionHints, defaultRepRange)
 *   utils/userPreferences.js                validators (units, locale, timezone, accessibility)
 *
 * Another member's profile (`GET /users/:id`) exposes `settings` as exactly
 * `{ privacy }`, so every owner-only field here stays optional.
 */

/** `settings.commentDefault.policy` (User.COMMENT_POLICIES). */
export const COMMENT_POLICIES = ['everyone', 'followers', 'following', 'off'] as const;
export type CommentPolicy = (typeof COMMENT_POLICIES)[number];

export type CommentDefault = {
  policy?: CommentPolicy;
  approveFirst?: boolean;
};

/** Owner-only display switches (settings.health); rendering only, no health data changes. */
export type HealthDisplaySettings = {
  showCalories?: boolean;
  showWeight?: boolean;
};

/** `settings.accessibility` keys (utils/userPreferences.js ACCESSIBILITY_KEYS). */
export const ACCESSIBILITY_KEYS = ['reduceMotion', 'largeText'] as const;
export type AccessibilityKey = (typeof ACCESSIBILITY_KEYS)[number];

/** Absent until set; a partial object is normal after one key was cleared. */
export type AccessibilitySettings = {
  reduceMotion?: boolean;
  largeText?: boolean;
};

export type UnitsSetting = 'metric' | 'imperial';

/**
 * `settings.workout` (models/extensions/user/workout-preferences.js): the two
 * preferences behind the suggested next set. Schema defaults are true / 8-12
 * on every account; read them defensively anyway (lib/progress workoutPreferencesOf).
 */
export type WorkoutSettings = {
  progressionHints?: boolean;
  defaultRepRange?: { min: number; max: number };
};

export type AccountSettings = {
  privacy?: 'public' | 'private' | string;
  /** Push preferences; the notifications lane owns the key list. */
  notifications?: Record<string, boolean>;
  emailNotifications?: Record<string, boolean>;
  health?: HealthDisplaySettings;
  commentDefault?: CommentDefault;
  /** Absent until the member chooses; clients fall back to the device locale. */
  units?: UnitsSetting;
  /** Canonical BCP-47 ('en-US'); absent until set. */
  locale?: string;
  /** Canonical IANA zone ('America/New_York'); absent until set. */
  timezone?: string;
  /** Absent until set; partial allowed. */
  accessibility?: AccessibilitySettings;
  /** Suggestions switch and default rep range (Wave F progression). */
  workout?: WorkoutSettings;
};

/** `hiddenWords` on the owner's own account (defaults true/true/true/[]). */
export type HiddenWordsSettings = {
  enabled: boolean;
  useDefaultList: boolean;
  applyToMessageRequests: boolean;
  custom: string[];
};

/** `deletion` on the owner's own account; `{}` or partial, `scheduledFor` unset after a cancel. */
export type DeletionInfo = {
  requestedAt?: string;
  scheduledFor?: string;
  mode?: 'immediate' | 'scheduled';
  reasons?: string[];
  client?: { platform?: string; appVersion?: string };
  cancelledAt?: string;
};

/**
 * Exactly the top-level keys `PUT /users/settings` accepts
 * (controllers/userController.js SETTINGS_KEYS). Anything else is
 * `400 { message: 'Unknown setting: <key>', field: '<key>' }`.
 */
export const SETTINGS_KEYS = [
  'privacy',
  'notifications',
  'health',
  'hiddenWords',
  'commentDefault',
  'units',
  'locale',
  'timezone',
  'accessibility',
  'workout',
  'homeGym',
] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

/**
 * One PATCH body for `PUT /users/settings`: only the keys present change.
 * `null` clears an optional preference (units, locale, timezone, one
 * accessibility flag, or the whole accessibility object).
 */
export type SettingsPatch = {
  privacy?: 'public' | 'private';
  notifications?: Record<string, boolean>;
  health?: HealthDisplaySettings;
  hiddenWords?: Partial<HiddenWordsSettings>;
  commentDefault?: CommentDefault;
  units?: UnitsSetting | null;
  locale?: string | null;
  timezone?: string | null;
  accessibility?: { reduceMotion?: boolean | null; largeText?: boolean | null } | null;
  /** `defaultRepRange: null` returns to 8-12; min < max, whole numbers 1-50 (services/progression.js workoutSettingsPatch). */
  workout?: { progressionHints?: boolean; defaultRepRange?: { min: number; max: number } | null };
  /**
   * The viewer's home gym: an active membership (`community`, a 24-hex id) or a
   * provider place (`place.osmId` = `osm-<node|way|relation>-<digits>`); `null`
   * clears it. Always round-trip a community as `{ community }` — a community
   * created without a place carries a `vybe-…` id that fails the OSM pattern.
   * Errors carry `field: 'homeGym'`: 403 NOT_A_MEMBER, 404 COMMUNITY_NOT_FOUND.
   */
  homeGym?: { community: string } | { place: { osmId: string; name: string } } | null;
};

/**
 * `GET /users/me` `homeGym`: absent entirely until set. `community` is a bare
 * id (not populated), so the gym's name, cover and members need
 * `GET /gyms/community/:id`; `place.name` can be painted at once.
 */
export type HomeGymRef = {
  community?: string | null;
  place?: { osmId: string; name: string } | null;
  setAt?: string;
};

/** The owner-only account fields `GET /users/me` adds on top of the public profile. */
export type AccountFields = {
  settings?: AccountSettings;
  hiddenWords?: HiddenWordsSettings;
  pendingDeletion?: boolean;
  deletion?: DeletionInfo;
  /** Added by GET /users/me only; PUT /users/settings and PUT /users/me answer without it. */
  hasPassword?: boolean;
};
