import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { commentTotal, likeTotal, tokenizeContent } from '../lib/feedLogic';
import { communityPath } from '../lib/gyms';
import { setPostBookmark } from '../lib/favorites';
import { useHomeGym, type HomeGymState } from '../lib/homeGym';
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
  Skeleton,
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
  MapPin,
  MessageCircle,
  Minus,
  Moon,
  Play,
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
// P8c: For you's controls and the reason line. Both exist only when the feed
// passes `forYou`; every other surface renders the card it always did.
import { reasonLine } from '../lib/feedControls';
import { forYouCopy } from './ForYouControls';

/* ------------------------------------------------------------------ */
/* The viewer's gym                                                    */
/* ------------------------------------------------------------------ */

/**
 * The viewer's gym as a post needs it: an id, whether it is a community or a
 * bare OpenStreetMap place, and a name. Read from the shell's one home-gym
 * query (`useHomeGym`, the same cache the compact header on Home draws from),
 * so no card ever makes its own request for the same gym. Null until that
 * query has answered, and whenever the account has no gym.
 */
export type ViewerGym = {
  id: string;
  kind: 'community' | 'place';
  /** Empty while a community's details are still loading; callers fall back. */
  name: string;
};

type HomeGymField = {
  community?: string | { _id?: string; name?: string } | null;
  place?: { osmId?: string; name?: string } | null;
} | null;

const homeGymOf = (user: unknown): HomeGymField => {
  const field = user && typeof user === 'object' ? (user as { homeGym?: unknown }).homeGym : undefined;
  return field && typeof field === 'object' ? (field as HomeGymField) : null;
};

const communityIdOf = (home: HomeGymField): string => {
  const c = home?.community;
  if (typeof c === 'string') return c;
  return c && typeof c === 'object' && typeof c._id === 'string' ? c._id : '';
};

/** `useHomeGym`'s answer as a ViewerGym: the community when there is one, the pinned place otherwise. */
export function viewerGymOf(home: HomeGymState): ViewerGym | null {
  if (home.community?._id) return { id: String(home.community._id), kind: 'community', name: (home.community.name || '').trim() };
  if (home.source === 'place' && home.gym?.id) return { id: home.gym.id, kind: 'place', name: home.gym.name.trim() };
  return null;
}

export function useViewerGym(): ViewerGym | null {
  return viewerGymOf(useHomeGym());
}

/** Where a gym row links: the community page, or nowhere for a bare place. */
export const viewerGymHref = (gym: ViewerGym | null): string | null => (gym?.kind === 'community' ? communityPath(gym.id) : null);

/** The gym a member has set, named — or null when the data cannot name it. */
export function homeGymLabel(user: unknown, viewer: ViewerGym | null): string | null {
  const home = homeGymOf(user);
  if (!home) return null;
  const c = home.community;
  if (c && typeof c === 'object' && c.name?.trim()) return c.name.trim();
  const id = communityIdOf(home);
  if (id && viewer?.kind === 'community' && viewer.id === id && viewer.name) return viewer.name;
  if (home.place?.name?.trim()) return home.place.name.trim();
  return null;
}

/** The gym an author shares with the viewer, or null. Only ever the viewer's own gym name. */
export function sharedGymLabel(author: unknown, viewer: ViewerGym | null): string | null {
  if (!viewer || !viewer.name) return null;
  const home = homeGymOf(author);
  if (!home) return null;
  if (viewer.kind === 'community') return communityIdOf(home) === viewer.id ? viewer.name : null;
  return home.place?.osmId === viewer.id ? viewer.name : null;
}

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
 * A video in a card: the poster frame with one centred play control. The
 * browser's own controls appear only once the clip has been started, so the
 * feed reads as pictures until someone asks for a player.
 */
function FeedVideo({ media, label }: { media: PostMedia; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [started, setStarted] = useState(false);
  const start = () => {
    setStarted(true);
    void ref.current?.play().catch(() => {
      // Autoplay refused: the native controls are showing now, so a second tap plays.
    });
  };
  return (
    <span className="relative block h-full w-full">
      <video
        ref={ref}
        src={videoSrc(media)}
        poster={media.thumbnail ? mediaUrl(media.thumbnail) : undefined}
        controls={started}
        playsInline
        preload="metadata"
        onPlay={() => setStarted(true)}
        className="relative z-[2] h-full w-full bg-surface-3 object-cover"
      />
      {!started ? (
        <button
          type="button"
          onClick={start}
          aria-label={label}
          className="absolute inset-0 z-[3] grid place-items-center focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-scrim text-[var(--navy-50)] shadow-2">
            <Play size={26} filled aria-hidden="true" />
          </span>
        </button>
      ) : null}
    </span>
  );
}

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
  bleed = false,
}: {
  post: Post;
  className?: string;
  expanded?: boolean;
  onOpen?: (index: number) => void;
  /** Feed items: edge to edge below `md` (out to the viewport), square corners, the column's width above. */
  bleed?: boolean;
}) {
  const medias = post.medias || [];
  if (!medias.length) return null;

  const count = medias.length;
  const shown = expanded ? medias : medias.slice(0, GRID_PREVIEW);
  const hiddenCount = count - shown.length;

  return (
    <div
      className={cx(
        'grid gap-0.5 overflow-hidden bg-surface-2',
        bleed ? '-mx-gutter rounded-none md:mx-0' : 'rounded-md',
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
            <FeedVideo media={m} label={`Play video${count > 1 ? ` ${i + 1} of ${count}` : ''} by ${displayName(post.author)}`} />
          ) : (
            <img
              src={src}
              alt={alt}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          );

        return (
          <div
            key={m._id || `${src}-${i}`}
            className={cx(
              'relative min-w-0 bg-surface-2',
              tall && 'row-span-2 h-full',
              count > 1 && !tall && 'aspect-square',
              // A single photo of unknown size reserves a square (Instagram's classic frame) so the feed never shifts as it decodes.
              count === 1 && !ratio && 'aspect-square',
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
  lead,
}: {
  text?: string;
  hashtags?: string[];
  className?: string;
  clamp?: boolean;
  /** Rendered at the head of the caption: the author's bold username. */
  lead?: ReactNode;
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
    // Re-measure whenever the paragraph's box changes: a viewport resize, the
    // webfont landing, or a `content-visibility: auto` item scrolling into
    // view — skipped content has no layout (0 × 0), so a mount-only measure
    // would hide "See more" on every post below the fold.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
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
        className={cx('t-body prose-measure whitespace-pre-wrap break-words text-text-1', clamped && 'line-clamp-6')}
      >
        {lead ? <>{lead} </> : null}
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
          className="t-body relative z-[2] min-h-8 rounded-xs text-text-2 hover:text-text-1 hover:underline"
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

/** Exported for tests/favorites-contract: the action row's two states render from props alone. */
export function ActionButton({
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
        'pressable relative z-[2] inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-semibold transition-colors dur-1',
        active ? activeClass : 'text-text-1 hover:text-text-2',
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

/**
 * What the ranked feed adds to a card (P8c), and only it: the ranker's
 * reasons for this post (one `.t-meta` line under the header), the two
 * controls on the menu, and the impression observer's callback ref for the
 * card's root. Following passes nothing here.
 */
export type PostCardForYou = {
  reasons?: readonly string[];
  onNotInterested?: () => void;
  onSnooze?: () => void;
  observe?: (node: HTMLElement | null) => void;
};

export type PostCardProps = {
  post: Post;
  /** For you only; see PostCardForYou. */
  forYou?: PostCardForYou;
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
  /**
   * `item` (the default: feeds, profiles, search, communities): a full-width
   * post under a hairline, media bled to the gutter on phones — nothing boxed
   * on a white page. `card` (the detail page alone): the bordered card.
   */
  surface?: 'card' | 'item';
  /** Extra classes on the root — the feed passes `cv-auto` to items below the fold. */
  className?: string;
};

function authorHandle(author?: PublicUser | null): string {
  return author?.username ? `@${author.username}` : displayName(author);
}


export default function PostCard({
  post,
  forYou,
  invalidate = [['feed']],
  hideComposer = false,
  linkToDetail = true,
  expandMedia = false,
  onComment,
  onDeleted,
  footer,
  surface = 'item',
  className,
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
    // Through lib/favorites, so both literal paths and the two shapes
    // `GET /posts/bookmarks` answers live in one module.
    mutationFn: async (next: boolean) => {
      await setPostBookmark(post._id, next);
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
  const viewerGym = useViewerGym();
  // The author's gym, only when it is the viewer's too: the one gym this client can name.
  const gymLine = sharedGymLabel(author, viewerGym);
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
    ...(forYou && authorId && !isOwn
      ? ([
          {
            label: forYouCopy.notInterested,
            description: forYouCopy.notInterestedHint,
            icon: <Minus size={18} />,
            onSelect: () => forYou.onNotInterested?.(),
            divider: true,
          },
          {
            label: forYouCopy.snooze(handle),
            description: forYouCopy.snoozeHint,
            icon: <Moon size={18} />,
            onSelect: () => forYou.onSnooze?.(),
          },
        ] satisfies MenuItem[])
      : []),
    ...(authorId && !isOwn
      ? ([
          {
            label: `Mute ${handle}`,
            description: 'Hide their posts on this device',
            icon: <EyeOff size={18} />,
            onSelect: mute,
            divider: !forYou,
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
  const item = surface === 'item';
  const hasMedia = (post.medias?.length ?? 0) > 0;
  const hasSummary = hasWorkoutSummary(post.workoutSummary) || hasRecapSummary(post.recapSummary);
  // Instagram's caption — bold username, then the words — only makes sense
  // under a picture. A post that is only words reads header → text → icon
  // row, and never repeats the name the header just gave.
  const textOnly = !hasMedia && !hasSummary;
  const avatarEl = <Avatar src={author?.avatar} name={name} size={36} seed={authorId} />;
  const username = author?.username || name;
  /* One row: bold username, badges, the shared gym, then the time — the Instagram header. */
  const identity = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
      <span className="t-name truncate text-text-1">{username}</span>
      {author?.isIdentityVerified ? <BadgeCheck size={16} className="shrink-0 text-brand" aria-label="Verified" role="img" /> : null}
      {author?.isCoach || author?.isTrainer ? (
        <Badge tone="brand" size="sm">
          Coach
        </Badge>
      ) : null}
      {gymLine ? (
        <span className="t-meta inline-flex min-w-0 items-center gap-1">
          <span aria-hidden="true">·</span>
          <MapPin size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{gymLine}</span>
        </span>
      ) : null}
      <span aria-hidden="true" className="t-meta">·</span>
      <time dateTime={post.createdAt} className="t-meta tabular">
        {timeAgo(post.createdAt)}
      </time>
    </span>
  );
  // Screen readers read the two lines as one run ("Vybe Test User@vybetester"); a separator fixes the name.
  const identityLabel = author?.username && author.username !== name ? `${name}, @${author.username}` : name;
  const usernameLead = authorHref ? (
    <Link to={authorHref} viewTransition className="t-name relative z-[2] text-text-1 hover:underline">
      {username}
    </Link>
  ) : (
    <span className="t-name text-text-1">{username}</span>
  );

  /* header row: 36 px avatar · username · gym · time · ⋯ — 56 px tall on the feed, so the avatar sits 10 px under the hairline above */
  const header = (
    <div className={cx('flex items-center gap-3', item ? 'h-14' : 'min-h-11')}>
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
          className="relative z-[2] flex min-h-11 min-w-0 flex-1 items-center rounded-xs [&:hover_span:first-child_span:first-child]:underline"
        >
          {identity}
        </Link>
      ) : (
        <div className="flex min-h-11 min-w-0 flex-1 items-center">{identity}</div>
      )}

      <div className="relative z-[2] -mr-2 shrink-0">
        <Menu items={menuItems} label={`More options for ${name}’s post`} size={40} />
      </div>
    </div>
  );

  const communityLine = post.community?._id ? (
    <Link
      to={`/communities?community=${encodeURIComponent(post.community._id)}`}
      viewTransition
      className={cx(
        't-meta relative z-[2] inline-flex max-w-full items-center gap-1.5 rounded-xs font-semibold text-brand-text underline-offset-2 hover:underline',
        item ? '-mt-2 mb-2' : 'mt-1',
      )}
      aria-label={`Posted in ${post.community.name || 'a community'} — open community`}
    >
      <Users size={14} className="shrink-0" />
      <span className="truncate">in {post.community.name || 'a community'}</span>
    </Link>
  ) : null;

  /* For you: why this post is here, one meta line under the header (P8c). Nothing when the server sent no reason it can name. */
  const why = forYou ? reasonLine(forYou.reasons) : null;
  const reasonRow = why ? (
    <p className={cx('t-meta truncate', item ? '-mt-2 mb-2' : 'mt-1')} data-testid="foryou-reason">
      <span className="sr-only">{forYouCopy.whySeeing}: </span>
      {why}
    </p>
  ) : null;

  /* media (edge to edge on phones), then a shared workout or recap, then the icon row, counts and caption */
  const media = <PostMediaGrid post={post} className={item ? undefined : 'mt-3'} expanded={expandMedia} onOpen={setLightbox} bleed={item} />;
  const summaries = (
    <>
      {hasWorkoutSummary(post.workoutSummary) ? <WorkoutSummaryCard summary={post.workoutSummary} className="mt-3" /> : null}
      {hasRecapSummary(post.recapSummary) ? <RecapSummaryCard summary={post.recapSummary} className="mt-3" to={isOwn ? `/recaps/${post.recapSummary.recapId}` : null} /> : null}
    </>
  );
  const caption = <PostContent text={post.content} hashtags={post.hashtags} className={textOnly ? (item ? undefined : 'mt-2') : 'mt-1'} clamp={!expandMedia} lead={textOnly ? undefined : usernameLead} />;

  /* icon row: like · comment · share, save on the right — 24 px glyphs in 44 px targets, the first flush with the gutter */
  const actions = (
    <>
      <div className="-mx-2 flex h-11 items-center">
        <ActionButton
          label={liked ? 'Unlike' : 'Like'}
          pressed={liked}
          active={liked}
          activeClass="text-danger"
          onClick={toggleLike}
          disabled={likeMutation.isPending}
          icon={
            <span className={cx('inline-flex', heart.className)}>
              <Heart size={24} filled={liked} />
            </span>
          }
        />
        <ActionButton
          label={hideComposer ? 'Comment' : showComment ? 'Hide comment box' : 'Comment'}
          pressed={hideComposer ? undefined : showComment}
          onClick={comment}
          icon={<MessageCircle size={24} />}
        />
        <ActionButton label="Share" onClick={() => void sharePost(post, toast)} icon={<ShareUp size={24} />} />
        <ActionButton
          label={bookmarked ? 'Remove from saved' : 'Save'}
          pressed={bookmarked}
          active={bookmarked}
          activeClass="text-text-1"
          onClick={toggleSave}
          disabled={bookmarkMutation.isPending}
          className="ml-auto"
          icon={
            <span className={cx('inline-flex', save.className)}>
              <Bookmark size={24} filled={bookmarked} />
            </span>
          }
        />
      </div>

      {likes > 0 ? (
        <p className="t-name tabular text-text-1" aria-live="polite">
          <span key={likes} className="motion-count inline-block">
            {compactNumber(likes)}
          </span>{' '}
          {likes === 1 ? 'like' : 'likes'}
        </p>
      ) : null}
    </>
  );

  const body = (
    <>
      {header}
      {reasonRow}
      {communityLine}

      {textOnly ? (
        <>
          {caption}
          {actions}
        </>
      ) : (
        <>
          {media}
          {summaries}
          {actions}
          {caption}
        </>
      )}

      {linkToDetail && commentCount > 0 && freshComments.length === 0 ? (
        <Link to={`${detailHref}#comments`} viewTransition className="t-body relative z-[2] mt-1 inline-block text-text-2 hover:underline">
          View all {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
        </Link>
      ) : null}

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
    </>
  );

  if (item) {
    return (
      <article ref={forYou?.observe} aria-label={`Post by ${name}`} className={cx('feed-rule relative pb-3', className)}>
        {linkToDetail ? (
          <Link
            to={detailHref}
            viewTransition
            aria-label={`Open post by ${name}`}
            className="absolute inset-0 z-[1] rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          />
        ) : null}
        {body}
      </article>
    );
  }

  return (
    <Card
      role="article"
      aria-label={`Post by ${name}`}
      to={linkToDetail ? detailHref : undefined}
      linkLabel={linkToDetail ? `Open post by ${name}` : undefined}
      interactive={linkToDetail}
      className={cx('overflow-hidden', className)}
    >
      {body}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeleton                                                    */
/* ------------------------------------------------------------------ */

/**
 * The feed's loading rows, in `PostCard`'s exact `item` geometry: the 56 px
 * header, a square bled to the gutter (or three lines of text), the 44 px icon
 * row, the likes line and two caption lines, under the same hairline — so the
 * swap to content moves nothing. `card` keeps the boxed skeleton for the
 * detail page.
 */
export function PostCardSkeleton({ media = true, surface = 'item', className }: { media?: boolean; surface?: 'item' | 'card'; className?: string }) {
  if (surface === 'card') return <SkeletonCard media={media} className={className} />;
  return (
    <div className={cx('feed-rule pb-3', className)} aria-hidden="true">
      <div className="flex h-14 items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="ml-auto h-5 w-5 rounded-full" />
      </div>
      {media ? (
        <Skeleton className="-mx-gutter aspect-square rounded-none md:mx-0" />
      ) : (
        <div className="space-y-2 py-0.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      )}
      <div className="flex h-11 items-center gap-5 px-0.5">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="ml-auto h-6 w-6 rounded-full" />
      </div>
      <Skeleton className="h-3.5 w-16" />
      {media ? (
        <div className="mt-2 space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ) : null}
    </div>
  );
}
