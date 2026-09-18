/**
 * The device's timezone offset in the convention the API expects.
 *
 * The API takes `timezoneOffsetMinutes` and computes the local day as
 * `now - offset * 60_000` (backend `utils/localDate.js`, `localDayRange`).
 * That is exactly the value `Date.prototype.getTimezoneOffset()` returns:
 * minutes to ADD to local time to reach UTC, so +240 for New York in summer
 * (UTC-4) and -60 for Berlin in winter (UTC+1). The mobile app sends it raw
 * and agrees with the server.
 *
 * The web app negated it -- `getTimezoneOffset() * -1` -- under a comment
 * claiming "positive means east of UTC". That was the opposite of the server's
 * convention, so every timezone-aware page (Water, Meals daily summary, Health,
 * Health Goals, Achievements, Profile streaks) asked the server about a "today"
 * shifted by twice the user's UTC offset: eight hours off for the US east
 * coast. Verified by reading the server helper, not inferred from the comment.
 *
 * Do not "fix" this by re-adding the sign. If the server convention ever
 * changes, change it here once.
 */
export const timezoneOffsetMinutes = (now: Date = new Date()): number =>
  now.getTimezoneOffset();
