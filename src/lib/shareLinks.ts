/**
 * Share links minted by the mobile app (src/utils/shareLinks.ts there) look
 * like  {WEB_BASE_URL}/open.html?type=<ShareLinkType>&id=<entity>. The old
 * static handoff page is gone; the SPA answers that path and resolves the
 * target to its canonical route here. Keep the type list and the id rule in
 * step with the mobile module.
 */
export const SHARE_TYPES = ['post', 'profile', 'meal', 'meal-template', 'meal-plan', 'workout', 'gym'] as const;
export type ShareType = (typeof SHARE_TYPES)[number];

const SHARE_ENTITY_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const SHARE_LABEL: Record<ShareType, string> = {
  post: 'post',
  profile: 'profile',
  meal: 'meal',
  'meal-template': 'meal template',
  'meal-plan': 'weekly meal plan',
  workout: 'workout',
  gym: 'gym',
};

export function isShareType(value: unknown): value is ShareType {
  return typeof value === 'string' && (SHARE_TYPES as readonly string[]).includes(value);
}

/**
 * Canonical in-app destination for a share target, or null when the link is
 * malformed. Templates and weekly plans travel as share tokens (or a public
 * plan id), which their pages read from `?shared=`; gyms open their detail
 * modal from `?gym=`.
 */
export function shareDestination(type: string | null, id: string | null): string | null {
  if (!isShareType(type) || typeof id !== 'string' || !SHARE_ENTITY_ID.test(id)) return null;
  const q = encodeURIComponent(id);
  switch (type) {
    case 'post':
      return `/p/${q}`;
    case 'profile':
      return `/u/${q}`;
    case 'meal':
      return `/meals/${q}`;
    case 'meal-template':
      return `/meals/templates?shared=${q}`;
    case 'meal-plan':
      return `/meals/plans?shared=${q}`;
    case 'workout':
      return `/workouts/${q}`;
    case 'gym':
      return `/gyms?gym=${q}`;
  }
}

/** Deep link the installed app registers on both platforms (vybe://open). */
export function appDeepLink(type: ShareType, id: string): string {
  return `vybe://open?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}
