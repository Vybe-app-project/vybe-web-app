/**
 * Share links minted by the mobile app (src/utils/shareLinks.ts there) look
 * like  {WEB_BASE_URL}/open.html?type=<ShareLinkType>&id=<entity>. The old
 * static handoff page is gone; the SPA answers that path and resolves the
 * target to its canonical route here. Keep the type list and the id rule in
 * step with the mobile module.
 */
export const SHARE_TYPES = [
  'post', 'profile', 'meal', 'meal-template', 'meal-plan', 'workout', 'workout-plan', 'gym', 'community', 'live', 'challenge', 'hashtag',
  'session',
] as const;
export type ShareType = (typeof SHARE_TYPES)[number];

const SHARE_ENTITY_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const SHARE_LABEL: Record<ShareType, string> = {
  post: 'post',
  profile: 'profile',
  meal: 'meal',
  'meal-template': 'meal template',
  'meal-plan': 'weekly meal plan',
  workout: 'workout',
  'workout-plan': 'workout plan',
  gym: 'gym',
  community: 'community',
  live: 'live stream',
  challenge: 'challenge',
  hashtag: 'hashtag',
  session: 'session',
};

export function isShareType(value: unknown): value is ShareType {
  return typeof value === 'string' && (SHARE_TYPES as readonly string[]).includes(value);
}

/** A meal share token as minted by the API (32 random bytes, hex). */
const MEAL_SHARE_TOKEN = /^[a-f0-9]{64}$/i;

/**
 * Canonical in-app destination for a share target, or null when the link is
 * malformed. Templates and weekly plans travel as share tokens (or a public
 * plan id), which their pages read from `?shared=`; gyms open their detail
 * modal from `?gym=` and communities theirs from `?community=`. (Older app
 * builds shared communities as type `gym`; the Gyms page falls back to the
 * community route when such an id is not a directory gym.) A meal travels as
 * its share token when the sender shared it from the app (the recipient may
 * not be allowed to see the meal by id), so a token lands on the shared-meal
 * page and only a plain id on the meal itself. Newer app builds also share
 * workout plans, live streams, challenges and hashtags (mobile docs/deep-links.md):
 * a hashtag travels as the bare tag (a leading # is tolerated) and lands on the
 * search page; a challenge opens the Challenges page with its id in the query,
 * which the page may use once it has a detail view.
 */
export function shareDestination(type: string | null, id: string | null): string | null {
  if (!isShareType(type) || typeof id !== 'string') return null;
  const entity = type === 'hashtag' ? id.replace(/^#/, '') : id;
  if (!SHARE_ENTITY_ID.test(entity)) return null;
  const q = encodeURIComponent(entity);
  switch (type) {
    case 'post':
      return `/p/${q}`;
    case 'profile':
      return `/u/${q}`;
    case 'meal':
      return MEAL_SHARE_TOKEN.test(id) ? `/meals/shared/${q}` : `/meals/${q}`;
    case 'meal-template':
      return `/meals/templates?shared=${q}`;
    case 'meal-plan':
      return `/meals/plans?shared=${q}`;
    case 'workout':
      return `/workouts/${q}`;
    case 'workout-plan':
      return `/workouts/plans/${q}`;
    case 'gym':
      return `/gyms?gym=${q}`;
    case 'community':
      return `/communities?community=${q}`;
    case 'live':
      return `/live/${q}`;
    case 'challenge':
      return `/challenges?challenge=${q}`;
    case 'hashtag':
      return `/search?q=%23${q}`;
    case 'session':
      // A 24-hex session id or the API's 64-hex invite token; the page dispatches by shape.
      return `/session/${q}`;
  }
}

/** Deep link the installed app registers on both platforms (vybe://open). */
export function appDeepLink(type: ShareType, id: string): string {
  return `vybe://open?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}
