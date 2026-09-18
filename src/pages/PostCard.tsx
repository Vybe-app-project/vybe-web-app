import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  compactNumber,
  displayName,
  timeAgo,
  type Post,
  type PostMedia,
  type PublicUser,
} from '../lib/hooks';
import {
  Avatar,
  Badge,
  Card,
  ConfirmDialog,
  IconButton,
  Input,
  Menu,
  SkeletonCard,
  cx,
  usePulse,
  useToast,
  type MenuItem,
} from './ui';
import {
  BadgeCheck,
  Bookmark,
  EyeOff,
  Flag,
  Heart,
  Link as LinkIcon,
  MessageCircle,
  Send,
  ShareUp,
  Shield,
  Trash,
} from './icons';
import { useReportModal } from './Report';

/* ------------------------------------------------------------------ */
/* Hidden authors (client-side mute)                                   */
/*                                                                     */
/* The API has block/unblock but no "mute". Muting is a softer, local  */
/* choice: posts from the author stop appearing on this device and     */
/* the toast offers Undo. Blocking uses the real endpoint and also     */
/* hides locally so the feed reacts before the refetch lands.          */
/* ------------------------------------------------------------------ */

type HiddenAuthorsState = {
  /** authorId → display name (for Settings/undo copy). */
  ids: Record<string, string>;
  hide: (id: string, name: string) => void;
  unhide: (id: string) => void;
};

export const useHiddenAuthors = create<HiddenAuthorsState>()(
  persist(
    (set) => ({
      ids: {},
      hide: (id, name) => set((s) => ({ ids: { ...s.ids, [id]: name } })),
      unhide: (id) =>
        set((s) => {
          const next = { ...s.ids };
          delete next[id];
          return { ids: next };
        }),
    }),
    { name: 'vybe.hiddenAuthors' },
  ),
);

/** Filter helper for lists: drops posts whose author is muted on this device. */
export function isAuthorHidden(ids: Record<string, string>, post: Post): boolean {
  const id = post.author?._id;
  return !!id && id in ids;
}

/* ------------------------------------------------------------------ */
/* Share / copy                                                        */
/* ------------------------------------------------------------------ */

export function postUrl(postId: string): string {
  return `${window.location.origin}/p/${postId}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Web Share where available, otherwise copy the canonical link. */
export async function sharePost(post: Post, toast: ReturnType<typeof useToast>): Promise<void> {
  const url = postUrl(post._id);
  const data: ShareData = {
    title: `${displayName(post.author)} on Vybe`,
    text: post.content ? post.content.slice(0, 140) : undefined,
    url,
  };
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data))) {
    try {
      await nav.share(data);
      return;
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      // fall through to copy
    }
  }
  if (await copyText(url)) toast.success('Link copied');
  else toast.error('Couldn’t copy the link. Open the post and copy it from the address bar.');
}

/* ------------------------------------------------------------------ */
/* Media grid                                                          */
/* ------------------------------------------------------------------ */

function singleRatio(m: PostMedia): string | undefined {
  if (m.width && m.height) {
    const r = Math.min(Math.max(m.width / m.height, 0.8), 1.91);
    return String(r);
  }
  return undefined;
}

export function PostMediaGrid({ post, className }: { post: Post; className?: string }) {
  const medias = post.medias || [];
  if (!medias.length) return null;

  const count = medias.length;
  const shown = medias.slice(0, 4);

  return (
    <div
      className={cx(
        'grid gap-0.5 overflow-hidden rounded-md bg-surface-2',
        count === 1 ? 'grid-cols-1' : 'grid-cols-2',
        className,
      )}
    >
      {shown.map((m, i) => {
        const src = mediaUrl(m.url || m.key);
        const tall = count === 3 && i === 0;
        const ratio = count === 1 ? singleRatio(m) : undefined;
        const alt = post.content ? post.content.slice(0, 80) : `Photo by ${displayName(post.author)}`;
        return (
          <div
            key={m._id || `${src}-${i}`}
            className={cx(
              'relative min-w-0 bg-surface-2',
              tall && 'row-span-2 h-full',
              count > 1 && !tall && 'aspect-square',
            )}
            style={count === 1 && ratio ? { aspectRatio: ratio } : undefined}
          >
            {m.type === 'video' ? (
              <video
                src={src}
                poster={m.thumbnail ? mediaUrl(m.thumbnail) : undefined}
                controls
                playsInline
                preload="metadata"
                className="relative z-[2] h-full w-full bg-surface-3 object-cover"
              />
            ) : (
              <img
                src={src}
                alt={alt}
                loading="lazy"
                decoding="async"
                className={cx('w-full object-cover', count === 1 && !ratio ? 'h-auto max-h-[36rem]' : 'h-full')}
              />
            )}
            {i === 3 && count > 4 ? (
              <div className="type-stat absolute inset-0 grid place-items-center bg-scrim text-xl text-[var(--navy-50)]">
                +{count - 4}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Content with linked hashtags (one treatment only)                   */
/* ------------------------------------------------------------------ */

function HashtagLink({ tag, className, children }: { tag: string; className?: string; children: ReactNode }) {
  return (
    <Link
      to={`/search?q=${encodeURIComponent(`#${tag}`)}`}
      viewTransition
      className={cx('relative z-[2] rounded-xs font-semibold text-brand-text hover:underline', className)}
    >
      {children}
    </Link>
  );
}

const HASHTAG_RE = /(#[\p{L}\p{N}_]+)/gu;

/**
 * Body text with inline hashtag links. Tags stored on the post but absent
 * from the text are appended once, in the same style — never as a second
 * row of chips.
 */
export function PostContent({ text, hashtags, className }: { text?: string; hashtags?: string[]; className?: string }) {
  const body = (text || '').trim();
  const inline = new Set((body.match(HASHTAG_RE) || []).map((t) => t.slice(1).toLowerCase()));
  const extra = [...new Set((hashtags || []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))].filter(
    (t) => !inline.has(t.toLowerCase()),
  );
  if (!body && !extra.length) return null;

  const parts = body.split(HASHTAG_RE);
  return (
    <p className={cx('prose-measure whitespace-pre-wrap break-words text-base text-text-1', className)}>
      {parts.map((part, i) =>
        part.startsWith('#') ? (
          <HashtagLink key={i} tag={part.slice(1)}>
            {part}
          </HashtagLink>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
      {extra.map((t, i) => (
        <HashtagLink key={t} tag={t} className={body || i ? 'ml-1.5' : undefined}>
          #{t}
        </HashtagLink>
      ))}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Action bar button                                                   */
/* ------------------------------------------------------------------ */

function ActionButton({
  label,
  pressed,
  active,
  activeClass,
  onClick,
  disabled,
  icon,
  count,
  className,
}: {
  label: string;
  pressed?: boolean;
  active?: boolean;
  activeClass?: string;
  onClick: () => void;
  disabled?: boolean;
  icon: ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={typeof count === 'number' ? `${label} (${count})` : label}
      title={label}
      className={cx(
        'relative z-[2] inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold transition-colors dur-1',
        active ? activeClass : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
        'disabled:opacity-100',
        className,
      )}
    >
      {icon}
      {typeof count === 'number' ? (
        <span key={count} className="tabular motion-count min-w-[1ch]">
          {compactNumber(count)}
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Post card                                                           */
/* ------------------------------------------------------------------ */

export type PostCardProps = {
  post: Post;
  /** Query keys to invalidate after a mutation. */
  invalidate?: unknown[][];
  /** Hide the inline comment box (the detail page has its own composer). */
  hideComposer?: boolean;
  /** Make the card body a link to the post. Off on the detail page. */
  linkToDetail?: boolean;
  /** Called when the comment action is used and the inline box is hidden. */
  onComment?: () => void;
  footer?: ReactNode;
};

function authorHandle(author?: PublicUser | null): string {
  return author?.username ? `@${author.username}` : displayName(author);
}

export default function PostCard({
  post,
  invalidate = [['feed']],
  hideComposer = false,
  linkToDetail = true,
  onComment,
  footer,
}: PostCardProps) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const commentInputId = useId();
  const heart = usePulse();
  const save = usePulse();
  const { report, reportModal } = useReportModal();
  const hideAuthor = useHiddenAuthors((s) => s.hide);
  const unhideAuthor = useHiddenAuthors((s) => s.unhide);

  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

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
      toast.error(e, 'Could not update your like.');
    },
    onSuccess: (data) => {
      if (typeof data?.isLiked === 'boolean') setLiked(data.isLiked);
      if (Number.isFinite(Number(data?.likes))) setLikes(Number(data.likes));
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
      toast.error(e, 'Could not update your saved posts.');
    },
    onSuccess: (next) => {
      toast.success(next ? 'Saved' : 'Removed from saved');
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
    onError: (e) => toast.error(e, 'Could not post your comment.'),
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
      toast.error(e, 'Could not delete this post.');
      setConfirmDelete(false);
    },
  });

  const author = post.author;
  const authorId = author?._id;
  const isOwn = !!me && !!authorId && String(authorId) === String(me._id);
  const authorHref = !authorId ? null : isOwn ? '/profile' : `/u/${authorId}`;
  const name = displayName(author);
  const handle = authorHandle(author);

  const blockMutation = useMutation({
    mutationFn: async () => {
      await api.post('/users/block', { userId: authorId });
    },
    onSuccess: () => {
      if (authorId) hideAuthor(authorId, name);
      setConfirmBlock(false);
      toast.success(`Blocked ${name}`);
      refresh();
      if (authorId) qc.invalidateQueries({ queryKey: ['user', authorId] });
    },
    onError: (e) => {
      setConfirmBlock(false);
      toast.error(e, `Could not block ${name}.`);
    },
  });

  const toggleLike = () => {
    if (!liked) heart.pulse();
    likeMutation.mutate();
  };
  const toggleSave = () => {
    if (!bookmarked) save.pulse();
    bookmarkMutation.mutate(!bookmarked);
  };
  const comment = () => {
    if (hideComposer) {
      onComment?.();
      return;
    }
    setShowComment((v) => !v);
  };

  const mute = () => {
    if (!authorId) return;
    hideAuthor(authorId, name);
    toast.info(`Muted ${name}. Their posts are hidden on this device.`, {
      action: { label: 'Undo', onClick: () => unhideAuthor(authorId) },
      duration: 6000,
    });
  };

  const menuItems: MenuItem[] = [
    { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void sharePost(post, toast) },
    {
      label: 'Copy link',
      icon: <LinkIcon size={18} />,
      onSelect: () =>
        void copyText(postUrl(post._id)).then((ok) =>
          ok ? toast.success('Link copied') : toast.error('Couldn’t copy the link.'),
        ),
    },
    ...(linkToDetail
      ? [{ label: 'Open post', icon: <MessageCircle size={18} />, to: `/p/${post._id}` } satisfies MenuItem]
      : []),
    ...(authorId && !isOwn
      ? ([
          {
            label: `Mute ${handle}`,
            description: 'Hide their posts on this device',
            icon: <EyeOff size={18} />,
            onSelect: mute,
            divider: true,
          },
          {
            label: `Block ${handle}`,
            description: 'They can’t see or contact you',
            icon: <Shield size={18} />,
            onSelect: () => setConfirmBlock(true),
            danger: true,
          },
          {
            label: 'Report post',
            icon: <Flag size={18} />,
            onSelect: () => report({ targetType: 'post', targetId: post._id, targetLabel: 'post' }),
            danger: true,
          },
        ] satisfies MenuItem[])
      : []),
    ...(isOwn
      ? ([
          {
            label: 'Delete post',
            icon: <Trash size={18} />,
            onSelect: () => setConfirmDelete(true),
            danger: true,
            divider: true,
          },
        ] satisfies MenuItem[])
      : []),
  ];

  const detailHref = `/p/${post._id}`;
  const avatarEl = <Avatar src={author?.avatar} name={name} size="md" />;
  /* Name + handle as one block: two lines ≈ 44 px, so the author link is a full-size target. */
  const identity = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-md font-semibold text-text-1">{name}</span>
        {author?.isVerified ? <BadgeCheck size={18} className="shrink-0 text-brand" aria-label="Verified" role="img" /> : null}
        {author?.isCoach || author?.isTrainer ? (
          <Badge tone="brand" size="sm">
            Coach
          </Badge>
        ) : null}
      </span>
      <span className="block truncate text-xs text-text-2">{author?.username ? `@${author.username}` : ' '}</span>
    </>
  );

  return (
    <Card
      role="article"
      aria-label={`Post by ${name}`}
      to={linkToDetail ? detailHref : undefined}
      linkLabel={linkToDetail ? `Open post by ${name}` : undefined}
      interactive={linkToDetail}
      className="overflow-hidden"
    >
      {/* header */}
      <div className="flex items-start gap-3">
        {authorHref ? (
          <Link to={authorHref} viewTransition aria-label={name} className="relative z-[2] -m-0.5 shrink-0 rounded-full p-0.5">
            {avatarEl}
          </Link>
        ) : (
          <span className="shrink-0">{avatarEl}</span>
        )}

        {authorHref ? (
          <Link
            to={authorHref}
            viewTransition
            className="relative z-[2] flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-xs [&:hover_span:first-child_span:first-child]:underline"
          >
            {identity}
          </Link>
        ) : (
          <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">{identity}</div>
        )}

        <div className="flex shrink-0 items-start gap-1">
          <time dateTime={post.createdAt} className="tabular pt-2.5 text-xs text-text-3">
            {timeAgo(post.createdAt)}
          </time>
          <div className="relative z-[2] -mr-3 -mt-1.5">
            <Menu items={menuItems} label={`More options for ${name}’s post`} />
          </div>
        </div>
      </div>

      {/* media first, then text */}
      <PostMediaGrid post={post} className="mt-3" />
      <PostContent text={post.content} hashtags={post.hashtags} className="mt-3" />

      {/* action bar */}
      <div className="-mx-1 mt-2 flex items-center gap-0.5 border-t border-line pt-2">
        <ActionButton
          label={liked ? 'Unlike' : 'Like'}
          pressed={liked}
          active={liked}
          activeClass="text-danger hover:bg-danger-soft"
          onClick={toggleLike}
          disabled={likeMutation.isPending}
          count={likes}
          icon={
            <span className={cx('inline-flex', heart.className)}>
              <Heart size={22} filled={liked} />
            </span>
          }
        />
        <ActionButton
          label={hideComposer ? 'Comment' : showComment ? 'Hide comment box' : 'Comment'}
          pressed={hideComposer ? undefined : showComment}
          onClick={comment}
          count={commentCount}
          icon={<MessageCircle size={22} />}
        />
        <ActionButton label="Share" onClick={() => void sharePost(post, toast)} icon={<ShareUp size={22} />} />
        <ActionButton
          label={bookmarked ? 'Remove from saved' : 'Save'}
          pressed={bookmarked}
          active={bookmarked}
          activeClass="text-brand-text hover:bg-brand-soft"
          onClick={toggleSave}
          disabled={bookmarkMutation.isPending}
          className="ml-auto"
          icon={
            <span className={cx('inline-flex', save.className)}>
              <Bookmark size={22} filled={bookmarked} />
            </span>
          }
        />
      </div>

      {showComment && !hideComposer ? (
        <form
          className="relative z-[2] mt-3 flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = commentText.trim();
            if (!text) return;
            commentMutation.mutate(text);
          }}
        >
          <Input
            id={commentInputId}
            label="Write a comment"
            hideLabel
            autoFocus
            placeholder="Write a comment…"
            value={commentText}
            maxLength={1000}
            autoComplete="off"
            onChange={(e) => setCommentText(e.target.value)}
            disabled={commentMutation.isPending}
          />
          <IconButton
            type="submit"
            label="Send comment"
            variant="primary"
            size={48}
            disabled={!commentText.trim() || commentMutation.isPending}
            className="shrink-0"
          >
            <Send size={20} />
          </IconButton>
        </form>
      ) : null}

      {footer ? <div className="relative z-[2]">{footer}</div> : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this post?"
        message="This permanently removes the post, its likes and its comments."
        confirmLabel="Delete post"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmBlock}
        title={`Block ${name}?`}
        message={`${name} won’t be able to see your posts, follow you or message you, and their posts disappear from your feed. You can unblock them from their profile.`}
        confirmLabel="Block"
        destructive
        loading={blockMutation.isPending}
        onConfirm={() => blockMutation.mutate()}
        onCancel={() => setConfirmBlock(false)}
      />

      {reportModal}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeleton                                                    */
/* ------------------------------------------------------------------ */

export function PostCardSkeleton({ media = true }: { media?: boolean }) {
  return <SkeletonCard media={media} />;
}
