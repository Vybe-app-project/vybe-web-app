/**
 * Comments as their own resource (Wave C, `v2-be-comments-reactions`;
 * docs/api-contract.md, "Comments, replies and reactions").
 *
 * Four things the web has never used:
 *
 *   **Replies, one level deep.** A reply is the same create call with
 *   `parentId` — `POST /posts/comment { postId, text, parentId }` — and the
 *   list read already sends them: every top-level row carries `replyCount`
 *   and its first two replies under `replies`, oldest first. The rest come
 *   from `GET /posts/comments/:commentId/replies`. Replying to a reply
 *   answers `400 REPLY_DEPTH`, which is why the UI only offers Reply on a
 *   root comment.
 *
 *   **Idempotent likes.** `PUT` / `DELETE /posts/comments/:commentId/like`
 *   state the end state, so a double tap cannot toggle a like back off. The
 *   legacy `POST /posts/comment/like` toggle is what the page used before
 *   and is not called any more.
 *
 *   **Held comments.** The list read takes `?held=1` for the post author and
 *   answers the rows waiting on them (approval, the hidden-words filter, a
 *   restrict). `403 FORBIDDEN` for anyone else — it never confirms to a
 *   third party that a held comment exists. Approve makes one visible.
 *
 *   **Hide.** `POST` / `DELETE /posts/comments/:commentId/hide` — hidden
 *   from everyone but its own author, who is not told.
 *
 * None of these is behind a feature flag: `hiddenDetails` gates the
 * author's *post* details, not their comment moderation.
 *
 * Literal paths on purpose: scripts/audit-api-contracts.cjs and
 * tests/comments-thread-contract.test.mjs pin each one against
 * contracts/backend-routes.json.
 */
import { api } from './api';
import type { PostComment } from './hooks';

export const COMMENT_MAX_LENGTH = 1000;
/** The preview the list read sends under each parent. */
export const REPLY_PREVIEW_LIMIT = 2;
export const REPLIES_PAGE_SIZE = 10;

export type CommentSort = 'desc' | 'asc';

/** `GET /posts/post/:postId/comments/all/fetch/filter` (and `?held=1`). */
export type CommentsPage = {
  comments: PostComment[];
  total: number;
  /** The viewer's whole visible count including replies. */
  totalComments?: number;
  page: number;
  hasNextPage: boolean;
  contract?: 'thread';
};

export type RepliesPage = {
  comments: PostComment[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

export const commentKeys = {
  list: (postId: string, sort: CommentSort) => ['post-comments', postId, sort] as const,
  held: (postId: string) => ['post-comments', postId, 'held'] as const,
  replies: (commentId: string) => ['comment-replies', commentId] as const,
};

/* ------------------------------------------------------------------ reads */

export async function fetchComments(
  postId: string,
  { page, limit = 20, sort }: { page: number; limit?: number; sort: CommentSort },
): Promise<CommentsPage> {
  const { data } = await api.get<CommentsPage>(`/posts/post/${postId}/comments/all/fetch/filter`, {
    params: { page, limit, sort },
  });
  return data;
}

/**
 * The rows waiting on the post's author. `403` for anyone else, which is
 * read as "no queue" rather than an error: a viewer who is not the author
 * has no business seeing the section at all.
 */
export async function fetchHeldComments(postId: string): Promise<PostComment[]> {
  try {
    const { data } = await api.get<CommentsPage>(`/posts/post/${postId}/comments/all/fetch/filter`, {
      params: { page: 1, limit: 20, held: 1 },
    });
    return data.comments ?? [];
  } catch (e) {
    const status = (e as { response?: { status?: number } } | null)?.response?.status;
    if (status === 403 || status === 404) return [];
    throw e;
  }
}

/** `GET /posts/comments/:commentId/replies` — oldest first, ten a page. */
export async function fetchReplies(commentId: string, page: number, limit = REPLIES_PAGE_SIZE): Promise<RepliesPage> {
  const { data } = await api.get<RepliesPage>(`/posts/comments/${commentId}/replies`, { params: { page, limit } });
  return data;
}

/* ------------------------------------------------------------------ writes */

export type CreatedComment = { comment?: PostComment; totalComments?: number; replayed?: true };

/**
 * One create call for a comment and for a reply: `parentId` is the only
 * difference, and it is the root comment's id — never another reply's.
 */
export async function createComment(postId: string, text: string, parentId?: string | null): Promise<CreatedComment> {
  const { data } = await api.post<CreatedComment>('/posts/comment', {
    postId,
    text,
    ...(parentId ? { parentId } : {}),
  });
  return data;
}

export type CommentLikeResult = { likes: number; likeCount: number; isLiked: boolean };

/** `PUT` / `DELETE /posts/comments/:commentId/like` — the end state, not a toggle. */
export async function setCommentLike(commentId: string, liked: boolean): Promise<CommentLikeResult> {
  const { data } = liked
    ? await api.put<CommentLikeResult>(`/posts/comments/${commentId}/like`)
    : await api.delete<CommentLikeResult>(`/posts/comments/${commentId}/like`);
  return data;
}

/** `POST /posts/comments/:commentId/approve` — a held comment becomes visible. Post author only. */
export async function approveComment(commentId: string): Promise<PostComment | null> {
  const { data } = await api.post<{ comment?: PostComment; approved?: boolean }>(`/posts/comments/${commentId}/approve`);
  return data.comment ?? null;
}

/** `POST` / `DELETE /posts/comments/:commentId/hide`. Post author only; nobody is told. */
export async function setCommentHidden(commentId: string, hidden: boolean): Promise<boolean> {
  const { data } = hidden
    ? await api.post<{ hiddenByAuthor?: boolean }>(`/posts/comments/${commentId}/hide`)
    : await api.delete<{ hiddenByAuthor?: boolean }>(`/posts/comments/${commentId}/hide`);
  return data.hiddenByAuthor === true;
}

/* ------------------------------------------------------------------ pure helpers */

/** Whether the viewer has liked a row, from either shape the API may send. */
export function likedByViewer(comment: PostComment, viewerId: string | undefined): boolean {
  if (typeof comment.isLiked === 'boolean') return comment.isLiked;
  if (!viewerId) return false;
  return (comment.likes ?? []).some((id) => String(id) === String(viewerId));
}

/** The like count, preferring the server's total over the capped id array. */
export function likeCountOf(comment: PostComment): number {
  if (typeof comment.likeCount === 'number') return comment.likeCount;
  return comment.likes?.length ?? 0;
}

/** A reply may not be replied to (`400 REPLY_DEPTH`), so Reply is a root-only action. */
export const isReply = (comment: PostComment): boolean => !!comment.parentId;

/**
 * "View 5 replies" / "View 1 reply", or null when the preview is the whole
 * thread. The preview is capped at two, so `replyCount` is the only honest
 * source for how many there are.
 */
export function moreRepliesLabel(comment: PostComment): string | null {
  const shown = comment.replies?.length ?? 0;
  const total = typeof comment.replyCount === 'number' ? comment.replyCount : shown;
  const hidden = total - shown;
  if (hidden <= 0) return null;
  return hidden === 1 ? 'View 1 more reply' : `View ${hidden} more replies`;
}

/** The whole thread, once expanded: the preview first, then the pages, de-duplicated. */
export function threadReplies(comment: PostComment, pages: RepliesPage[] | undefined): PostComment[] {
  const seen = new Set<string>();
  const out: PostComment[] = [];
  for (const row of [...(comment.replies ?? []), ...(pages ?? []).flatMap((page) => page.comments ?? [])]) {
    const id = String(row._id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/** Why a row is held, in words its author or the post's author can act on. */
export const HELD_REASON: Readonly<Record<string, string>> = Object.freeze({
  approval: 'Waiting on you',
  hidden_words: 'Matched a hidden word',
  restrict: 'From someone you restricted',
  filter: 'Held by the filter',
});

export function heldReasonLabel(comment: PostComment): string {
  return HELD_REASON[comment.heldBy ?? ''] ?? 'Waiting on you';
}

/**
 * Add a created reply to its parent inside a page of comments, and move the
 * parent's count with it, so the thread is live without a refetch. Pure, so
 * the cache update is testable.
 */
export function withReply(comments: PostComment[], parentId: string, reply: PostComment): PostComment[] {
  return comments.map((comment) => {
    if (String(comment._id) !== String(parentId)) return comment;
    const replies = comment.replies ?? [];
    if (replies.some((row) => String(row._id) === String(reply._id))) return comment;
    return {
      ...comment,
      replies: [...replies, reply],
      replyCount: (typeof comment.replyCount === 'number' ? comment.replyCount : replies.length) + 1,
    };
  });
}

/** Drop a deleted row, whether it is a top-level comment or one of its replies. */
export function withoutComment(comments: PostComment[], commentId: string): PostComment[] {
  return comments
    .filter((comment) => String(comment._id) !== String(commentId))
    .map((comment) => {
      const replies = comment.replies ?? [];
      if (!replies.some((row) => String(row._id) === String(commentId))) return comment;
      return {
        ...comment,
        replies: replies.filter((row) => String(row._id) !== String(commentId)),
        replyCount: Math.max(0, (typeof comment.replyCount === 'number' ? comment.replyCount : replies.length) - 1),
      };
    });
}
