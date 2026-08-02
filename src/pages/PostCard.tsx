import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compactNumber, displayName, timeAgo, type Post } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Skeleton,
  useToast,
} from './ui';
import { Bookmark, Heart, MessageCircle, Send, Trash } from './icons';

/* ------------------------------------------------------------------ */
/* Media grid                                                          */
/* ------------------------------------------------------------------ */

export function PostMediaGrid({ post }: { post: Post }) {
  const medias = post.medias || [];
  if (!medias.length) return null;

  const count = medias.length;
  const layout =
    count === 1
      ? 'grid-cols-1'
      : count === 2
        ? 'grid-cols-2'
        : count === 3
          ? 'grid-cols-2'
          : 'grid-cols-2';

  return (
    <div className={`mt-3 grid ${layout} gap-1 overflow-hidden rounded-xl`}>
      {medias.slice(0, 4).map((m, i) => {
        const src = mediaUrl(m.url || m.key);
        const spanFirstOfThree = count === 3 && i === 0 ? 'row-span-2' : '';
        return (
          <div
            key={m._id || `${src}-${i}`}
            className={`relative bg-[var(--color-surface-2)] ${spanFirstOfThree} ${
              count === 1 ? 'max-h-[520px]' : 'aspect-square'
            }`}
          >
            {m.type === 'video' ? (
              <video
                src={src}
                poster={m.thumbnail ? mediaUrl(m.thumbnail) : undefined}
                controls
                preload="metadata"
                className="h-full w-full object-cover"
              />
            ) : (
              <img
                src={src}
                alt={post.content ? post.content.slice(0, 80) : 'Post media'}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            )}
            {i === 3 && count > 4 && (
              <div className="absolute inset-0 grid place-items-center bg-black/60 text-lg font-bold">
                +{count - 4}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Content with linked hashtags                                        */
/* ------------------------------------------------------------------ */

export function PostContent({ text }: { text?: string }) {
  if (!text) return null;
  const parts = text.split(/(#[\p{L}\p{N}_]+)/gu);
  return (
    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((part, i) =>
        part.startsWith('#') ? (
          <Link
            key={i}
            to={`/search?q=${encodeURIComponent(part)}`}
            className="text-[var(--color-brand-2)] hover:underline"
          >
            {part}
          </Link>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Post card                                                           */
/* ------------------------------------------------------------------ */

export type PostCardProps = {
  post: Post;
  /** Query keys to invalidate after a mutation. */
  invalidate?: unknown[][];
  /** Hide the inline comment box (used on the detail page). */
  hideComposer?: boolean;
  footer?: ReactNode;
};

export default function PostCard({
  post,
  invalidate = [['feed']],
  hideComposer = false,
  footer,
}: PostCardProps) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();

  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [likes, setLikes] = useState<number>(post.likes?.length || 0);
  const [liked, setLiked] = useState<boolean>(
    !!me && (post.likes || []).some((id) => String(id) === String(me._id)),
  );
  const [bookmarked, setBookmarked] = useState<boolean>(!!post.isBookmarked);
  const [commentCount, setCommentCount] = useState<number>(post.comments?.length || 0);

  const refresh = () => invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));

  const likeMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/posts/like', { postId: post._id });
      return data as { likes: number; isLiked: boolean };
    },
    onMutate: () => {
      const prev = { liked, likes };
      setLiked(!liked);
      setLikes((n) => n + (liked ? -1 : 1));
      return prev;
    },
    onError: (e, _v, ctx) => {
      if (ctx) {
        setLiked(ctx.liked);
        setLikes(ctx.likes);
      }
      toast.error(errMsg(e, 'Could not update your like.'));
    },
    onSuccess: (data) => {
      setLiked(!!data.isLiked);
      setLikes(Number(data.likes) || 0);
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: async (next: boolean) => {
      await api.post(next ? '/posts/bookmark' : '/posts/unbookmark', { postId: post._id });
      return next;
    },
    onMutate: (next) => {
      const prev = bookmarked;
      setBookmarked(next);
      return prev;
    },
    onError: (e, _v, prev) => {
      if (typeof prev === 'boolean') setBookmarked(prev);
      toast.error(errMsg(e, 'Could not update your bookmark.'));
    },
    onSuccess: (next) => {
      toast.success(next ? 'Saved to your bookmarks' : 'Removed from bookmarks');
      qc.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (text: string) => {
      const { data } = await api.post('/posts/comment', { postId: post._id, text });
      return data;
    },
    onSuccess: () => {
      setCommentText('');
      setCommentCount((n) => n + 1);
      toast.success('Comment posted');
      refresh();
      qc.invalidateQueries({ queryKey: ['post', post._id] });
      qc.invalidateQueries({ queryKey: ['post-comments', post._id] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not post your comment.')),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete('/posts/delete', { data: { postId: post._id } });
    },
    onSuccess: () => {
      toast.success('Post deleted');
      setConfirmDelete(false);
      refresh();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not delete this post.'));
      setConfirmDelete(false);
    },
  });

  const author = post.author;
  const isOwn = !!me && !!author && String(author._id) === String(me._id);
  const authorHref = !author ? '#' : isOwn ? '/profile' : `/u/${author._id}`;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Link to={authorHref} aria-label={displayName(author)}>
          <Avatar src={mediaUrl(author?.avatar)} name={displayName(author)} size={40} />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link to={authorHref} className="truncate text-sm font-semibold hover:underline">
              {displayName(author)}
            </Link>
            {author?.isVerified && <Badge variant="brand">Verified</Badge>}
            {author?.isCoach || author?.isTrainer ? <Badge>Coach</Badge> : null}
            <span className="ml-auto shrink-0 text-xs text-[var(--color-muted)]">
              {timeAgo(post.createdAt)}
            </span>
          </div>
          {author?.username && (
            <div className="truncate text-xs text-[var(--color-muted)]">@{author.username}</div>
          )}
        </div>
      </div>

      <PostContent text={post.content} />

      {!!post.hashtags?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {post.hashtags.map((tag) => (
            <Link key={tag} to={`/search?q=${encodeURIComponent(`#${tag}`)}`}>
              <Badge>#{tag}</Badge>
            </Link>
          ))}
        </div>
      )}

      <PostMediaGrid post={post} />

      <div className="mt-3 flex items-center gap-1 border-t border-[var(--color-line)] pt-3">
        <button
          type="button"
          onClick={() => likeMutation.mutate()}
          disabled={likeMutation.isPending}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike post' : 'Like post'}
          className={`btn btn-ghost !px-3 ${liked ? '!text-[var(--color-accent)]' : ''}`}
        >
          <Heart className="h-4 w-4" filled={liked} />
          {compactNumber(likes)}
        </button>

        <button
          type="button"
          onClick={() => setShowComment((v) => !v)}
          className="btn btn-ghost !px-3"
          aria-label="Comments"
        >
          <MessageCircle className="h-4 w-4" />
          {compactNumber(commentCount)}
        </button>

        <Link to={`/post/${post._id}`} className="btn btn-ghost !px-3 text-xs">
          View
        </Link>

        <button
          type="button"
          onClick={() => bookmarkMutation.mutate(!bookmarked)}
          disabled={bookmarkMutation.isPending}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark post'}
          className={`btn btn-ghost !px-3 ml-auto ${
            bookmarked ? '!text-[var(--color-brand-2)]' : ''
          }`}
        >
          <Bookmark className="h-4 w-4" filled={bookmarked} />
        </button>

        {isOwn && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="btn btn-ghost !px-3 !text-red-400"
            aria-label="Delete post"
          >
            <Trash className="h-4 w-4" />
          </button>
        )}
      </div>

      {showComment && !hideComposer && (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = commentText.trim();
            if (!text) return;
            commentMutation.mutate(text);
          }}
        >
          <input
            className="input-base"
            placeholder="Write a comment…"
            value={commentText}
            maxLength={1000}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={commentMutation.isPending}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!commentText.trim() || commentMutation.isPending}
            loading={commentMutation.isPending}
            aria-label="Send comment"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      )}

      {footer}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this post?"
        message="This permanently removes the post, its likes and its comments. This cannot be undone."
        confirmLabel="Delete post"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeleton                                                    */
/* ------------------------------------------------------------------ */

export function PostCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <Skeleton className="mt-3 h-48 w-full rounded-xl" />
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-8 w-16 rounded-xl" />
        <Skeleton className="h-8 w-16 rounded-xl" />
        <Skeleton className="h-8 w-16 rounded-xl" />
      </div>
    </Card>
  );
}
