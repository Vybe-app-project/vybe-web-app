/**
 * People suggestions that say why (Wave F, design-first-week-and-people.md
 * §3.2 and §5.5). GET /searching/suggest sends every row with `reason` (the
 * primary signal), `reasons` (every signal, primary first), `reasonText` (a
 * sentence to show verbatim) and, on a same-gym row, `activeThisWeek` when the
 * person has a visible check-in at the shared gym this week. This module is
 * the pure part: the row type, the body reader, the chip model and the words
 * around "Not interested". tests/people-invites.test.mjs imports it directly.
 */
import type { PublicUser } from './hooks';

export const SUGGESTION_REASONS = ['invited-by', 'mutual', 'follows-you', 'same-gym', 'new-here', 'contacts'] as const;
export type SuggestionReason = (typeof SUGGESTION_REASONS)[number];

export type PeopleSuggestion = PublicUser & {
  reason?: SuggestionReason | string;
  reasons?: Array<SuggestionReason | string>;
  reasonText?: string;
  /** Present (true) only on a same-gym row with a members-visible check-in this local week. */
  activeThisWeek?: boolean;
  gymName?: string;
  gymId?: string | null;
  homeGym?: boolean;
  mutualCount?: number;
  mutualNames?: string[];
};

/** The rows of a GET /searching/suggest body; anything that is not a list of accounts reads as none. */
export function parseSuggestions(body: unknown): PeopleSuggestion[] {
  const users = (body as { users?: unknown } | null | undefined)?.users;
  if (!Array.isArray(users)) return [];
  return users.filter(
    (row): row is PeopleSuggestion => !!row && typeof row === 'object' && typeof (row as { _id?: unknown })._id === 'string',
  );
}

/* ------------------------------------------------------------------ chips */

export const INVITED_YOU = 'Invited you';
export const THERE_THIS_WEEK_SUFFIX = ' · there this week';
export const THERE_THIS_WEEK = `Trains at your gym${THERE_THIS_WEEK_SUFFIX}`;

export type ReasonChip = {
  key: 'invited-by' | 'reason' | 'active-this-week';
  text: string;
  /** The one accent on the row besides Follow (spec §3.2: the mint-outlined "Invited you"). */
  accent: boolean;
};

/**
 * The chip row under a suggestion, in order:
 *
 * 1. "Invited you" first, accented, when the row carries the invited-by signal.
 * 2. The server's `reasonText` verbatim, unless it is the invited-you line already shown.
 * 3. "Trains at your gym · there this week" when `activeThisWeek` is set and the
 *    primary text does not already end with that suffix (the live API appends
 *    it itself; an older API that omits it still gets the chip, and a current
 *    one never says it twice).
 *
 * A row with no reason yields no chips: a reason is never invented.
 */
export function reasonChips(row: Partial<PeopleSuggestion> | null | undefined): ReasonChip[] {
  if (!row || typeof row !== 'object') return [];
  const chips: ReasonChip[] = [];
  const reasons = Array.isArray(row.reasons) ? row.reasons : [];
  const invited = row.reason === 'invited-by' || reasons.includes('invited-by');
  if (invited) chips.push({ key: 'invited-by', text: INVITED_YOU, accent: true });
  const text = typeof row.reasonText === 'string' ? row.reasonText.trim() : '';
  if (text && !(invited && text === INVITED_YOU)) chips.push({ key: 'reason', text, accent: false });
  if (row.activeThisWeek === true && !text.endsWith(THERE_THIS_WEEK_SUFFIX)) {
    chips.push({ key: 'active-this-week', text: THERE_THIS_WEEK, accent: false });
  }
  return chips;
}

/* ------------------------------------------------------------------ copy */

export const FOR_YOU = 'For you';
export const WHY_THIS_SUGGESTION = 'Why this suggestion';
export const NOT_INTERESTED = 'Not interested';
export const OPEN_PROFILE = 'Open profile';
export const UNDO = 'Undo';
/** How long the Undo toast stands before POST /searching/exclude/:id is sent. */
export const UNDO_WINDOW_MS = 6000;
export const SUGGESTIONS_ERROR = 'Could not load suggestions';
export const FRIENDS_SUGGESTIONS_EMPTY_TITLE = 'Follow people from your gym or contacts';
export const FRIENDS_SUGGESTIONS_EMPTY_BODY = 'Suggestions appear here as people you may know join Vybe.';

export const dismissLabel = (name: string): string => `Not interested in ${name}; hide this suggestion`;
export const hiddenCopy = (name: string): string => `${name} hidden`;

/** Where keyboard focus goes after "Not interested" removes a row. */
export type DismissFocus = { kind: 'row'; index: number } | { kind: 'heading' } | { kind: 'main' };

/**
 * The row at `index` of `count` is about to leave the list, and with it the
 * menu trigger that had focus. Focus goes to the row that takes its place
 * (the next one, by its index before the removal), to the list heading when
 * it was the last row, or to the page's main region when the list empties
 * with it (the section unmounts into its empty state, heading included). A
 * row that is not in the list leaves focus at the heading.
 */
export function focusAfterDismiss(index: number, count: number): DismissFocus {
  if (index < 0 || index >= count) return { kind: 'heading' };
  if (count <= 1) return { kind: 'main' };
  if (index + 1 < count) return { kind: 'row', index: index + 1 };
  return { kind: 'heading' };
}
