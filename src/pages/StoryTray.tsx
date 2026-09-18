import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  readVideoDuration,
  uploadContentType,
  uploadPresigned,
  type PublicUser,
} from '../lib/hooks';
import {
  DEFAULT_STORY_SECONDS,
  MAX_STORY_SECONDS,
  MIN_STORY_SECONDS,
  STORY_BACKGROUNDS,
  STORY_FONTS,
  clampStoryDuration,
  firstUnseenIndex,
  groupHasUnseen,
  isStoryFont,
  splitOwnGroup,
  storyFontStyle,
  type StoryFont,
} from '../lib/storyLogic';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  Stepper,
  Textarea,
  cx,
  formatStat,
  useFocusTrap,
  useLockBody,
  useToast,
} from './ui';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  Image as ImageIcon,
  Pause,
  Play,
  Plus,
  Smile,
  Sparkles,
  ThumbsUp,
  Trash,
  Video as VideoIcon,
  Volume,
  VolumeOff,
  Wow,
  X,
  type IconProps,
} from './icons';

/* ------------------------------------------------------------------ types */

export type StoryAuthor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
};

export type Story = {
  _id: string;
  author: StoryAuthor;
  type: 'image' | 'video' | 'text' | 'poll' | 'question';
  duration?: number;
  privacy?: string;
  createdAt?: string;
  expiresAt?: string;
  isActive?: boolean;
  viewCount?: number;
  replyCount?: number;
  viewerReaction?: string | null;
  hasViewed?: boolean;
  hashtags?: string[];
  content?: {
    text?: string;
    media?: string;
    background?: string;
    backgroundColor?: string;
    textColor?: string;
    font?: string;
    question?: string;
  };
};

export type StoryGroup = { author: StoryAuthor; stories: Story[] };

export type Highlight = {
  _id: string;
  title: string;
  description?: string;
  coverImage?: string;
  storyCount?: number;
  stories?: Story[];
};

export type ViewerTarget = { groups: StoryGroup[]; start: number; startStory?: number };

export const authorName = (a?: StoryAuthor | PublicUser | null) => a?.fullName?.trim() || a?.username || 'Vybe user';

export const asStoryAuthor = (u?: PublicUser | null): StoryAuthor | null =>
  u ? { _id: u._id, username: u.username, fullName: u.fullName, avatar: u.avatar } : null;

export const ago = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

export const TRAY_KEY = ['stories', 'tray'] as const;

/* -------------------------------------------------------------- reactions */

/** Two faces the shared icon set does not have yet; same 24-grid, 1.8 stroke. */
function Frown({ size = '1.25em', filled, ...rest }: IconProps) {
  void filled;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 16a4.5 4.5 0 0 1 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </svg>
  );
}

function Angry({ size = '1.25em', filled, ...rest }: IconProps) {
  void filled;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 16.5a4.5 4.5 0 0 1 7 0" />
      <path d="m7.5 8.5 2.5 1.3M16.5 8.5 14 9.8" />
      <path d="M9.5 12h.01M14.5 12h.01" />
    </svg>
  );
}

/** The reactions the API accepts (`like love laugh wow sad angry`). */
export type ReactionKey = 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'angry';
export const REACTIONS: Array<{ key: ReactionKey; label: string; Icon: (p: IconProps) => ReactNode; fillWhenActive?: boolean }> = [
  { key: 'like', label: 'Like', Icon: ThumbsUp, fillWhenActive: true },
  { key: 'love', label: 'Love', Icon: Heart, fillWhenActive: true },
  { key: 'laugh', label: 'Laugh', Icon: Smile },
  { key: 'wow', label: 'Wow', Icon: Wow },
  { key: 'sad', label: 'Sad', Icon: Frown },
  { key: 'angry', label: 'Angry', Icon: Angry },
];

const reactionIcon = (key?: string | null) => REACTIONS.find((r) => r.key === key);

/* ----------------------------------------------------------------- stage */

const textStoryStyle = (story: Story) => ({
  background: story.content?.backgroundColor || 'var(--navy-800)',
  color: story.content?.textColor || 'var(--navy-50)',
  ...storyFontStyle(story.content?.font),
});

/**
 * One story's picture. Video drives its own clock: progress follows
 * `currentTime`, the story advances when the clip ends, and playback follows
 * the viewer's pause/mute state. Autoplay with sound is blocked by every
 * browser, so clips start muted with an unmute control in the header.
 */
function StoryStage({
  story,
  paused,
  muted,
  onProgress,
  onEnded,
}: {
  story: Story;
  paused: boolean;
  muted: boolean;
  onProgress: (pct: number) => void;
  onEnded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || story.type !== 'video') return;
    if (paused) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, story._id, story.type]);

  if (story.type === 'video') {
    return (
      <video
        ref={videoRef}
        key={story._id}
        src={mediaUrl(story.content?.media)}
        autoPlay
        muted={muted}
        playsInline
        controls={false}
        preload="auto"
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration && Number.isFinite(el.duration)) onProgress(Math.min(100, (el.currentTime / el.duration) * 100));
        }}
        onEnded={onEnded}
        className="h-full w-full object-contain"
      />
    );
  }
  if (story.type === 'image') {
    return <img src={mediaUrl(story.content?.media)} alt={story.content?.text || `Story by ${authorName(story.author)}`} className="h-full w-full object-contain" />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center p-8 text-center" style={textStoryStyle(story)}>
      <p className="text-xl leading-snug [text-wrap:balance]">{story.content?.text || story.content?.question}</p>
    </div>
  );
}

/* ------------------------------------------------------------- responses */

type Responder = { _id: string; username?: string; fullName?: string; avatar?: string };
type StoryResponses = {
  viewers: Array<{ user: Responder; viewedAt?: string; reaction?: string | null }>;
  reactions: Array<{ user: Responder; reaction: string; viewedAt?: string }>;
  replies: Array<{ _id: string; user: Responder; text: string; createdAt?: string }>;
};

function ResponderRow({ user, secondary, trailing }: { user: Responder; secondary?: ReactNode; trailing?: ReactNode }) {
  const name = authorName(user);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link to={`/u/${user._id}`} viewTransition aria-label={name} className="-m-1 shrink-0 rounded-full p-1">
        <Avatar src={user.avatar} name={name} size="md" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/u/${user._id}`} viewTransition className="block truncate text-sm font-semibold text-text-1 hover:underline">
          {name}
        </Link>
        {secondary ? <div className="text-xs text-text-2">{secondary}</div> : null}
      </div>
      {trailing ? <div className="shrink-0 text-text-2">{trailing}</div> : null}
    </li>
  );
}

/**
 * Who saw, reacted to and replied to one of your stories
 * (GET /story/:id/responses — author only). Sheet on phones, dialog on desktop.
 */
export function StoryResponsesModal({ storyId, open, onClose }: { storyId: string | null; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'viewers' | 'reactions' | 'replies'>('viewers');
  const q = useQuery({
    queryKey: ['stories', 'responses', storyId],
    enabled: open && !!storyId,
    queryFn: async () => {
      const { data } = await api.get(`/story/${storyId}/responses`);
      const r = (data.responses || {}) as Partial<StoryResponses>;
      return { viewers: r.viewers || [], reactions: r.reactions || [], replies: r.replies || [] } as StoryResponses;
    },
  });

  useEffect(() => {
    if (!open) setTab('viewers');
  }, [open]);

  const counts = q.data ? { viewers: q.data.viewers.length, reactions: q.data.reactions.length, replies: q.data.replies.length } : null;
  const tabs = [
    { value: 'viewers', label: 'Viewers', count: counts?.viewers },
    { value: 'reactions', label: 'Reactions', count: counts?.reactions },
    { value: 'replies', label: 'Replies', count: counts?.replies },
  ];

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Story responses" description="Only you can see who viewed, reacted or replied.">
      <div className="space-y-3">
        <SegmentedControl aria-label="Response type" fill size="sm" tabs={tabs} value={tab} onChange={(v) => setTab(v as typeof tab)} />
        {q.isLoading ? (
          <div className="space-y-3 py-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} title="Responses didn’t load" onRetry={() => q.refetch()} className="py-6" />
        ) : tab === 'viewers' ? (
          q.data!.viewers.length ? (
            <ul className="divide-y divide-line" aria-label="Viewers">
              {q.data!.viewers.map((v) => {
                const r = reactionIcon(v.reaction);
                return (
                  <ResponderRow
                    key={v.user._id}
                    user={v.user}
                    secondary={ago(v.viewedAt)}
                    trailing={r ? <r.Icon size={20} filled={!!r.fillWhenActive} aria-label={r.label} role="img" /> : null}
                  />
                );
              })}
            </ul>
          ) : (
            <EmptyState size="sm" variant="no-results" icon={<Eye size={22} />} title="No views yet" message="Views show up here as people watch." />
          )
        ) : tab === 'reactions' ? (
          q.data!.reactions.length ? (
            <ul className="divide-y divide-line" aria-label="Reactions">
              {q.data!.reactions.map((v) => {
                const r = reactionIcon(v.reaction);
                return (
                  <ResponderRow
                    key={v.user._id}
                    user={v.user}
                    secondary={r ? `${r.label} · ${ago(v.viewedAt)}` : ago(v.viewedAt)}
                    trailing={r ? <r.Icon size={22} filled={!!r.fillWhenActive} aria-label={r.label} role="img" /> : null}
                  />
                );
              })}
            </ul>
          ) : (
            <EmptyState size="sm" variant="no-results" icon={<Heart size={22} />} title="No reactions yet" message="Reactions land here the moment someone taps one." />
          )
        ) : q.data!.replies.length ? (
          <ul className="divide-y divide-line" aria-label="Replies">
            {q.data!.replies.map((r) => (
              <ResponderRow
                key={r._id}
                user={r.user}
                secondary={
                  <>
                    <p className="whitespace-pre-wrap break-words text-sm text-text-1">{r.text}</p>
                    <p className="mt-0.5">{ago(r.createdAt)}</p>
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState size="sm" variant="no-results" icon={<Smile size={22} />} title="No replies yet" message="Replies to this story are collected here." />
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- viewer */

export function StoryViewer({
  groups,
  startGroup,
  startStory,
  onClose,
}: {
  groups: StoryGroup[];
  startGroup: number;
  /** Explicit first story; defaults to the first unseen one in the group. */
  startStory?: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const panelRef = useRef<HTMLDivElement>(null);
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(() => startStory ?? firstUnseenIndex(groups[startGroup]?.stories || [], me?._id));
  const [progress, setProgress] = useState(0);
  const [holdPaused, setHoldPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [reply, setReply] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [responsesFor, setResponsesFor] = useState<string | null>(null);
  const [localReaction, setLocalReaction] = useState<Record<string, ReactionKey>>({});

  const group = groups[gi];
  const story = group?.stories?.[si];
  const paused = holdPaused || userPaused || Boolean(deleteTarget) || Boolean(responsesFor);
  const durationMs = clampStoryDuration(story?.duration, DEFAULT_STORY_SECONDS) * 1000;

  useLockBody(true);
  useFocusTrap(true, panelRef);

  const next = useCallback(() => {
    setProgress(0);
    setSi((prevSi) => {
      const stories = groups[gi]?.stories || [];
      if (prevSi + 1 < stories.length) return prevSi + 1;
      if (gi + 1 < groups.length) {
        setGi(gi + 1);
        return firstUnseenIndex(groups[gi + 1]?.stories || [], me?._id);
      }
      onClose();
      return prevSi;
    });
  }, [gi, groups, me?._id, onClose]);

  const prev = useCallback(() => {
    setProgress(0);
    setSi((prevSi) => {
      if (prevSi > 0) return prevSi - 1;
      if (gi > 0) {
        const target = gi - 1;
        setGi(target);
        return Math.max((groups[target]?.stories?.length || 1) - 1, 0);
      }
      return 0;
    });
  }, [gi, groups]);

  // Timer for pictures and text; video reports its own progress (StoryStage).
  useEffect(() => {
    if (!story || paused || story.type === 'video') return;
    const started = Date.now() - (progress / 100) * durationMs;
    const timer = window.setInterval(() => {
      const pct = Math.min(((Date.now() - started) / durationMs) * 100, 100);
      setProgress(pct);
      if (pct >= 100) {
        window.clearInterval(timer);
        next();
      }
    }, 50);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?._id, story?.type, paused, durationMs, next]);

  const markViewed = useMutation({
    mutationFn: async (storyId: string) => {
      await api.put(`/story/${storyId}/view`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TRAY_KEY }),
  });

  const viewedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!story?._id) return;
    if (viewedRef.current.has(story._id)) return;
    viewedRef.current.add(story._id);
    if (story.author?._id !== me?._id) markViewed.mutate(story._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?._id]);

  const react = useMutation({
    mutationFn: async ({ storyId, reaction }: { storyId: string; reaction: ReactionKey }) => {
      await api.post(`/story/${storyId}/reaction`, { reaction });
    },
    onMutate: ({ storyId, reaction }) => {
      const previous = localReaction[storyId];
      setLocalReaction((m) => ({ ...m, [storyId]: reaction }));
      return previous;
    },
    onError: (e, { storyId }, previous) => {
      setLocalReaction((m) => {
        const nextMap = { ...m };
        if (previous) nextMap[storyId] = previous;
        else delete nextMap[storyId];
        return nextMap;
      });
      toast.error(e, 'Could not send your reaction.');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TRAY_KEY }),
  });

  const sendReply = useMutation({
    mutationFn: async ({ storyId, text }: { storyId: string; text: string }) => {
      await api.post(`/story/${storyId}/reply`, { text });
    },
    onSuccess: () => {
      setReply('');
      toast.success('Reply sent');
    },
    onError: (e) => toast.error(e, 'Could not send your reply.'),
  });

  const removeStory = useMutation({
    mutationFn: async (storyId: string) => {
      await api.delete(`/story/${storyId}`);
    },
    onSuccess: () => {
      toast.success('Story deleted');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['stories'] });
      onClose();
    },
    onError: (e) => {
      toast.error(e, 'Could not delete the story.');
      setDeleteTarget(null);
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (deleteTarget || responsesFor) return; // the dialog on top owns the keyboard
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') onClose();
      else if (typing) return;
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') {
        e.preventDefault();
        setUserPaused((p) => !p);
      } else if (e.key.toLowerCase() === 'm' && story?.type === 'video') {
        setMuted((m) => !m);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose, deleteTarget, responsesFor, story?.type]);

  if (!group || !story) return null;
  const mine = story.author?._id === me?._id;
  const currentReaction = (localReaction[story._id] || story.viewerReaction || null) as ReactionKey | null;

  return (
    <div
      className="dark anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-bg/95 text-text-1 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Stories from ${mine ? 'you' : authorName(group.author)}`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="safe-top safe-bottom relative flex h-dvh w-full max-w-md flex-col overflow-hidden bg-surface-1 outline-none sm:h-[min(90dvh,52rem)] sm:rounded-xl sm:shadow-3"
      >
        {/* progress */}
        <div className="flex gap-1 px-3 pt-3" aria-hidden="true">
          {group.stories.map((s, i) => (
            <div key={s._id} className="h-1 flex-1 overflow-hidden rounded-full bg-line-strong">
              <div
                className="h-full bg-text-1 transition-[width] duration-100 ease-linear"
                style={{ width: i < si ? '100%' : i === si ? `${progress}%` : '0%' }}
              />
            </div>
          ))}
        </div>

        {/* header */}
        <div className="flex items-center gap-2 px-3 py-2">
          <Avatar src={group.author.avatar} name={authorName(group.author)} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-1">{mine ? 'Your story' : authorName(group.author)}</p>
            <p className="text-xs text-text-2">
              {ago(story.createdAt)}
              {group.stories.length > 1 ? ` · ${si + 1}/${group.stories.length}` : ''}
            </p>
          </div>
          {mine ? (
            <>
              <button
                type="button"
                onClick={() => setResponsesFor(story._id)}
                aria-label="View story responses"
                aria-haspopup="dialog"
                className="tabular inline-flex h-11 items-center gap-1.5 rounded-sm px-2.5 text-xs font-semibold text-text-2 transition-colors dur-1 hover:bg-surface-2 hover:text-text-1"
              >
                <Eye size={16} />
                {formatStat(story.viewCount ?? 0, { compact: true })}
                {story.replyCount ? (
                  <Badge tone="brand" size="sm" className="tabular">
                    {formatStat(story.replyCount, { compact: true })} {story.replyCount === 1 ? 'reply' : 'replies'}
                  </Badge>
                ) : null}
              </button>
              <IconButton label="Delete story" variant="ghost" onClick={() => setDeleteTarget(story._id)}>
                <Trash size={20} />
              </IconButton>
            </>
          ) : null}
          {story.type === 'video' ? (
            <IconButton label={muted ? 'Unmute' : 'Mute'} variant="ghost" onClick={() => setMuted((m) => !m)} aria-pressed={!muted}>
              {muted ? <VolumeOff size={20} /> : <Volume size={20} />}
            </IconButton>
          ) : null}
          <IconButton label={userPaused ? 'Play' : 'Pause'} variant="ghost" onClick={() => setUserPaused((p) => !p)} aria-pressed={userPaused}>
            {userPaused ? <Play size={20} /> : <Pause size={20} />}
          </IconButton>
          <IconButton label="Close" variant="ghost" onClick={onClose}>
            <X size={22} />
          </IconButton>
        </div>

        {/* stage */}
        <div
          className="relative min-h-0 flex-1 bg-bg"
          onPointerDown={() => setHoldPaused(true)}
          onPointerUp={() => setHoldPaused(false)}
          onPointerLeave={() => setHoldPaused(false)}
          onPointerCancel={() => setHoldPaused(false)}
        >
          <StoryStage story={story} paused={paused} muted={muted} onProgress={setProgress} onEnded={next} />

          {story.type !== 'text' && story.content?.text ? (
            <p className="absolute bottom-4 left-4 right-4 rounded-md bg-scrim p-3 text-sm text-text-1">{story.content.text}</p>
          ) : null}

          <button type="button" aria-label="Previous story" onClick={prev} className="absolute inset-y-0 left-0 w-1/3 outline-offset-[-4px]">
            <ChevronLeft size={28} className="ml-2 opacity-0 transition-opacity dur-1 hover:opacity-70" />
          </button>
          <button type="button" aria-label="Next story" onClick={next} className="absolute inset-y-0 right-0 flex w-1/3 justify-end outline-offset-[-4px]">
            <ChevronRight size={28} className="mr-2 opacity-0 transition-opacity dur-1 hover:opacity-70" />
          </button>
          {paused ? <span className="sr-only" role="status">Paused</span> : null}
        </div>

        {/* reactions + reply */}
        {!mine ? (
          <div className="space-y-2 border-t border-line p-3">
            <div className="flex justify-between gap-1" role="group" aria-label="React to this story">
              {REACTIONS.map(({ key, label, Icon, fillWhenActive }) => {
                const active = currentReaction === key;
                return (
                  <IconButton
                    key={key}
                    label={label}
                    variant="ghost"
                    active={active}
                    aria-pressed={active}
                    disabled={react.isPending}
                    onClick={() => react.mutate({ storyId: story._id, reaction: key })}
                  >
                    <Icon size={22} filled={!!fillWhenActive && active} />
                  </IconButton>
                );
              })}
            </div>
            <form
              className="flex items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = reply.trim();
                if (text) sendReply.mutate({ storyId: story._id, text });
              }}
            >
              <Input
                label="Reply"
                hideLabel
                placeholder={`Reply to ${authorName(group.author)}…`}
                value={reply}
                maxLength={1000}
                autoComplete="off"
                enterKeyHint="send"
                onFocus={() => setUserPaused(true)}
                onChange={(e) => setReply(e.target.value)}
              />
              <Button type="submit" variant="primary" disabled={!reply.trim()} loading={sendReply.isPending} className="shrink-0">
                Send
              </Button>
            </form>
          </div>
        ) : null}
      </div>

      <StoryResponsesModal storyId={responsesFor} open={Boolean(responsesFor)} onClose={() => setResponsesFor(null)} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this story?"
        message="It disappears for everyone, including your archive."
        confirmLabel="Delete"
        destructive
        loading={removeStory.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && removeStory.mutate(deleteTarget)}
      />
    </div>
  );
}

/* -------------------------------------------------------------- composer */

type StoryType = 'text' | 'image' | 'video';

export function CreateStoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [type, setType] = useState<StoryType>('text');
  const [text, setText] = useState('');
  const [media, setMedia] = useState<{ key: string; url: string; local?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [privacy, setPrivacy] = useState('public');
  const [hashtags, setHashtags] = useState('');
  const [duration, setDuration] = useState(DEFAULT_STORY_SECONDS);
  const [look, setLook] = useState(STORY_BACKGROUNDS[0].id);
  const [font, setFont] = useState<StoryFont>('default');

  useEffect(() => {
    if (!open) {
      setType('text');
      setText('');
      setMedia((m) => {
        if (m?.local) URL.revokeObjectURL(m.local);
        return null;
      });
      setUploading(false);
      setPrivacy('public');
      setHashtags('');
      setDuration(DEFAULT_STORY_SECONDS);
      setLook(STORY_BACKGROUNDS[0].id);
      setFont('default');
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  async function pickFile(file: File | null | undefined) {
    if (!file) return;
    const contentType = uploadContentType(file);
    const wantVideo = type === 'video';
    if (!contentType || (wantVideo ? !ACCEPTED_VIDEO_TYPES.includes(contentType) : !ACCEPTED_IMAGE_TYPES.includes(contentType))) {
      toast.error(wantVideo ? 'Choose an MP4 or MOV video.' : 'Choose a JPEG, PNG, WebP or HEIC photo.');
      return;
    }
    const max = wantVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
    if (file.size > max) {
      toast.error(`${file.name} is over ${wantVideo ? '50' : '10'} MB.`);
      return;
    }
    setUploading(true);
    try {
      // A clip shows for as long as it runs; the stepper starts there.
      const clipSeconds = wantVideo ? await readVideoDuration(file) : null;
      if (clipSeconds) setDuration(clampStoryDuration(clipSeconds));
      const uploaded = await uploadPresigned(file, contentType, 'media');
      setMedia((m) => {
        if (m?.local) URL.revokeObjectURL(m.local);
        return { key: uploaded.key, url: mediaUrl(uploaded.url), local: URL.createObjectURL(file) };
      });
    } catch (e) {
      toast.error(e, 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function clearMedia() {
    setMedia((m) => {
      if (m?.local) URL.revokeObjectURL(m.local);
      return null;
    });
  }

  const palette = STORY_BACKGROUNDS.find((b) => b.id === look) || STORY_BACKGROUNDS[0];

  const create = useMutation({
    mutationFn: async () => {
      const content: Record<string, unknown> = {};
      if (text.trim()) content.text = text.trim();
      if (type !== 'text' && media) content.media = media.key;
      if (type === 'text') {
        content.background = 'solid';
        content.backgroundColor = palette.backgroundColor;
        content.textColor = palette.textColor;
        content.font = font;
      }
      const tags = hashtags
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, '').trim().toLowerCase())
        .filter(Boolean);
      const { data } = await api.post('/story', { type, privacy, content, duration, hashtags: tags });
      return data;
    },
    onSuccess: () => {
      toast.success('Story posted');
      qc.invalidateQueries({ queryKey: ['stories'] });
      onClose();
    },
    onError: (e) => toast.error(e, 'Could not post the story.'),
  });

  const valid = type === 'text' ? text.trim().length > 0 : !!media;
  const busy = create.isPending || uploading;
  const mediaAccept = type === 'video' ? ACCEPTED_VIDEO_TYPES.join(',') : ACCEPTED_IMAGE_TYPES.join(',');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New story"
      description="Visible for 24 hours, then it moves to your archive."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || busy} loading={create.isPending} onClick={() => create.mutate()}>
            Post story
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SegmentedControl
          aria-label="Story type"
          fill
          tabs={[
            { value: 'text', label: 'Text' },
            { value: 'image', label: 'Photo', icon: <ImageIcon size={16} /> },
            { value: 'video', label: 'Video', icon: <VideoIcon size={16} /> },
          ]}
          value={type}
          onChange={(v) => {
            const nextType = v as StoryType;
            if (nextType !== type) {
              clearMedia();
              setDuration(DEFAULT_STORY_SECONDS);
            }
            setType(nextType);
          }}
        />

        {type === 'text' ? (
          <div
            className="flex min-h-40 items-center justify-center rounded-md p-6 text-center transition-colors dur-2"
            style={{ background: palette.backgroundColor, color: palette.textColor, ...storyFontStyle(font) }}
            aria-hidden="true"
          >
            <p className="text-lg leading-snug [text-wrap:balance] [overflow-wrap:anywhere]">{text.trim() || 'Your text shows here'}</p>
          </div>
        ) : (
          <div>
            <input ref={fileRef} type="file" accept={mediaAccept} hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
            {media ? (
              <div className="relative overflow-hidden rounded-md bg-surface-2">
                {type === 'video' ? (
                  <video src={media.local || media.url} controls playsInline className="max-h-72 w-full object-contain" />
                ) : (
                  <img src={media.local || media.url} alt="Selected photo" className="max-h-72 w-full object-contain" />
                )}
                <IconButton label="Remove media" variant="secondary" size={40} onClick={clearMedia} className="absolute right-2 top-2 shadow-2">
                  <X size={18} />
                </IconButton>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-2 p-6 text-center text-text-2 transition-colors dur-1 hover:border-brand hover:text-text-1"
              >
                {uploading ? (
                  <>
                    <Spinner size={22} className="text-brand" />
                    <span className="text-sm font-semibold">Uploading…</span>
                  </>
                ) : (
                  <>
                    {type === 'video' ? <VideoIcon size={28} /> : <ImageIcon size={28} />}
                    <span className="text-sm font-semibold text-text-1">{type === 'video' ? 'Choose a video' : 'Choose a photo'}</span>
                    <span className="text-xs">{type === 'video' ? 'MP4 or MOV, up to 50 MB' : 'JPEG, PNG, WebP or HEIC, up to 10 MB'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        <Textarea
          label={type === 'text' ? 'Text' : 'Caption'}
          hint={type === 'text' ? undefined : 'Optional'}
          rows={3}
          autoGrow
          maxRows={8}
          placeholder={type === 'text' ? 'What’s happening?' : 'Say something about it…'}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
        />

        {type === 'text' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="type-label mb-1.5 text-text-2" id="story-look-label">
                Background
              </p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="story-look-label">
                {STORY_BACKGROUNDS.map((b) => {
                  const on = b.id === look;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={b.label}
                      title={b.label}
                      onClick={() => setLook(b.id)}
                      className={cx(
                        'h-9 w-9 rounded-full border border-line transition-shadow dur-1',
                        on ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface-1' : 'hover:ring-2 hover:ring-line-strong',
                      )}
                      style={{ background: b.backgroundColor }}
                    />
                  );
                })}
              </div>
            </div>
            <Select
              label="Font"
              value={font}
              onChange={(v) => setFont(isStoryFont(v) ? v : 'default')}
              options={STORY_FONTS.map((f) => ({ value: f.id, label: f.label }))}
            />
          </div>
        ) : null}

        <Input
          label="Hashtags"
          hint="Separate with spaces"
          placeholder="legday pr"
          value={hashtags}
          autoComplete="off"
          onChange={(e) => setHashtags(e.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Audience"
            value={privacy}
            onChange={setPrivacy}
            options={[
              { value: 'public', label: 'Public', description: 'Anyone on Vybe' },
              { value: 'friends', label: 'Friends', description: 'People you’re friends with' },
              { value: 'close_friends', label: 'Close friends', description: 'Your close friends list' },
            ]}
          />
          <Stepper
            label="Shows for"
            hint={type === 'video' ? 'Set from the clip’s length' : undefined}
            value={duration}
            onChange={setDuration}
            min={type === 'video' ? MIN_STORY_SECONDS : 5}
            max={MAX_STORY_SECONDS}
            step={type === 'video' ? 1 : 5}
            unit="s"
          />
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- bubbles */

function Bubble({
  onClick,
  label,
  avatar,
  caption,
  emphasised,
  children,
}: {
  onClick: () => void;
  label: string;
  avatar: ReactNode;
  caption: string;
  emphasised?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="snap-item relative flex w-19 shrink-0 flex-col items-center">
      <button type="button" onClick={onClick} aria-label={label} className="flex w-full flex-col items-center gap-2 rounded-sm py-1">
        {avatar}
        <span className={cx('w-full truncate text-center text-xs', emphasised ? 'font-semibold text-text-1' : 'font-medium text-text-2')}>{caption}</span>
      </button>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ tray */

/**
 * The stories row. `home` sits above the Home composer and stays hidden until
 * there is something to show; `page` (the Stories screen) always renders and
 * owns the loading, error and empty states.
 */
export function StoryTray({ variant = 'page' }: { variant?: 'home' | 'page' }) {
  const me = useAuth((s) => s.user);
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const tray = useQuery({
    queryKey: TRAY_KEY,
    queryFn: async () => {
      const { data } = await api.get('/story');
      return (data.stories || []) as StoryGroup[];
    },
    staleTime: 60_000,
  });

  const groups = useMemo(() => tray.data || [], [tray.data]);
  const { own, others } = useMemo(() => splitOwnGroup(groups, me?._id), [groups, me?._id]);
  const meAsAuthor = asStoryAuthor(me);
  const openComposer = () => setComposerOpen(true);

  if (variant === 'home') {
    if (tray.isLoading || tray.isError) return null;
    if (!own && others.length === 0) return null;
  }

  const ownBubble = meAsAuthor ? (
    <Bubble
      onClick={() => (own ? setViewer({ groups: [own], start: 0, startStory: 0 }) : openComposer())}
      label={own ? `Your story (${own.stories.length} ${own.stories.length === 1 ? 'story' : 'stories'})` : 'Add to your story'}
      caption="Your story"
      avatar={<Avatar src={meAsAuthor.avatar} name={authorName(meAsAuthor)} size={64} ring={Boolean(own)} ringTone="neutral" />}
    >
      <button
        type="button"
        onClick={openComposer}
        aria-label="Add to your story"
        className="absolute right-1 top-11 grid h-7 w-7 place-items-center rounded-full bg-brand text-on-brand ring-2 ring-bg transition-colors dur-1 hover:bg-brand-hover before:absolute before:-inset-2 before:content-['']"
      >
        <Plus size={16} />
      </button>
    </Bubble>
  ) : null;

  const row = (
    <div className={cx('snap-row no-scrollbar flex gap-3 overflow-x-auto py-2', variant === 'page' ? '-mx-4 px-4 scroll-pl-4 md:-mx-6 md:px-6 md:scroll-pl-6' : 'px-3 scroll-pl-3')}>
      {ownBubble}
      {others.map((g, i) => {
        const unseen = groupHasUnseen(g, me?._id);
        return (
          <Bubble
            key={g.author._id}
            onClick={() => setViewer({ groups: others, start: i })}
            label={`${unseen ? 'New stories' : 'Stories'} from ${authorName(g.author)}`}
            caption={authorName(g.author)}
            emphasised={unseen}
            avatar={<Avatar src={g.author.avatar} name={authorName(g.author)} size={64} ring ringTone={unseen ? 'brand' : 'neutral'} />}
          />
        );
      })}
      {variant === 'page' && others.length === 0 && !own ? (
        <div className="flex-1">
          <EmptyState
            size="sm"
            title="No stories yet today"
            message="Post one — it stays up for 24 hours, then lands in your archive."
            action={{ label: 'New story', onClick: openComposer, icon: <Plus size={18} /> }}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <section aria-label={variant === 'home' ? 'Stories' : 'Recent stories'}>
      {variant === 'page' && tray.isLoading ? (
        <div className="flex gap-4 overflow-hidden py-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex w-19 shrink-0 flex-col items-center gap-2">
              <Skeleton className="h-16 w-16 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      ) : variant === 'page' && tray.isError ? (
        <ErrorState error={tray.error} title="Couldn’t load stories" onRetry={() => tray.refetch()} />
      ) : variant === 'home' ? (
        <Card padded={false} className="overflow-hidden">
          {row}
        </Card>
      ) : (
        row
      )}

      {viewer && viewer.groups.length > 0 ? (
        <StoryViewer groups={viewer.groups} startGroup={viewer.start} startStory={viewer.startStory} onClose={() => setViewer(null)} />
      ) : null}
      <CreateStoryModal open={composerOpen} onClose={() => setComposerOpen(false)} />
    </section>
  );
}

/* ------------------------------------------------------------ highlights */

export const highlightsKey = (userId?: string) => ['stories', 'highlights', userId] as const;

export function useHighlights(userId?: string, enabled = true) {
  return useQuery({
    queryKey: highlightsKey(userId),
    enabled: Boolean(userId) && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get(`/story/highlights/${userId}`);
      return (data.highlights || []) as Highlight[];
    },
  });
}

/** Cover art for a highlight: its cover image, else its first picture story, else a spark. */
export function HighlightCover({ highlight, size = 64 }: { highlight: Highlight; size?: number }) {
  const cover = highlight.coverImage || highlight.stories?.find((s) => s.type === 'image')?.content?.media;
  const text = highlight.stories?.find((s) => s.type === 'text');
  return (
    <span
      className="grid place-items-center overflow-hidden rounded-full border border-line bg-surface-2 text-text-3"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {cover ? (
        <img src={mediaUrl(cover)} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : text ? (
        <span className="flex h-full w-full items-center justify-center p-1 text-center text-2xs font-semibold leading-tight" style={textStoryStyle(text)}>
          {text.content?.text?.slice(0, 24)}
        </span>
      ) : (
        <Sparkles size={Math.round(size * 0.36)} />
      )}
    </span>
  );
}

/**
 * Opens a highlight in the viewer. The list response carries the stories
 * already; a bare highlight (no stories populated) is fetched on demand.
 */
export function useOpenHighlight(author: StoryAuthor | null, setViewer: (v: ViewerTarget | null) => void) {
  const toast = useToast();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const open = async (h: Highlight) => {
    let stories = h.stories || [];
    if (!stories.length) {
      setLoadingId(h._id);
      try {
        const { data } = await api.get(`/story/highlights/${h._id}/detail`);
        stories = (data.highlight?.stories || []) as Story[];
      } catch (e) {
        toast.error(e, 'Could not open this highlight.');
        setLoadingId(null);
        return;
      }
      setLoadingId(null);
    }
    if (!stories.length) {
      toast.info('This highlight has no stories you can see.');
      return;
    }
    const groupAuthor = stories[0]?.author || author;
    if (!groupAuthor) return;
    setViewer({ groups: [{ author: groupAuthor, stories }], start: 0, startStory: 0 });
  };
  return { open, loadingId };
}

/**
 * Highlights under a profile header: the owner's collections, playable by
 * anyone who can see the profile. The owner also gets a "New" bubble.
 */
export function HighlightsRow({ userId, isOwn = false, author }: { userId: string; isOwn?: boolean; author?: PublicUser | null }) {
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const q = useHighlights(userId);
  const storyAuthor = asStoryAuthor(author) || { _id: userId };
  const { open, loadingId } = useOpenHighlight(storyAuthor, setViewer);
  const list = q.data || [];

  if (q.isError) return null;
  if (!q.isLoading && list.length === 0 && !isOwn) return null;

  return (
    <section aria-label="Highlights" className="-mx-4 md:-mx-6 lg:mx-0">
      <div className="snap-row no-scrollbar flex gap-3 overflow-x-auto px-4 py-1 scroll-pl-4 md:px-6 md:scroll-pl-6 lg:px-0 lg:scroll-pl-0">
        {isOwn ? (
          <Link
            to="/stories?tab=highlights&new=1"
            viewTransition
            className="snap-item flex w-19 shrink-0 flex-col items-center gap-2 rounded-sm py-1"
            aria-label="New highlight"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full border border-dashed border-line-strong bg-surface-2 text-text-2">
              <Plus size={22} />
            </span>
            <span className="w-full truncate text-center text-xs font-medium text-text-2">New</span>
          </Link>
        ) : null}
        {q.isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex w-19 shrink-0 flex-col items-center gap-2 py-1" aria-hidden="true">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))
          : list.map((h) => {
              const n = h.storyCount ?? h.stories?.length ?? 0;
              return (
                <button
                  key={h._id}
                  type="button"
                  onClick={() => void open(h)}
                  aria-label={`Open highlight ${h.title} (${n} ${n === 1 ? 'story' : 'stories'})`}
                  aria-busy={loadingId === h._id || undefined}
                  className="snap-item flex w-19 shrink-0 flex-col items-center gap-2 rounded-sm py-1"
                >
                  <span className="relative">
                    <HighlightCover highlight={h} />
                    {loadingId === h._id ? (
                      <span className="absolute inset-0 grid place-items-center rounded-full bg-scrim text-[var(--navy-50)]">
                        <Spinner size={18} />
                      </span>
                    ) : null}
                  </span>
                  <span className="w-full truncate text-center text-xs font-medium text-text-2" title={h.title}>
                    {h.title}
                  </span>
                </button>
              );
            })}
      </div>
      {viewer ? <StoryViewer groups={viewer.groups} startGroup={viewer.start} startStory={viewer.startStory} onClose={() => setViewer(null)} /> : null}
    </section>
  );
}
