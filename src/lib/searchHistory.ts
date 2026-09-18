/**
 * Recent-search hygiene, mirrored on the API (controllers/searchController.js).
 *
 * The server keys history on (user, query, type), so the same term searched
 * under "All" and again under "People" came back twice, and a lone "#" typed
 * then submitted was stored as a search. The list is de-duplicated here as
 * well so an older server (or a cached response) never shows doubles.
 */

export type RecentSearchLike = { _id: string; query: string; type?: string; searchedAt?: string };

/** Strip the sigils people type before a tag or handle, then whitespace. */
export function normalizeSearchQuery(query: string): string {
  return query.replace(/^[#@\s]+/, '').trim().toLocaleLowerCase('en-US');
}

/** Too short to have meant anything: "", "#", "@", "a". */
export function isTrivialSearchQuery(query: string): boolean {
  return normalizeSearchQuery(query).length < 2;
}

/** Newest entry per normalised query; order preserved; trivial queries dropped. */
export function dedupeRecentSearches<T extends RecentSearchLike>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    if (!item || typeof item.query !== 'string' || isTrivialSearchQuery(item.query)) continue;
    const key = normalizeSearchQuery(item.query);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
