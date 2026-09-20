/**
 * The 13 production seed rows (scripts/seed-production-catalog.js ACHIEVEMENTS)
 * as GET /achievements/user returns them, with one member's state applied:
 * a backfilled award, an unacknowledged auto award, an acknowledged one, a
 * row with criteria met, two retired rows (one of them earned), and the new
 * four-weeks-kept row at 1 of 4. Shared by the rules and render tests.
 */
/** Stable, distinct ObjectId-shaped ids per seed position, so two seed() calls describe the same rows (queries are matched by _id). */
const oid = (index) => `6aad635402be1805f4b9ef${index.toString(16).padStart(2, '0')}`;

/** One catalogue row as GET /achievements/user returns it, per-member fields defaulted to "unearned, no progress". */
const row = (name, title, category, rarity, type, value, points, member = {}) => ({
  name,
  title,
  description: `${title}.`,
  category,
  type: 'single',
  icon: 'ribbon',
  iconColor: '#00D4AA',
  rarity,
  criteria: { type, value, timeframe: 'once' },
  rewards: { points, experience: points, badges: [], unlocks: [] },
  isActive: true,
  isHidden: false,
  isSeasonal: false,
  stats: { totalEarned: 0, totalUsers: 0, completionRate: 0 },
  display: { showProgress: true, showPercentage: true, showRewards: true },
  isEarned: false,
  earnedAt: null,
  ackedAt: null,
  awardedBy: null,
  progress: 0,
  required: value,
  progressPercentage: 0,
  canClaim: false,
  ...member,
});

/** The 13 production seed rows (scripts/seed-production-catalog.js), with one member's state applied. */
export const seed = (opts = {}) => withIds([
  row('first-workout', 'First Move', 'workout', 'common', 'workouts', 1, 50, {
    isEarned: true, awardedBy: 'backfill', earnedAt: '2026-09-01T00:00:00.000Z', progress: 12, progressPercentage: 100,
  }),
  row('ten-workouts', 'Building Momentum', 'workout', 'uncommon', 'workouts', 10, 150, {
    isEarned: true, awardedBy: 'auto', earnedAt: '2026-09-12T12:00:00.000Z', ackedAt: null, progress: 12, progressPercentage: 100,
  }),
  row('fifty-workouts', 'Training Habit', 'workout', 'rare', 'workouts', 50, 500, { progress: 12, progressPercentage: 24 }),
  row('calorie-kickoff', 'Energy in Motion', 'milestone', 'uncommon', 'calories', 1000, 125, { isActive: false }),
  row('step-starter', 'Step Starter', 'milestone', 'common', 'steps', 10000, 75),
  row('three-day-streak', 'Three-Day Rhythm', 'streak', 'common', 'streak', 3, 100, {
    isActive: false,
    ...(opts.retiredEarned === false
      ? {}
      : { isEarned: true, awardedBy: 'claim', earnedAt: '2026-06-01T12:00:00.000Z', progress: 3, progressPercentage: 100 }),
  }),
  row('four-weeks-kept', 'Four weeks kept', 'milestone', 'uncommon', 'weeksKept', 4, 200, { progress: 1, progressPercentage: 25 }),
  row('first-post', 'Join the Conversation', 'social', 'common', 'posts', 1, 50, {
    isEarned: true, awardedBy: 'auto', earnedAt: '2026-09-10T12:00:00.000Z', ackedAt: '2026-09-10T12:05:00.000Z', progress: 3, progressPercentage: 100,
  }),
  row('ten-posts', 'Progress Journal', 'social', 'uncommon', 'posts', 10, 150, { progress: 3, progressPercentage: 30 }),
  row('ten-likes-received', 'Social Spark', 'social', 'uncommon', 'likes', 10, 125, { progress: 10, progressPercentage: 100, canClaim: true }),
  row('five-comments-received', 'Conversation Starter', 'social', 'uncommon', 'comments', 5, 125),
  row('ten-followers', 'Community Builder', 'social', 'rare', 'followers', 10, 250, { progress: 9, progressPercentage: 90 }),
  row('hundred-workouts', 'Century Club', 'milestone', 'epic', 'workouts', 100, 1000, { progress: 12, progressPercentage: 12 }),
]);

const withIds = (rows) => rows.map((r, i) => ({ ...r, _id: oid(i), display: { ...r.display, order: i } }));
