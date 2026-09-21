import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  approveComment,
  commentKeys,
  createComment,
  fetchComments,
  fetchHeldComments,
  fetchReplies,
  heldReasonLabel,
  likeCountOf,
  likedByViewer,
  moreRepliesLabel,
  setCommentHidden,
  setCommentLike,
  threadReplies,
  withReply,
  withoutComment,
  type CommentSort,
  type CommentsPage,
} from '../lib/comments';
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
  SegmentedControl,
  SkeletonRow,
  Spinner,
  cx,
  formatStat,
  prefersReducedMotion,
  usePulse,
  useToast,
  type MenuItem,
} from './ui';
import { ArrowLeft, Check, EyeOff, Flag, Heart, Send, Trash, X } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';
import { useReportModal } from './Report';

const COMMENT_SORTS = [
  { value: 'desc', label: 'Newest' },
  { value: 'asc', label: 'Oldest' },
];

/** Both mean "there is nothing to load here": 404 for absent/private, 400 for a malformed id. */
const isGone = (error: unknown) => {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 400 || status === 404;
};

const COMMENTS_ANCHOR = 'comments';

/* ------------------------------------------------------------------ */
/* Comment row                                                         */
/* ------------------------------------------------------------------ */

type RowProps = {
  comment: PostComment;
  postId: string;
  postAuthorId?: string;
  /** The viewer is the post's author: hide, unhide and approve are theirs. */
  isPostAuthor: boolean;
  /** 0 is a root comment; 1 is a reply, and a reply has no Reply of its own. */
  depth?: 0 | 1;
  onReply?: (comment: PostComment) => void;
  onReport: (userId: string, label: string) => void;
  onReportComment: (commentId: string) => void;
  onRemoved: (commentId: string) => void;
};

function CommentRow({
  comment,
  postId,
  postAuthorId,
  isPostAuthor,
  depth = 0,
  onReply,
  onReport,
  onReportComment,
  onRemoved,
}: RowProps) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const heart = usePulse();
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [liked, setLiked] = useState(() => likedByViewer(comment, me?._id));
  const [likeCount, setLikeCount] = useState(() => likeCountOf(comment));
  const [hidden, setHidden] = useState(() => comment.hiddenByAuthor === true);

  // Follow the server again when the list behind the row refetches, rather
  // than freezing at the first optimistic value.
  useEffect(() => {
    setLiked(likedByViewer(comment, me?._id));
    setLikeCount(likeCountOf(comment));
    setHidden(comment.hiddenByAuthor === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comment.likes, comment.likeCount, comment.isLiked, comment.hiddenByAuthor, me?._id]);

  const like = useMutation({
    // The end state, not a toggle: a double tap cannot land on "unliked".
    mutationFn: (next: boolean) => setCommentLike(comment._id, next),
    onMutate: (next) => {
      const prev = { liked, likeCount };
      if (next) heart.pulse();
      setLiked(next);
      setLikeCount((n) => Math.max(0, n + (next ? 1 : -1)));
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
      if (Number.isFinite(Number(data?.likeCount))) setLikeCount(Number(data.likeCount));
    },
  });

  const hide = useMutation({
    mutationFn: (next: boolean) => setCommentHidden(comment._id, next),
    onMutate: (next) => {
      const prev = hidden;
      setHidden(next);
      return prev;
    },
    onError: (e, _v, prev) => {
      if (typeof prev === 'boolean') setHidden(prev);
      toast.error(e, 'Could not change that comment.');
    },
    onSuccess: (next) => {
      // Nobody is told either way; the author's own view is the whole change.
      toast.success(next ? 'Hidden from everyone but its author' : 'Visible again');
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/posts/comment/${comment._id}`, { data: { postId } });
    },
    onSuccess: () => {
      toast.success('Comment deleted');
      setConfirm(false);
      onRemoved(comment._id);
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      qc.invalidateQueries({ queryKey: ['post', postId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (e) => {
      toast.error(e, 'Could not delete this comment.');
      setConfirm(false);
    },
  });

  /** The rest of the thread, asked for only once "View N more replies" is used. */
  const replies = useInfiniteQuery({
    queryKey: commentKeys.replies(comment._id),
    enabled: depth === 0 && expanded,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchReplies(comment._id, pageParam as number),
    getNextPageParam: (last, all) => (last.hasNextPage ? all.length + 1 : undefined),
  });

  const author = comment.user;
  const authorId = author?._id;
  const isOwn = !!me && !!authorId && String(authorId) === String(me._id);
  const canDelete = !!me && (isOwn || String(postAuthorId) === String(me._id));
  const href = !authorId ? null : isOwn ? '/profile' : `/u/${authorId}`;
  const name = displayName(author);
  const handle = author?.username ? `@${author.username}` : name;
  const held = comment.status === 'held';

  const items: MenuItem[] = [
    ...(isPostAuthor && !held
      ? ([
          {
            label: hidden ? 'Unhide comment' : 'Hide comment',
            description: hidden ? 'Everyone can see it again' : 'Only its author still sees it',
            icon: <EyeOff size={18} />,
            onSelect: () => hide.mutate(!hidden),
          },
        ] satisfies MenuItem[])
      : []),
    ...(!isOwn ? ([{ label: 'Report comment', icon: <Flag size={18} />, onSelect: () => onReportComment(comment._id), danger: true, divider: isPostAuthor && !held }] satisfies MenuItem[]) : []),
    ...(authorId && !isOwn
      ? ([{ label: `Report ${handle}`, icon: <Flag size={18} />, onSelect: () => onReport(authorId, handle), danger: true }] satisfies MenuItem[])
      : []),
    ...(canDelete
      ? ([{ label: 'Delete comment', icon: <Trash size={18} />, onSelect: () => setConfirm(true), danger: true, divider: !isOwn && !!authorId }] satisfies MenuItem[])
      : []),
  ];

  const avatar = <Avatar src={author?.avatar} name={name} size={depth === 1 ? 28 : 32} seed={authorId} />;
  const shown = depth === 0 ? (expanded ? threadReplies(comment, replies.data?.pages) : (comment.replies ?? [])) : [];
  const moreLabel = depth === 0 && !expanded ? moreRepliesLabel(comment) : null;

  return (
    <li className={cx('py-3', depth === 1 && 'py-2.5')}>
      <div className="flex gap-3">
        {href ? (
          <Link to={href} viewTransition aria-label={name} className="-m-1.5 shrink-0 self-start rounded-full p-1.5">
            {avatar}
          </Link>
        ) : (
          <span className="shrink-0">{avatar}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {href ? (
              <Link to={href} viewTransition className="t-name truncate text-text-1 hover:underline">
                {name}
              </Link>
            ) : (
              <span className="t-name truncate text-text-1">{name}</span>
            )}
            <time dateTime={comment.createdAt} className="t-meta tabular shrink-0">
              {timeAgo(comment.createdAt)}
            </time>
            {held ? (
              <Badge tone="warning" size="sm">
                {heldReasonLabel(comment)}
              </Badge>
            ) : hidden ? (
              <Badge size="sm">Hidden</Badge>
            ) : null}
          </div>
          <p className="t-body mt-0.5 whitespace-pre-wrap break-words text-text-1">{comment.text}</p>
          <div className="-mb-2 -ml-2 mt-0.5 flex flex-wrap items-center gap-0.5">
            <button
              type="button"
              onClick={() => like.mutate(!liked)}
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
              {likeCount > 0 ? (
                <span key={likeCount} className="tabular motion-count">
                  {compactNumber(likeCount)}
                </span>
              ) : null}
            </button>
            {/* Replies go one level deep (400 REPLY_DEPTH), so a reply has no
                Reply of its own: replying to one answers its parent. */}
            {depth === 0 && onReply && !held ? (
              <button
                type="button"
                onClick={() => onReply(comment)}
                aria-label={`Reply to ${name}`}
                className="pressable inline-flex h-11 items-center rounded-sm px-2 text-xs font-semibold text-text-2 hover:text-text-1"
              >
                Reply
              </button>
            ) : null}
            {items.length ? <Menu items={items} label={`Options for ${name}’s comment`} size={44} align="start" /> : null}
          </div>

          {/* One level, indented under its parent; collapsed past the two the
              list already sent. */}
          {shown.length ? (
            <ul className="mt-1 divide-y divide-line border-l border-line pl-3" aria-label={`Replies to ${name}`}>
              {shown.map((reply) => (
                <CommentRow
                  key={reply._id}
                  comment={reply}
                  postId={postId}
                  postAuthorId={postAuthorId}
                  isPostAuthor={isPostAuthor}
                  depth={1}
                  onReport={onReport}
                  onReportComment={onReportComment}
                  onRemoved={onRemoved}
                />
              ))}
            </ul>
          ) : null}

          {moreLabel ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="pressable mt-1 inline-flex h-11 items-center rounded-sm text-xs font-semibold text-text-2 hover:text-text-1"
            >
              {moreLabel}
            </button>
          ) : null}

          {expanded && replies.hasNextPage ? (
            <button
              type="button"
              onClick={() => replies.fetchNextPage()}
              disabled={replies.isFetchingNextPage}
              className="pressable mt-1 inline-flex h-11 items-center gap-2 rounded-sm text-xs font-semibold text-text-2 hover:text-text-1"
            >
              {replies.isFetchingNextPage ? <Spinner size={14} /> : null}
              More replies
            </button>
          ) : null}
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
/* Held comments: the post author's queue                              */
/* ------------------------------------------------------------------ */

function HeldComments({ postId, isPostAuthor }: { postId: string; isPostAuthor: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<PostComment | null>(null);

  const held = useQuery({
    queryKey: commentKeys.held(postId),
    enabled: isPostAuthor,
    queryFn: () => fetchHeldComments(postId),
  });

  const approve = useMutation({
    mutationFn: (commentId: string) => approveComment(commentId),
    onSuccess: () => {
      toast.success('Comment approved');
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      qc.invalidateQueries({ queryKey: ['post', postId] });
    },
    onError: (e) => toast.error(e, 'Could not approve that comment.'),
  });

  const remove = useMutation({
    mutationFn: async (comment: PostComment) => {
      await api.delete(`/posts/comment/${comment._id}`, { data: { postId } });
    },
    onSuccess: () => {
      toast.success('Comment deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
    },
    onError: (e) => {
      toast.error(e, 'Could not delete that comment.');
      setDeleting(null);
    },
  });

  const rows = held.data ?? [];
  // Nothing waiting is nothing to say: the section is absent, not empty.
  if (!isPostAuthor || held.isPending || !rows.length) return null;

  return (
    <section className="rounded-md bg-surface-2 p-3" aria-label="Comments waiting on you">
      <h3 className="t-section text-text-1">
        Waiting on you{' '}
        <Badge tone="warning" size="sm" className="tabular">
          {formatStat(rows.length)}
        </Badge>
      </h3>
      <p className="t-meta mt-0.5">Only you can see these. Approving one shows it to everyone.</p>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((comment) => (
          <li key={comment._id} className="flex items-start gap-3 py-3">
            <Avatar src={comment.user?.avatar} name={displayName(comment.user)} size={32} seed={comment.user?._id} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="t-name truncate text-text-1">{displayName(comment.user)}</span>
                <time dateTime={comment.createdAt} className="t-meta tabular">
                  {timeAgo(comment.createdAt)}
                </time>
                <Badge tone="warning" size="sm">
                  {heldReasonLabel(comment)}
                </Badge>
              </div>
              <p className="t-body mt-0.5 whitespace-pre-wrap break-words text-text-1">{comment.text}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button
                  variant="brand"
                  size="sm"
                  icon={<Check size={16} />}
                  loading={approve.isPending && approve.variables === comment._id}
                  onClick={() => approve.mutate(comment._id)}
                >
                  Approve
                </Button>
                <Button variant="secondary" size="sm" icon={<X size={16} />} onClick={() => setDeleting(comment)}>
                  Delete
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!deleting}
        destructive
        title="Delete this comment?"
        message="It is removed for everyone, and its author is not told."
        confirmLabel="Delete"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PostDetail() {
  const { postId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const composerId = useId();
  const [text, setText] = useState('');
  const [sort, setSort] = useState<CommentSort>('desc');
  /** The comment being answered. A reply always answers a root comment. */
  const [replyTo, setReplyTo] = useState<{ commentId: string; name: string } | null>(null);
  const { report, reportModal } = useReportModal();

  const postQuery = useQuery({
    queryKey: ['post', postId],
    enabled: !!postId,
    // A 400 (malformed id) can never succeed on retry any more than a 404 can.
    retry: (count, err) => !isGone(err) && count < 2,
    queryFn: async () => {
      const { data } = await api.get(`/posts/${postId}`);
      return (data.post || data) as Post;
    },
  });

  const commentsKey = commentKeys.list(postId, sort);
  const commentsQuery = useInfiniteQuery({
    queryKey: commentsKey,
    enabled: !!postId && !!postQuery.data,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchComments(postId, { page: pageParam as number, limit: 20, sort }),
    getNextPageParam: (last, all) => (last.hasNextPage ? all.length + 1 : undefined),
  });

  /** Keep the cached post's comment list in step so the card's counter moves with the header. */
  const patchPostComments = (update: (comments: PostComment[]) => PostComment[]) => {
    qc.setQueryData<Post>(['post', postId], (old) => (old ? { ...old, comments: update(old.comments || []) } : old));
  };

  const patchPages = (update: (comments: PostComment[]) => PostComment[], delta: number) => {
    qc.setQueryData<InfiniteData<CommentsPage>>(commentsKey, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              total: Math.max(0, (page.total || 0) + delta),
              comments: update(page.comments || []),
            })),
          }
        : old,
    );
  };

  const addComment = useMutation({
    // The parent rides the variables, not the closure: `replyTo` is cleared
    // the moment the write succeeds, and the cache patch still needs to know
    // which thread the row belongs under.
    mutationFn: ({ text: value, parentId }: { text: string; parentId: string | null }) =>
      createComment(postId, value, parentId),
    onSuccess: (data, { parentId: parent }) => {
      setText('');
      setReplyTo(null);
      const created = data?.comment;
      toast.success(created?.status === 'held' ? 'Comment sent for review' : parent ? 'Reply posted' : 'Comment posted');
      if (created?._id) {
        if (parent) {
          // A reply lands under its parent, in both caches, so the thread is
          // live without a refetch.
          patchPostComments((comments) => withReply(comments, parent, created));
          patchPages((comments) => withReply(comments, parent, created), 0);
        } else {
          patchPostComments((comments) => [...comments, created]);
          qc.setQueryData<InfiniteData<CommentsPage>>(commentsKey, (old) => {
            if (!old?.pages.length) return old;
            const pages = old.pages.map((p) => ({ ...p, total: (p.total || 0) + 1, comments: [...p.comments] }));
            if (sort === 'desc') pages[0].comments.unshift(created);
            else if (!pages[pages.length - 1].hasNextPage) pages[pages.length - 1].comments.push(created);
            return { ...old, pages };
          });
        }
      }
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      qc.invalidateQueries({ queryKey: ['post', postId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (e) => toast.error(e, replyTo ? 'Could not post your reply.' : 'Could not post your comment.'),
  });

  const onCommentRemoved = (commentId: string) => {
    patchPostComments((comments) => withoutComment(comments, commentId));
    patchPages((comments) => withoutComment(comments, commentId), -1);
  };

  const sentinelRef = useInfiniteScroll(() => {
    if (commentsQuery.hasNextPage && !commentsQuery.isFetchingNextPage) commentsQuery.fetchNextPage();
  }, !!commentsQuery.hasNextPage);

  const comments = commentsQuery.data?.pages.flatMap((p) => p.comments || []) ?? [];
  const first = commentsQuery.data?.pages[0];
  /** The whole visible count, replies included, when the API sends it. */
  const total = first?.totalComments ?? first?.total ?? comments.length;
  const gone = postQuery.isError && isGone(postQuery.error);
  const post = !postQuery.isError ? postQuery.data : undefined;
  const isPostAuthor = !!me && !!post?.author?._id && String(post.author._id) === String(me._id);

  // "View all N comments" links carry #comments. ScrollToTop resets on every
  // pathname change, so the anchor is honoured once the card is on the page.
  useEffect(() => {
    if (!post || location.hash !== `#${COMMENTS_ANCHOR}`) return;
    const id = window.setTimeout(() => {
      document.getElementById(COMMENTS_ANCHOR)?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [post, location.hash]);

  const focusComposer = () => {
    const el = document.getElementById(composerId);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };

  /** Reply answers a root comment in the one composer the page already has. */
  const startReply = (comment: PostComment) => {
    const handle = comment.user?.username ? `@${comment.user.username} ` : '';
    setReplyTo({ commentId: comment._id, name: displayName(comment.user) });
    setText((value) => (value.trim() ? value : handle));
    focusComposer();
  };

  const leaveAfterDelete = () => {
    qc.removeQueries({ queryKey: ['post', postId] });
    qc.removeQueries({ queryKey: ['post-comments', postId] });
    navigate('/', { replace: true });
  };

  const invalidateKeys = useMemo(() => [['post', postId], ['feed']], [postId]);

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
        {postQuery.isLoading ? <PostCardSkeleton surface="card" /> : null}

        {postQuery.isError ? (
          gone ? (
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

        {post ? (
          <PostCard
            post={post}
            surface="card"
            linkToDetail={false}
            hideComposer
            expandMedia
            onComment={focusComposer}
            onDeleted={leaveAfterDelete}
            invalidate={invalidateKeys}
          />
        ) : null}

        {post ? (
          <Card id={COMMENTS_ANCHOR} className="scroll-mt-[calc(var(--topbar-h)+1rem)] lg:scroll-mt-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="type-heading text-lg text-text-1">Comments</h2>
              {total > 0 ? (
                <Badge tone="neutral" className="tabular">
                  {formatStat(total, { compact: true })}
                </Badge>
              ) : null}
              {total > 1 ? (
                <SegmentedControl
                  aria-label="Sort comments"
                  size="sm"
                  tabs={COMMENT_SORTS}
                  value={sort}
                  onChange={(v) => setSort(v as CommentSort)}
                  className="ml-auto"
                />
              ) : null}
            </div>

            <div className="mt-4 space-y-2">
              {/* Who this is going to, and a way out of it. */}
              {replyTo ? (
                <p className="t-meta flex items-center gap-2">
                  Replying to <span className="font-semibold text-text-1">{replyTo.name}</span>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="pressable inline-flex h-8 items-center rounded-xs px-1.5 font-semibold text-brand-text"
                  >
                    Cancel
                  </button>
                </p>
              ) : null}
              <form
                className="flex items-start gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = text.trim();
                  if (!value) return;
                  addComment.mutate({ text: value, parentId: replyTo?.commentId ?? null });
                }}
              >
                <Avatar src={me?.avatar} name={displayName(me)} size="sm" className="mt-1.5 hidden shrink-0 sm:inline-flex" />
                <Input
                  id={composerId}
                  label={replyTo ? `Reply to ${replyTo.name}` : 'Add a comment'}
                  hideLabel
                  placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Add a comment…'}
                  maxLength={1000}
                  autoComplete="off"
                  enterKeyHint="send"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={addComment.isPending}
                />
                <IconButton
                  type="submit"
                  label={replyTo ? 'Post reply' : 'Post comment'}
                  variant="primary"
                  size={48}
                  disabled={!text.trim() || addComment.isPending}
                  className="shrink-0"
                >
                  {addComment.isPending ? <Spinner size={18} /> : <Send size={20} />}
                </IconButton>
              </form>
            </div>

            {/* The author's queue, above the thread it belongs to. */}
            <div className="mt-4">
              <HeldComments postId={postId} isPostAuthor={isPostAuthor} />
            </div>

            <ul className="mt-2 divide-y divide-line" aria-label="Comments" aria-busy={commentsQuery.isLoading || undefined}>
              {commentsQuery.isLoading
                ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} className="py-3" />)
                : null}

              {comments.map((comment) => (
                <CommentRow
                  key={comment._id}
                  comment={comment}
                  postId={postId}
                  postAuthorId={post.author?._id}
                  isPostAuthor={isPostAuthor}
                  onReply={startReply}
                  onReport={(userId, label) => report({ targetType: 'user', targetId: userId, targetLabel: label })}
                  onReportComment={(commentId) => report({ targetType: 'comment', targetId: commentId, targetLabel: 'comment' })}
                  onRemoved={onCommentRemoved}
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
