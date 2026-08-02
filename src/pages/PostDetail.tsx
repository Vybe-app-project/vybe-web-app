import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  compactNumber,
  displayName,
  timeAgo,
  useInfiniteScroll,
  type Post,
  type PostComment,
} from '../lib/hooks';
import {
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  Spinner,
  useToast,
} from './ui';
import { Heart, Send, Trash } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';

type CommentsPage = {
  comments: PostComment[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

function CommentRow({
  comment,
  postId,
  postAuthorId,
}: {
  comment: PostComment;
  postId: string;
  postAuthorId?: string;
}) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);

  const [liked, setLiked] = useState(
    !!me && (comment.likes || []).some((id) => String(id) === String(me._id)),
  );
  const [likeCount, setLikeCount] = useState(comment.likes?.length || 0);

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/posts/comment/like', {
        postId,
        commentId: comment._id,
      });
      return data as { likes?: number; isLiked?: boolean };
    },
    onMutate: () => {
      const prev = { liked, likeCount };
      setLiked(!liked);
      setLikeCount((n) => n + (liked ? -1 : 1));
      return prev;
    },
    onError: (e, _v, ctx) => {
      if (ctx) {
        setLiked(ctx.liked);
        setLikeCount(ctx.likeCount);
      }
      toast.error(errMsg(e, 'Could not like this comment.'));
    },
    onSuccess: (data) => {
      if (typeof data.isLiked === 'boolean') setLiked(data.isLiked);
      if (typeof data.likes === 'number') setLikeCount(data.likes);
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/posts/comment/${comment._id}`, { data: { postId } });
    },
    onSuccess: () => {
      toast.success('Comment deleted');
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      qc.invalidateQueries({ queryKey: ['post', postId] });
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not delete this comment.'));
      setConfirm(false);
    },
  });

  const author = comment.user;
  const canDelete =
    !!me &&
    (String(author?._id) === String(me._id) || String(postAuthorId) === String(me._id));
  const href = !author
    ? '#'
    : me && String(author._id) === String(me._id)
      ? '/profile'
      : `/u/${author._id}`;

  return (
    <div className="flex gap-3 py-3">
      <Link to={href}>
        <Avatar src={mediaUrl(author?.avatar)} name={displayName(author)} size={32} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link to={href} className="truncate text-sm font-semibold hover:underline">
            {displayName(author)}
          </Link>
          <span className="text-xs text-[var(--color-muted)]">{timeAgo(comment.createdAt)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{comment.text}</p>
        <div className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => like.mutate()}
            disabled={like.isPending}
            aria-pressed={liked}
            className={`flex items-center gap-1 text-xs ${
              liked ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'
            }`}
          >
            <Heart className="h-3.5 w-3.5" filled={liked} />
            {compactNumber(likeCount)}
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-red-400"
            >
              <Trash className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Delete comment?"
        message="This removes the comment permanently."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

export default function PostDetail() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');

  const postQuery = useQuery({
    queryKey: ['post', postId],
    enabled: !!postId,
    queryFn: async () => {
      const { data } = await api.get(`/posts/${postId}`);
      return (data.post || data) as Post;
    },
  });

  const commentsQuery = useInfiniteQuery({
    queryKey: ['post-comments', postId],
    enabled: !!postId,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get(
        `/posts/post/${postId}/comments/all/fetch/filter`,
        { params: { page: pageParam, limit: 20 } },
      );
      return data as CommentsPage;
    },
    getNextPageParam: (last, all) => (last.hasNextPage ? all.length + 1 : undefined),
  });

  const addComment = useMutation({
    mutationFn: async (value: string) => {
      const { data } = await api.post('/posts/comment', { postId, text: value });
      return data;
    },
    onSuccess: () => {
      setText('');
      toast.success('Comment posted');
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      qc.invalidateQueries({ queryKey: ['post', postId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not post your comment.')),
  });

  const sentinelRef = useInfiniteScroll(() => {
    if (commentsQuery.hasNextPage && !commentsQuery.isFetchingNextPage)
      commentsQuery.fetchNextPage();
  }, !!commentsQuery.hasNextPage);

  const comments = commentsQuery.data?.pages.flatMap((p) => p.comments || []) ?? [];
  const total = commentsQuery.data?.pages[0]?.total ?? comments.length;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Back
        </Button>
        <Link to="/" className="text-sm text-[var(--color-muted)] hover:text-white">
          Go to feed
        </Link>
      </div>

      {postQuery.isLoading && <PostCardSkeleton />}

      {postQuery.isError && (
        <ErrorState
          title="Post unavailable"
          message={errMsg(postQuery.error, 'This post may have been deleted or is private.')}
          action={
            <Button variant="primary" onClick={() => postQuery.refetch()}>
              Try again
            </Button>
          }
        />
      )}

      {postQuery.data && (
        <PostCard
          post={postQuery.data}
          hideComposer
          invalidate={[['post', postId], ['feed']]}
        />
      )}

      {postQuery.data && (
        <Card className="p-4">
          <h2 className="text-sm font-bold">
            Comments {total > 0 && <span className="text-[var(--color-muted)]">({total})</span>}
          </h2>

          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = text.trim();
              if (!value) return;
              addComment.mutate(value);
            }}
          >
            <input
              className="input-base"
              placeholder="Add a comment…"
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={addComment.isPending}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!text.trim() || addComment.isPending}
              loading={addComment.isPending}
              aria-label="Post comment"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>

          <div className="mt-2 divide-y divide-[var(--color-line)]">
            {commentsQuery.isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3 py-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}

            {commentsQuery.isError && !commentsQuery.isLoading && (
              <ErrorState
                title="Comments failed to load"
                message={errMsg(commentsQuery.error, 'Please try again.')}
                action={
                  <Button variant="ghost" onClick={() => commentsQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            )}

            {!commentsQuery.isLoading && !commentsQuery.isError && comments.length === 0 && (
              <EmptyState
                title="No comments yet"
                message="Be the first to say something supportive."
              />
            )}

            {comments.map((comment) => (
              <CommentRow
                key={comment._id}
                comment={comment}
                postId={postId}
                postAuthorId={postQuery.data?.author?._id}
              />
            ))}
          </div>

          {commentsQuery.hasNextPage && (
            <div ref={sentinelRef} className="py-4 text-center">
              {commentsQuery.isFetchingNextPage ? (
                <Spinner />
              ) : (
                <Button variant="ghost" onClick={() => commentsQuery.fetchNextPage()}>
                  Load more comments
                </Button>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
