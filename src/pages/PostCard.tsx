import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { commentTotal, likeTotal, tokenizeContent } from '../lib/feedLogic';
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
  useFocusTrap,
  useLockBody,
  usePulse,
  useToast,
  type MenuItem,
} from './ui';
import {
  BadgeCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Flag,
  Heart,
  Link as LinkIcon,
  MessageCircle,
  Send,
  ShareUp,
  Shield,
  Trash,
  Users,
  X,
} from './icons';
import { useReportModal } from './Report';
import { WorkoutSummaryCard } from './WorkoutSummaryCard';
import { hasWorkoutSummary } from '../lib/workoutSummary';
import { RecapSummaryCard, hasRecapSummary } from './RecapSummaryCard';

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
/* Media                                                               */
/* ------------------------------------------------------------------ */

function singleRatio(m: PostMedia): string | undefined {
  if (m.width && m.height) {
    const r = Math.min(Math.max(m.width / m.height, 0.8), 1.91);
    return String(r);
  }
  return undefined;
}

/**
 * Video source for a card. Safari/iOS paint a black box until play when there
 * is no poster; the `#t=0.1` media fragment makes them decode a frame instead.
 * The fragment is client-side only, so the signed URL still verifies.
 */
export function videoSrc(m: PostMedia): string {
  const src = mediaUrl(m.url || m.key);
  return m.thumbnail || !src ? src : `${src}#t=0.1`;
}

function mediaAlt(post: Post, index: number, total: number): string {
  const who = displayName(post.author);
  const caption = post.content ? post.content.slice(0, 80) : '';
  const which = total > 1 ? ` (${index + 1} of ${total})` : '';
  return caption ? `${caption}${which}` : `Photo by ${who}${which}`;
}

const GRID_PREVIEW = 4;

/**
 * Card media. The feed shows up to four tiles with a "+N" button on the last
 * one; the detail page (`expanded`) lays out every item. `onOpen` makes tiles
 * open the lightbox at that index (detail page) and always powers "+N".
 */
export function PostMediaGrid({
  post,
  className,
  expanded = false,
  onOpen,
}: {
  post: Post;
  className?: string;
  expanded?: boolean;
  onOpen?: (index: number) => void;
}) {
  const medias = post.medias || [];
  if (!medias.length) return null;

  const count = medias.length;
  const shown = expanded ? medias : medias.slice(0, GRID_PREVIEW);
  const hiddenCount = count - shown.length;

  return (
    <div
      className={cx(
        'grid gap-0.5 overflow-hidden rounded-md bg-surface-2',
        count === 1 ? 'grid-cols-1' : 'grid-cols-2',
        className,
      )}
      role={count > 1 ? 'group' : undefined}
      aria-label={count > 1 ? `${count} attachments` : undefined}
    >
      {shown.map((m, i) => {
        const src = mediaUrl(m.url || m.key);
        const tall = count === 3 && i === 0;
        const ratio = count === 1 ? singleRatio(m) : undefined;
        const alt = mediaAlt(post, i, count);
        const isOverflowTile = !expanded && i === shown.length - 1 && hiddenCount > 0;
        const clickable = expanded && !!onOpen && m.type !== 'video';

        const media =
          m.type === 'video' ? (
            <video
              src={videoSrc(m)}
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
          );

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
            {clickable ? (
              <button
                type="button"
                onClick={() => onOpen?.(i)}
                aria-label={`Open photo ${i + 1} of ${count}`}
                className="relative z-[2] block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus"
              >
                {media}
              </button>
            ) : (
              media
            )}
            {isOverflowTile ? (
              onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(GRID_PREVIEW)}
                  aria-label={`Show all ${count} attachments`}
                  className="type-stat absolute inset-0 z-[2] grid place-items-center bg-scrim text-xl text-[var(--navy-50)] transition-colors dur-1 hover:bg-[rgba(11,30,43,0.7)] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus"
                >
                  +{hiddenCount}
                </button>
              ) : (
                <div className="type-stat absolute inset-0 grid place-items-center bg-scrim text-xl text-[var(--navy-50)]" aria-hidden="true">
                  +{hiddenCount}
                </div>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Full-screen viewer for a post's attachments: previous/next, arrow keys,
 * swipe, Escape, counter and dots. Focus is trapped and restored.
 */
export function MediaLightbox({
  post,
  index,
  onClose,
  onChange,
}: {
  post: Post;
  /** Current attachment, or null when closed. */
  index: number | null;
  onClose: () => void;
  onChange: (index: number) => void;
}) {
  const medias = post.medias || [];
  const open = index !== null && medias.length > 0;
  const panelRef = useRef<HTMLDivElement>(null);
  const count = medias.length;
  const current = open ? Math.min(Math.max(index, 0), count - 1) : 0;
  const drag = useRef<{ x: number; t: number } | null>(null);

  useLockBody(open);
  useFocusTrap(open, panelRef);

  const prev = useCallback(() => onChange(Math.max(0, current - 1)), [current, onChange]);
  const next = useCallback(() => onChange(Math.min(count - 1, current + 1)), [count, current, onChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, prev, next]);

  // Warm the neighbours so paging feels instant.
  useEffect(() => {
    if (!open) return;
    [current - 1, current + 1].forEach((i) => {
      const m = medias[i];
      if (m && m.type === 'image') {
        const img = new Image();
        img.src = mediaUrl(m.url || m.key);
      }
    });
  }, [open, current, medias]);

  if (!open || typeof document === 'undefined') return null;
  const m = medias[current];
  const label = `${m.type === 'video' ? 'Video' : 'Photo'} ${current + 1} of ${count} by ${displayName(post.author)}`;

  return createPortal(
    <div
      className="dark anim-fade-in fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(4,16,27,0.96)] text-text-1"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="safe-top safe-bottom relative flex h-full w-full flex-col outline-none"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, t: performance.now() };
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 48 && performance.now() - d.t < 600) (dx < 0 ? next : prev)();
        }}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="tabular text-sm font-semibold text-text-2" aria-live="polite">
            {current + 1} / {count}
          </span>
          <IconButton label="Close" variant="ghost" onClick={onClose} className="text-text-1">
            <X size={22} />
          </IconButton>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
          {m.type === 'video' ? (
            <video
              key={m._id || current}
              src={videoSrc(m)}
              poster={m.thumbnail ? mediaUrl(m.thumbnail) : undefined}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full rounded-md bg-black object-contain"
            />
          ) : (
            <img
              key={m._id || current}
              src={mediaUrl(m.url || m.key)}
              alt={mediaAlt(post, current, count)}
              decoding="async"
              className="max-h-full max-w-full select-none rounded-md object-contain"
              draggable={false}
            />
          )}
          {current > 0 ? (
            <IconButton
              label="Previous"
              variant="secondary"
              size={48}
              onClick={prev}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full shadow-2"
            >
              <ChevronLeft size={24} />
            </IconButton>
          ) : null}
          {current < count - 1 ? (
            <IconButton
              label="Next"
              variant="secondary"
              size={48}
              onClick={next}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full shadow-2"
            >
              <ChevronRight size={24} />
            </IconButton>
          ) : null}
        </div>

        {count > 1 ? (
          <div className="flex justify-center gap-1.5 py-3" aria-hidden="true">
            {medias.map((item, i) => (
              <span
                key={item._id || i}
                className={cx('h-1.5 rounded-full transition-all dur-2', i === current ? 'w-4 bg-text-1' : 'w-1.5 bg-line-strong')}
              />
            ))}
          </div>
        ) : null}
        {post.content ? (
          <p className="mx-auto max-w-feed px-4 pb-4 text-center text-sm text-text-2 line-clamp-2">{post.content}</p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Content with linked hashtags and URLs (one treatment only)          */
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
export const CLAMP_LINES = 6;

/**
 * Body text with inline hashtag links and clickable http(s) URLs. Tags stored
 * on the post but absent from the text are appended once, in the same style —
 * never as a second row of chips. `clamp` (feed cards) cuts the text at six
 * lines with a "See more" control; the detail page shows everything.
 */
export function PostContent({
  text,
  hashtags,
  className,
  clamp = false,
}: {
  text?: string;
  hashtags?: string[];
  className?: string;
  clamp?: boolean;
}) {
  const body = (text || '').trim();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    if (!clamp) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (expanded) return;
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [clamp, expanded, body]);

  const inline = new Set((body.match(HASHTAG_RE) || []).map((t) => t.slice(1).toLowerCase()));
  const extra = [...new Set((hashtags || []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))].filter(
    (t) => !inline.has(t.toLowerCase()),
  );
  if (!body && !extra.length) return null;

  const tokens = tokenizeContent(body);
  const clamped = clamp && !expanded;
  return (
    <div className={className}>
      <p
        ref={ref}
        className={cx('prose-measure whitespace-pre-wrap break-words text-base text-text-1', clamped && 'line-clamp-6')}
      >
        {tokens.map((t, i) =>
          t.kind === 'hashtag' ? (
            <HashtagLink key={i} tag={t.tag}>
              {t.value}
            </HashtagLink>
          ) : t.kind === 'link' ? (
            <a
              key={i}
              href={t.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={t.href}
              className="relative z-[2] break-all rounded-xs font-semibold text-brand-text underline decoration-brand-text/40 underline-offset-2 hover:decoration-brand-text"
            >
              {t.label}
            </a>
          ) : (
            <span key={i}>{t.value}</span>
          ),
        )}
        {extra.map((t, i) => (
          <HashtagLink key={t} tag={t} className={body || i ? 'ml-1.5' : undefined}>
            #{t}
          </HashtagLink>
        ))}
      </p>
      {clamp && (overflows || expanded) ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="relative z-[2] mt-1 min-h-8 rounded-xs text-sm font-semibold text-text-2 hover:text-text-1 hover:underline"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      ) : null}
    </div>
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
  /** Show every attachment and open the lightbox from any tile (detail page). */
  expandMedia?: boolean;
  /** Called when the comment action is used and the inline box is hidden. */
  onComment?: () => void;
  /** Called after the post was deleted, so a page hosting it can leave. */
  onDeleted?: () => void;
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
  expandMedia = false,
  onComment,
  onDeleted,
  footer,
}: PostCardProps) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
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
  const [lightbox, setLightbox] = useState<number | null>(null);

  const likedByMe = (p: Post) => !!me && (p.likes || []).some((id) => String(id) === String(me._id));
  const [likes, setLikes] = useState<number>(() => likeTotal(post));
  const [liked, setLiked] = useState<boolean>(() => likedByMe(post));
  const [bookmarked, setBookmarked] = useState<boolean>(!!post.isBookmarked);
  const [commentCount, setCommentCount] = useState<number>(() => commentTotal(post));
  // Comments posted from this card, echoed beneath the composer so the reply
  // is visibly part of the post instead of vanishing into a counter.
  const [freshComments, setFreshComments] = useState<{ id: string; text: string }[]>([]);

  // The counters are optimistic copies of the post; when the query behind the
  // card refetches (a comment or delete on the detail page, a like elsewhere)
  // they follow the server again instead of freezing at their first value.
  useEffect(() => {
    setLikes(likeTotal(post));
    setLiked(likedByMe(post));
    setBookmarked(!!post.isBookmarked);
    setCommentCount(commentTotal(post));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.likes, post.likeCount, post.comments, post.commentCount, post.isBookmarked, me?._id]);

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
      if (next) {
        toast.success('Saved', {
          action: { label: 'View saved', onClick: () => navigate('/profile?tab=saved') },
        });
      } else {
        toast.success('Removed from saved');
      }
      qc.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (text: string) => {
      const { data } = await api.post('/posts/comment', { postId: post._id, text });
      return data;
    },
    onSuccess: (data: { comment?: { _id?: string }; _id?: string } | undefined, text) => {
      setCommentText('');
      setCommentCount((n) => n + 1);
      setFreshComments((prev) => [...prev, { id: String(data?.comment?._id ?? data?._id ?? `${Date.now()}`), text }]);
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
      qc.invalidateQueries({ queryKey: ['bookmarks'] });
      onDeleted?.();
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
        {author?.isIdentityVerified ? <BadgeCheck size={18} className="shrink-0 text-brand" aria-label="Verified" role="img" /> : null}
        {author?.isCoach || author?.isTrainer ? (
          <Badge tone="brand" size="sm">
            Coach
          </Badge>
        ) : null}
      </span>
      <span className="block truncate text-xs text-text-2">{author?.username ? `@${author.username}` : ' '}</span>
    </>
  );
  // Screen readers read the two lines as one run ("Vybe Test User@vybetester"); a separator fixes the name.
  const identityLabel = author?.username && author.username !== name ? `${name}, @${author.username}` : name;

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
            aria-label={identityLabel}
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

      {post.community?._id ? (
        <Link
          to={`/communities?community=${encodeURIComponent(post.community._id)}`}
          viewTransition
          className="relative z-[2] mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-xs text-xs font-semibold text-brand-text underline-offset-2 hover:underline"
          aria-label={`Posted in ${post.community.name || 'a community'} — open community`}
        >
          <Users size={14} className="shrink-0" />
          <span className="truncate">in {post.community.name || 'a community'}</span>
        </Link>
      ) : null}

      {/* media first, then the workout card, then text */}
      <PostMediaGrid post={post} className="mt-3" expanded={expandMedia} onOpen={setLightbox} />
      {hasWorkoutSummary(post.workoutSummary) ? <WorkoutSummaryCard summary={post.workoutSummary} className="mt-3" /> : null}
      {hasRecapSummary(post.recapSummary) ? <RecapSummaryCard summary={post.recapSummary} className="mt-3" to={isOwn ? `/recaps/${post.recapSummary.recapId}` : null} /> : null}
      <PostContent text={post.content} hashtags={post.hashtags} className="mt-3" clamp={!expandMedia} />

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
            enterKeyHint="send"
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

      {freshComments.length > 0 ? (
        <div className="relative z-[2] mt-3 space-y-2" aria-live="polite">
          <ul className="space-y-2">
            {freshComments.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <Avatar src={me?.avatar} name={me ? displayName(me) : 'You'} size={28} />
                <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
                  <p className="text-xs font-semibold text-text-1">
                    {me ? displayName(me) : 'You'} <span className="font-normal text-text-3">· just now</span>
                  </p>
                  <p className="text-sm text-text-1 [overflow-wrap:anywhere]">{c.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link to={`${detailHref}#comments`} viewTransition className="inline-block text-xs font-semibold text-brand-text hover:underline">
            View all {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
          </Link>
        </div>
      ) : null}

      {footer ? <div className="relative z-[2]">{footer}</div> : null}

      <MediaLightbox post={post} index={lightbox} onClose={() => setLightbox(null)} onChange={setLightbox} />

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
