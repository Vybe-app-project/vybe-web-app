/**
 * Pure stories helpers shared by the Home tray, the Stories page and the
 * viewer. Import-light so tests/feed-logic.test.mjs can load them directly.
 */

export type StoryLike = {
  _id: string;
  createdAt?: string;
  expiresAt?: string;
  isActive?: boolean;
  hasViewed?: boolean;
  duration?: number;
  author?: { _id: string } | null;
};

export type StoryGroupLike<S extends StoryLike = StoryLike> = { author: { _id: string }; stories: S[] };

const idOf = (value: { _id: string } | string | null | undefined): string =>
  typeof value === 'string' ? value : value?._id ? String(value._id) : '';

/** The author can never "view" their own story, so their stories always count as seen. */
export function storySeen(story: StoryLike, viewerId?: string | null): boolean {
  if (viewerId && idOf(story.author) === String(viewerId)) return true;
  return story.hasViewed === true;
}

/** Where the viewer opens: the first story not yet seen, else the beginning. */
export function firstUnseenIndex(stories: StoryLike[], viewerId?: string | null): number {
  const index = stories.findIndex((story) => !storySeen(story, viewerId));
  return index < 0 ? 0 : index;
}

export function groupHasUnseen(group: StoryGroupLike, viewerId?: string | null): boolean {
  return group.stories.some((story) => !storySeen(story, viewerId));
}

/** Live stories vs. the archive: expired, or switched off by the API's sweep. */
export function isStoryExpired(story: StoryLike, now = Date.now()): boolean {
  if (story.isActive === false) return true;
  if (!story.expiresAt) return false;
  const at = new Date(story.expiresAt).getTime();
  return Number.isNaN(at) ? false : at <= now;
}

/** Pull the signed-in user's group out of the tray so it can wear the "Your story" bubble. */
export function splitOwnGroup<G extends StoryGroupLike>(groups: G[], viewerId?: string | null): { own: G | null; others: G[] } {
  if (!viewerId) return { own: null, others: groups };
  const own = groups.find((group) => idOf(group.author) === String(viewerId)) ?? null;
  return { own, others: groups.filter((group) => group !== own) };
}

export const MIN_STORY_SECONDS = 1;
export const MAX_STORY_SECONDS = 60;
export const DEFAULT_STORY_SECONDS = 15;

/** Whole seconds inside the API's 1–60 s window; anything unusable falls back to the default. */
export function clampStoryDuration(seconds: unknown, fallback = DEFAULT_STORY_SECONDS): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_STORY_SECONDS, Math.max(MIN_STORY_SECONDS, Math.round(value)));
}

/* ------------------------------------------------------------------ */
/* Text-story looks (stored as content.background/backgroundColor/…)   */
/* ------------------------------------------------------------------ */

export type StoryBackground = { id: string; label: string; backgroundColor: string; textColor: string };

export const STORY_BACKGROUNDS: StoryBackground[] = [
  { id: 'navy', label: 'Deep water', backgroundColor: '#0c2436', textColor: '#f2f7f5' },
  { id: 'mint', label: 'Mint', backgroundColor: '#036554', textColor: '#e6fff8' },
  { id: 'ember', label: 'Ember', backgroundColor: '#c94f22', textColor: '#fff4ee' },
  { id: 'sky', label: 'Sky', backgroundColor: '#1d4f8a', textColor: '#e8f3ff' },
  { id: 'lilac', label: 'Lilac', backgroundColor: '#5b3fa8', textColor: '#f4eeff' },
  { id: 'sand', label: 'Sand', backgroundColor: '#f5b841', textColor: '#2a1c00' },
  { id: 'paper', label: 'Paper', backgroundColor: '#f6f9f8', textColor: '#0b1e2b' },
];

export type StoryFont = 'default' | 'bold' | 'italic' | 'handwriting';

export const STORY_FONTS: Array<{ id: StoryFont; label: string }> = [
  { id: 'default', label: 'Clean' },
  { id: 'bold', label: 'Bold' },
  { id: 'italic', label: 'Italic' },
  { id: 'handwriting', label: 'Script' },
];

export function isStoryFont(value: unknown): value is StoryFont {
  return STORY_FONTS.some((font) => font.id === value);
}

/** Inline style for a text story's typography. */
export function storyFontStyle(font: string | undefined): Record<string, string> {
  switch (font) {
    case 'bold':
      return { fontWeight: '800', fontVariationSettings: '"wdth" 112', letterSpacing: '-0.02em' };
    case 'italic':
      return { fontStyle: 'italic', fontWeight: '500' };
    case 'handwriting':
      return { fontFamily: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive', fontWeight: '500' };
    default:
      return { fontWeight: '700' };
  }
}
