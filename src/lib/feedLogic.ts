/**
 * Pure feed helpers, kept import-light so tests/feed-logic.test.mjs can load
 * them through tests/ts-loader.mjs without a bundler.
 */

export type FeedPageLike = {
  posts?: Array<{ _id: string }>;
  hasNextPage?: boolean;
  page?: number | null;
  /** `<createdAt ISO>_<post id>` of the last post on the page (API ≥ fix8). */
  nextCursor?: string | null;
};

/** A cursor string, or a 1-based page number for API builds without cursors. */
export type FeedPageParam = string | number;

export const FEED_PAGE_SIZE = 10;

/** Query params for one feed page in either paging mode. */
export function feedPageParams(pageParam: FeedPageParam, limit = FEED_PAGE_SIZE): Record<string, string | number> {
  return typeof pageParam === 'string' ? { before: pageParam, limit } : { page: pageParam, limit };
}

/**
 * Prefer the API's keyset cursor: offset pages shift by one whenever someone
 * publishes mid-scroll, which repeated the last post of the previous page.
 * Falls back to page numbers when the API did not send a cursor.
 */
export function nextFeedPageParam(last: FeedPageLike | undefined, loadedPages: number): FeedPageParam | undefined {
  if (!last?.hasNextPage) return undefined;
  if (typeof last.nextCursor === 'string' && last.nextCursor) return last.nextCursor;
  const page = typeof last.page === 'number' && last.page > 0 ? last.page : loadedPages;
  return page + 1;
}

/** Drops later duplicates so a shifted page can never render a post twice (or duplicate React keys). */
export function dedupeById<T extends { _id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = String(item._id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Post body tokens: hashtags and http(s) links                        */
/* ------------------------------------------------------------------ */

export type ContentToken =
  | { kind: 'text'; value: string }
  | { kind: 'hashtag'; value: string; tag: string }
  | { kind: 'link'; value: string; href: string; label: string };

const TOKEN_RE = /(https?:\/\/[^\s<>"'`]+|#[\p{L}\p{N}_]+)/gu;
// Punctuation that ends a sentence is not part of the URL that precedes it.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»”’]+$/u;

export const LINK_LABEL_MAX = 40;

/** Short, readable label for a URL: no scheme, no `www.`, ellipsised. */
export function linkLabel(href: string, max = LINK_LABEL_MAX): string {
  let label = href.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  try {
    label = decodeURI(label);
  } catch {
    // keep the raw form
  }
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function tokenizeContent(text: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  const push = (t: ContentToken) => {
    const last = tokens[tokens.length - 1];
    if (t.kind === 'text' && last?.kind === 'text') last.value += t.value;
    else if (t.kind !== 'text' || t.value) tokens.push(t);
  };
  for (const part of text.split(TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('#')) {
      push({ kind: 'hashtag', value: part, tag: part.slice(1) });
    } else if (/^https?:\/\//i.test(part)) {
      const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? '';
      const href = trailing ? part.slice(0, -trailing.length) : part;
      push({ kind: 'link', value: href, href, label: linkLabel(href) });
      if (trailing) push({ kind: 'text', value: trailing });
    } else {
      push({ kind: 'text', value: part });
    }
  }
  return tokens;
}

/**
 * Counts on a card come from the server's totals when it sends them
 * (Wave A: `totalComments`, `likeCount`; older payloads: `commentCount`) and
 * only then from the arrays, which the API caps (comments preview
 * POST_COMMENT_PREVIEW_LIMIT, 20 today and 2 once the web is ready), so a
 * busy post never reads "20 comments" or "2 comments".
 */
export function commentTotal(post: { comments?: unknown[] | null; totalComments?: number | null; commentCount?: number | null }): number {
  if (typeof post.totalComments === 'number') return post.totalComments;
  if (typeof post.commentCount === 'number') return post.commentCount;
  return post.comments?.length ?? 0;
}

export function likeTotal(post: { likes?: unknown[] | null; likeCount?: number | null }): number {
  if (typeof post.likeCount === 'number') return post.likeCount;
  return post.likes?.length ?? 0;
}
