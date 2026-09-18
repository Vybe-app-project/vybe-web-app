import { useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
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
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  PageHeader,
  SkeletonRow,
  Spinner,
  cx,
  formatStat,
  prefersReducedMotion,
  usePulse,
  useToast,
  type MenuItem,
} from './ui';
import { ArrowLeft, Flag, Heart, Send, Trash } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';
import { useReportModal } from './Report';

type CommentsPage = {
  comments: PostComment[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

/* ------------------------------------------------------------------ */
/* Comment row                                                         */
/* ------------------------------------------------------------------ */

function CommentRow({
  comment,
  postId,
  postAuthorId,
  onReport,
}: {
  comment: PostComment;
  postId: string;
  postAuthorId?: string;
  onReport: (userId: string, label: string) => void;
}) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const heart = usePulse();
  const [confirm, setConfirm] = useState(false);

  const [liked, setLiked] = useState(
    !!me && (comment.likes || []).some((id) => String(id) === String(me._id)),
  );
  const [likeCount, setLikeCount] = useState(comment.likes?.length || 0);

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/posts/comment/like', { postId, commentId: comment._id });
      return data as { likes?: number; isLiked?: boolean };
    },
    onMutate: () => {
      const prev = { liked, likeCount };
      if (!liked) heart.pulse();
      setLiked(!liked);
      setLikeCount((n) => n + (liked ? -1 : 1));
      return prev;
    },
    onError: (e, _v, ctx) => {
      if (ctx) {
        setLiked(ctx.liked);
        setLikeCount(ctx.likeCount);
      }
      toast.error(e, 'Could not like this comment.');
    },
    onSuccess: (data) => {
      if (typeof data?.isLiked === 'boolean') setLiked(data.isLiked);
      if (typeof data?.likes === 'number') setLikeCount(data.likes);
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
      toast.error(e, 'Could not delete this comment.');
      setConfirm(false);
    },
  });

  const author = comment.user;
  const authorId = author?._id;
  const isOwn = !!me && !!authorId && String(authorId) === String(me._id);
  const canDelete = !!me && (isOwn || String(postAuthorId) === String(me._id));
  const href = !authorId ? null : isOwn ? '/profile' : `/u/${authorId}`;
  const name = displayName(author);
  const handle = author?.username ? `@${author.username}` : name;

  const items: MenuItem[] = [
    ...(authorId && !isOwn
      ? ([{ label: `Report ${handle}`, icon: <Flag size={18} />, onSelect: () => onReport(authorId, handle), danger: true }] satisfies MenuItem[])
      : []),
    ...(canDelete
      ? ([{ label: 'Delete comment', icon: <Trash size={18} />, onSelect: () => setConfirm(true), danger: true, divider: !isOwn && !!authorId }] satisfies MenuItem[])
      : []),
  ];

  const avatar = <Avatar src={author?.avatar} name={name} size="sm" />;

  return (
    <li className="flex gap-3 py-3">
      {href ? (
        <Link to={href} viewTransition aria-label={name} className="-m-1.5 shrink-0 self-start rounded-full p-1.5">
          {avatar}
        </Link>
      ) : (
        <span className="shrink-0">{avatar}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          {href ? (
            <Link to={href} viewTransition className="truncate text-sm font-semibold text-text-1 hover:underline">
              {name}
            </Link>
          ) : (
            <span className="truncate text-sm font-semibold text-text-1">{name}</span>
          )}
          <time dateTime={comment.createdAt} className="tabular shrink-0 text-xs text-text-3">
            {timeAgo(comment.createdAt)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-base text-text-1">{comment.text}</p>
        <div className="-mb-2 -ml-2 mt-0.5 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => like.mutate()}
            disabled={like.isPending}
            aria-pressed={liked}
            aria-label={liked ? `Unlike comment (${likeCount})` : `Like comment (${likeCount})`}
            className={cx(
              'inline-flex h-11 min-w-11 items-center gap-1 rounded-sm px-2 text-xs font-semibold transition-colors dur-1',
              liked ? 'text-danger hover:bg-danger-soft' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
            )}
          >
            <span className={cx('inline-flex', heart.className)}>
              <Heart size={18} filled={liked} />
            </span>
            <span key={likeCount} className="tabular motion-count">
              {compactNumber(likeCount)}
            </span>
          </button>
          {items.length ? <Menu items={items} label={`Options for ${name}’s comment`} size={44} align="start" /> : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Delete this comment?"
        message="It will be removed for everyone."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PostDetail() {
  const { postId = '' } = useParams();
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const composerId = useId();
  const [text, setText] = useState('');
  const { report, reportModal } = useReportModal();

  const postQuery = useQuery({
    queryKey: ['post', postId],
    enabled: !!postId,
    retry: (count, err) => (err as { response?: { status?: number } } | null)?.response?.status !== 404 && count < 2,
    queryFn: async () => {
      const { data } = await api.get(`/posts/${postId}`);
      return (data.post || data) as Post;
    },
  });

  const commentsQuery = useInfiniteQuery({
    queryKey: ['post-comments', postId],
    enabled: !!postId && !!postQuery.data,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get(`/posts/post/${postId}/comments/all/fetch/filter`, {
        params: { page: pageParam, limit: 20 },
      });
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
    onError: (e) => toast.error(e, 'Could not post your comment.'),
  });

  const sentinelRef = useInfiniteScroll(() => {
    if (commentsQuery.hasNextPage && !commentsQuery.isFetchingNextPage) commentsQuery.fetchNextPage();
  }, !!commentsQuery.hasNextPage);

  const comments = commentsQuery.data?.pages.flatMap((p) => p.comments || []) ?? [];
  const total = commentsQuery.data?.pages[0]?.total ?? comments.length;
  const notFound = (postQuery.error as { response?: { status?: number } } | null)?.response?.status === 404;

  const focusComposer = () => {
    const el = document.getElementById(composerId);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };

  return (
    <div>
      <PageHeader
        title="Post"
        back
        actions={
          <ButtonLink to="/" variant="ghost" icon={<ArrowLeft size={18} />}>
            Back to feed
          </ButtonLink>
        }
        mobileActions={<></>}
      />

      <div className="space-y-4">
        {postQuery.isLoading ? <PostCardSkeleton /> : null}

        {postQuery.isError ? (
          notFound ? (
            <EmptyState
              variant="no-results"
              title="This post isn’t available"
              message="It may have been deleted, or its author made it private."
              action={{ label: 'Back to feed', to: '/' }}
            />
          ) : (
            <ErrorState error={postQuery.error} title="Couldn’t load this post" onRetry={() => postQuery.refetch()} />
          )
        ) : null}

        {postQuery.data ? (
          <PostCard
            post={postQuery.data}
            linkToDetail={false}
            hideComposer
            onComment={focusComposer}
            invalidate={[['post', postId], ['feed']]}
          />
        ) : null}

        {postQuery.data ? (
          <Card>
            <div className="flex items-center gap-2">
              <h2 className="type-heading text-lg text-text-1">Comments</h2>
              {total > 0 ? (
                <Badge tone="neutral" className="tabular">
                  {formatStat(total, { compact: true })}
                </Badge>
              ) : null}
            </div>

            <form
              className="mt-4 flex items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const value = text.trim();
                if (!value) return;
                addComment.mutate(value);
              }}
            >
              <Avatar src={me?.avatar} name={displayName(me)} size="sm" className="mt-1.5 hidden shrink-0 sm:inline-flex" />
              <Input
                id={composerId}
                label="Add a comment"
                hideLabel
                placeholder="Add a comment…"
                maxLength={1000}
                autoComplete="off"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={addComment.isPending}
              />
              <IconButton
                type="submit"
                label="Post comment"
                variant="primary"
                size={48}
                disabled={!text.trim() || addComment.isPending}
                className="shrink-0"
              >
                {addComment.isPending ? <Spinner size={18} /> : <Send size={20} />}
              </IconButton>
            </form>

            <ul className="mt-2 divide-y divide-line" aria-label="Comments" aria-busy={commentsQuery.isLoading || undefined}>
              {commentsQuery.isLoading
                ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} className="py-3" />)
                : null}

              {comments.map((comment) => (
                <CommentRow
                  key={comment._id}
                  comment={comment}
                  postId={postId}
                  postAuthorId={postQuery.data?.author?._id}
                  onReport={(userId, label) => report({ targetType: 'user', targetId: userId, targetLabel: label })}
                />
              ))}
            </ul>

            {commentsQuery.isError && !commentsQuery.isLoading ? (
              <ErrorState
                error={commentsQuery.error}
                title="Comments didn’t load"
                className="py-8"
                action={
                  <Button variant="secondary" onClick={() => commentsQuery.refetch()}>
                    Try again
                  </Button>
                }
              />
            ) : null}

            {!commentsQuery.isLoading && !commentsQuery.isError && comments.length === 0 ? (
              <EmptyState
                size="sm"
                title="No comments yet"
                message="Be the first — say something supportive."
                action={{ label: 'Write a comment', onClick: focusComposer, variant: 'secondary' }}
              />
            ) : null}

            {commentsQuery.hasNextPage ? (
              <div ref={sentinelRef} className="flex justify-center py-4">
                {commentsQuery.isFetchingNextPage ? (
                  <Spinner className="text-text-2" />
                ) : (
                  <Button variant="ghost" onClick={() => commentsQuery.fetchNextPage()}>
                    Load more comments
                  </Button>
                )}
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>

      {reportModal}
    </div>
  );
}
