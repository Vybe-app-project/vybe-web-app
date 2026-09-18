import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  Stepper,
  Textarea,
  cx,
  formatStat,
  useToast,
} from './ui';
import {
  Check,
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
  Wow,
  X,
  type IconProps,
} from './icons';

/* ------------------------------------------------------------------ types */

type StoryAuthor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
};

type Story = {
  _id: string;
  author: StoryAuthor;
  type: 'image' | 'video' | 'text' | 'poll' | 'question';
  duration?: number;
  privacy?: string;
  createdAt?: string;
  expiresAt?: string;
  viewCount?: number;
  replyCount?: number;
  viewerReaction?: string | null;
  hasViewed?: boolean;
  hashtags?: string[];
  content?: {
    text?: string;
    media?: string;
    backgroundColor?: string;
    textColor?: string;
    question?: string;
  };
};

type StoryGroup = { author: StoryAuthor; stories: Story[] };

type Highlight = {
  _id: string;
  title: string;
  description?: string;
  coverImage?: string;
  storyCount?: number;
  stories?: Story[];
};

type ViewerTarget = { groups: StoryGroup[]; start: number };

const authorName = (a?: StoryAuthor | null) => a?.fullName?.trim() || a?.username || 'Vybe user';

const ago = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

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
type ReactionKey = 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'angry';
const REACTIONS: Array<{ key: ReactionKey; label: string; Icon: (p: IconProps) => ReactNode; fillWhenActive?: boolean }> = [
  { key: 'like', label: 'Like', Icon: ThumbsUp, fillWhenActive: true },
  { key: 'love', label: 'Love', Icon: Heart, fillWhenActive: true },
  { key: 'laugh', label: 'Laugh', Icon: Smile },
  { key: 'wow', label: 'Wow', Icon: Wow },
  { key: 'sad', label: 'Sad', Icon: Frown },
  { key: 'angry', label: 'Angry', Icon: Angry },
];

/* ----------------------------------------------------------------- upload */

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function uploadContentType(file: File): string | null {
  const declared = (file.type || '').toLowerCase().split(';')[0];
  const alias: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'image/heif': 'image/heic',
    'video/x-m4v': 'video/mp4',
    'video/m4v': 'video/mp4',
    'video/mov': 'video/quicktime',
  };
  const type = alias[declared] || declared;
  if ([...IMAGE_TYPES, ...VIDEO_TYPES].includes(type)) return type;
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const byExt: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime' };
  return byExt[ext] || null;
}

type PresignResponse = {
  uploadUrl: string;
  uploadMethod?: 'PUT' | 'POST';
  uploadFields?: Record<string, string>;
  publicUrl?: string;
  storageReference?: string;
  key: string;
};

/**
 * Story media must be an owned, completed upload: presign → transfer → use
 * the returned storage key as `content.media`.
 */
async function uploadStoryMedia(file: File, contentType: string): Promise<{ key: string; url: string }> {
  const { data } = await api.post('/upload/presign', { contentType, purpose: 'media', sizeBytes: file.size });
  const p = data as PresignResponse;
  let res: Response;
  if (p.uploadMethod === 'POST') {
    const form = new FormData();
    Object.entries(p.uploadFields || {}).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);
    res = await fetch(p.uploadUrl, { method: 'POST', body: form });
  } else {
    res = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  }
  if (!res.ok) throw new Error(`Upload failed (${res.status}). Try a smaller file or check your connection.`);
  const key = p.storageReference || p.key;
  return { key, url: p.publicUrl || mediaUrl(key) };
}

/* ----------------------------------------------------------------- viewer */

function StoryStage({ story }: { story: Story }) {
  if (story.type === 'video') {
    return (
      <video
        key={story._id}
        src={mediaUrl(story.content?.media)}
        autoPlay
        playsInline
        controls={false}
        className="h-full w-full object-contain"
      />
    );
  }
  if (story.type === 'image') {
    return <img src={mediaUrl(story.content?.media)} alt={story.content?.text || `Story by ${authorName(story.author)}`} className="h-full w-full object-contain" />;
  }
  return (
    <div
      className="flex h-full w-full items-center justify-center p-8 text-center"
      style={{
        background: story.content?.backgroundColor || 'var(--navy-800)',
        color: story.content?.textColor || 'var(--text-1)',
      }}
    >
      <p className="type-heading text-xl">{story.content?.text || story.content?.question}</p>
    </div>
  );
}

function StoryViewer({ groups, startGroup, onClose }: { groups: StoryGroup[]; startGroup: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const [progress, setProgress] = useState(0);
  const [holdPaused, setHoldPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [localReaction, setLocalReaction] = useState<Record<string, ReactionKey>>({});

  const group = groups[gi];
  const story = group?.stories?.[si];
  const paused = holdPaused || userPaused;
  const durationMs = Math.max(2, Math.min(story?.duration || 15, 60)) * 1000;

  const next = useCallback(() => {
    setProgress(0);
    setSi((prevSi) => {
      const stories = groups[gi]?.stories || [];
      if (prevSi + 1 < stories.length) return prevSi + 1;
      if (gi + 1 < groups.length) {
        setGi(gi + 1);
        return 0;
      }
      onClose();
      return prevSi;
    });
  }, [gi, groups, onClose]);

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

  // Body scroll lock while the viewer is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Progress ticker drives auto-advance for the current story.
  useEffect(() => {
    if (!story || paused) return;
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
  }, [story?._id, paused, durationMs, next]);

  const markViewed = useMutation({
    mutationFn: async (storyId: string) => {
      await api.put(`/story/${storyId}/view`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stories', 'tray'] }),
  });

  const viewedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!story?._id) return;
    if (viewedRef.current.has(story._id)) return;
    viewedRef.current.add(story._id);
    markViewed.mutate(story._id);
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
        const next = { ...m };
        if (previous) next[storyId] = previous;
        else delete next[storyId];
        return next;
      });
      toast.error(e, 'Could not send your reaction.');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stories', 'tray'] }),
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
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') onClose();
      else if (typing) return;
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') {
        e.preventDefault();
        setUserPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  if (!group || !story) return null;
  const mine = story.author?._id === me?._id;
  const currentReaction = (localReaction[story._id] || story.viewerReaction || null) as ReactionKey | null;

  return (
    <div
      className="dark anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-bg/95 text-text-1 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Stories from ${authorName(group.author)}`}
    >
      <div className="safe-top safe-bottom relative flex h-dvh w-full max-w-md flex-col overflow-hidden bg-surface-1 sm:h-[min(90dvh,52rem)] sm:rounded-xl sm:shadow-3">
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
        <div className="flex items-center gap-3 px-3 py-2">
          <Avatar src={group.author.avatar} name={authorName(group.author)} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-1">{authorName(group.author)}</p>
            <p className="text-xs text-text-2">{ago(story.createdAt)}</p>
          </div>
          {mine ? (
            <>
              <Badge tone="neutral" className="tabular">
                <Eye size={14} />
                {formatStat(story.viewCount ?? 0, { compact: true })}
              </Badge>
              <IconButton label="Delete story" variant="ghost" onClick={() => setDeleteTarget(story._id)}>
                <Trash size={20} />
              </IconButton>
            </>
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
          <StoryStage story={story} />

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

function CreateStoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [type, setType] = useState<StoryType>('text');
  const [text, setText] = useState('');
  const [media, setMedia] = useState<{ key: string; url: string; local?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [privacy, setPrivacy] = useState('public');
  const [hashtags, setHashtags] = useState('');
  const [duration, setDuration] = useState(15);

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
      setDuration(15);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  async function pickFile(file: File | null | undefined) {
    if (!file) return;
    const contentType = uploadContentType(file);
    const wantVideo = type === 'video';
    if (!contentType || (wantVideo ? !VIDEO_TYPES.includes(contentType) : !IMAGE_TYPES.includes(contentType))) {
      toast.error(wantVideo ? 'Choose an MP4 or MOV video.' : 'Choose a JPEG, PNG, WebP or HEIC photo.');
      return;
    }
    const max = wantVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > max) {
      toast.error(`${file.name} is over ${wantVideo ? '50' : '10'} MB.`);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadStoryMedia(file, contentType);
      setMedia((m) => {
        if (m?.local) URL.revokeObjectURL(m.local);
        return { ...uploaded, local: URL.createObjectURL(file) };
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

  const create = useMutation({
    mutationFn: async () => {
      const content: Record<string, unknown> = {};
      if (text.trim()) content.text = text.trim();
      if (type !== 'text' && media) content.media = media.key;
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

  const mediaAccept = type === 'video' ? VIDEO_TYPES.join(',') : IMAGE_TYPES.join(',');

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
            const next = v as StoryType;
            if (next !== type) clearMedia();
            setType(next);
          }}
        />

        {type !== 'text' ? (
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
        ) : null}

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
          <Stepper label="Shows for" value={duration} onChange={setDuration} min={5} max={60} step={5} unit="s" />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- highlights */

function CreateHighlightModal({ open, onClose, archive }: { open: boolean; onClose: () => void; archive: Story[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [storyIds, setStoryIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setStoryIds([]);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/story/highlights', {
        title: title.trim(),
        description: description.trim() || undefined,
        storyIds,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Highlight created');
      qc.invalidateQueries({ queryKey: ['stories', 'highlights', me?._id] });
      onClose();
    },
    onError: (e) => toast.error(e, 'Could not create the highlight.'),
  });

  const toggle = (id: string) => setStoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New highlight"
      description="Pick stories from your archive to keep on your profile."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={title.trim().length < 1 || storyIds.length === 0}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Create highlight
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Title" placeholder="Marathon block" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          label="Description"
          hint="Optional"
          rows={2}
          maxLength={280}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div>
          <p className="type-label mb-1.5 text-text-2" id="highlight-picker-label">
            Stories <span className="tabular font-medium text-text-3">({storyIds.length} selected)</span>
          </p>
          {archive.length === 0 ? (
            <p className="rounded-sm bg-surface-2 p-4 text-sm text-text-2">
              Your archive is empty. Post a story and it lands here once it expires.
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-4" role="group" aria-labelledby="highlight-picker-label">
              {archive.map((s) => {
                const on = storyIds.includes(s._id);
                return (
                  <button
                    key={s._id}
                    type="button"
                    aria-pressed={on}
                    aria-label={s.content?.text?.slice(0, 60) || `Story from ${ago(s.createdAt) || 'your archive'}`}
                    onClick={() => toggle(s._id)}
                    className={cx(
                      'relative aspect-[9/16] overflow-hidden rounded-md bg-surface-2 transition-shadow dur-1',
                      on ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface-1' : 'hover:ring-2 hover:ring-line-strong',
                    )}
                  >
                    {s.content?.media && s.type !== 'video' ? (
                      <img src={mediaUrl(s.content.media)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center p-1.5 text-center text-xs text-text-2">
                        {s.type === 'video' ? <VideoIcon size={20} /> : s.content?.text?.slice(0, 40) || 'Story'}
                      </span>
                    )}
                    {on ? (
                      <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-brand text-on-brand">
                        <Check size={14} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------- page */

const TABS = [
  { value: 'tray', label: 'Recent' },
  { value: 'archive', label: 'Archive' },
  { value: 'highlights', label: 'Highlights' },
];

export default function Stories() {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('tray');
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [deleteHighlight, setDeleteHighlight] = useState<Highlight | null>(null);

  const tray = useQuery({
    queryKey: ['stories', 'tray'],
    queryFn: async () => {
      const { data } = await api.get('/story');
      return (data.stories || []) as StoryGroup[];
    },
  });

  const archive = useQuery({
    queryKey: ['stories', 'archive'],
    enabled: tab === 'archive' || highlightOpen,
    queryFn: async () => {
      const { data } = await api.get('/story/archive');
      return (data.stories || []) as Story[];
    },
  });

  const highlights = useQuery({
    queryKey: ['stories', 'highlights', me?._id],
    enabled: Boolean(me?._id) && tab === 'highlights',
    queryFn: async () => {
      const { data } = await api.get(`/story/highlights/${me?._id}`);
      return (data.highlights || []) as Highlight[];
    },
  });

  const removeHighlight = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/story/highlights/${id}`);
    },
    onSuccess: () => {
      toast.success('Highlight deleted');
      setDeleteHighlight(null);
      qc.invalidateQueries({ queryKey: ['stories', 'highlights', me?._id] });
    },
    onError: (e) => {
      toast.error(e, 'Could not delete the highlight.');
      setDeleteHighlight(null);
    },
  });

  const groups = useMemo(() => tray.data || [], [tray.data]);
  const ownIndex = useMemo(() => groups.findIndex((g) => g.author._id === me?._id), [groups, me?._id]);
  const openComposer = () => setComposerOpen(true);

  const meAsAuthor: StoryAuthor | null = me
    ? { _id: me._id, username: me.username, fullName: me.fullName, avatar: me.avatar }
    : null;

  return (
    <div>
      <PageHeader
        title="Stories"
        subtitle="Moments from your people. They disappear after 24 hours."
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={openComposer}>
            New story
          </Button>
        }
        mobileActions={
          <IconButton label="New story" onClick={openComposer}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <div className="space-y-5">
        <SegmentedControl aria-label="Story views" tabs={TABS} value={tab} onChange={setTab} className="max-w-sm" />

        {tab === 'tray' ? (
          <section aria-label="Recent stories">
            {tray.isLoading ? (
              <div className="flex gap-4 overflow-hidden py-2" aria-busy="true">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex w-19 shrink-0 flex-col items-center gap-2">
                    <Skeleton className="h-16 w-16 rounded-full" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                ))}
              </div>
            ) : tray.isError ? (
              <ErrorState error={tray.error} title="Couldn’t load stories" onRetry={() => tray.refetch()} />
            ) : (
              <div className="snap-row no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 py-2 scroll-pl-4 md:-mx-6 md:px-6 md:scroll-pl-6">
                {/* One tile for yourself. With an active story it is your ring (tap to watch) with a
                    "+" badge that opens the composer; without one the whole tile is the add action. */}
                {meAsAuthor && ownIndex >= 0 ? (
                  <div className="snap-item relative flex w-19 shrink-0 flex-col items-center gap-2 py-1">
                    <button
                      type="button"
                      onClick={() => setViewer({ groups, start: ownIndex })}
                      aria-label="Watch your stories"
                      className="flex w-full flex-col items-center gap-2 rounded-sm"
                    >
                      <Avatar src={meAsAuthor.avatar} name={authorName(meAsAuthor)} size={64} ring ringTone="brand" />
                      <span className="w-full truncate text-center text-xs font-semibold text-text-1">Your story</span>
                    </button>
                    <button
                      type="button"
                      onClick={openComposer}
                      aria-label="Add to your story"
                      className="absolute right-0 top-11 grid h-7 w-7 place-items-center rounded-full bg-brand text-on-brand ring-2 ring-bg transition-transform dur-1 before:absolute before:-inset-2 before:content-[''] active:scale-95"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ) : meAsAuthor ? (
                  <button type="button" onClick={openComposer} className="snap-item flex w-19 shrink-0 flex-col items-center gap-2 rounded-sm py-1">
                    <span className="relative">
                      <Avatar src={meAsAuthor.avatar} name={authorName(meAsAuthor)} size={64} />
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-brand text-on-brand ring-2 ring-bg" aria-hidden="true">
                        <Plus size={14} />
                      </span>
                    </span>
                    <span className="w-full truncate text-center text-xs font-medium text-text-2">Your story</span>
                  </button>
                ) : null}
                {groups.map((g, i) => {
                  if (i === ownIndex) return null;
                  const unseen = g.stories.some((s) => !s.hasViewed);
                  return (
                    <button
                      key={g.author._id}
                      type="button"
                      onClick={() => setViewer({ groups, start: i })}
                      aria-label={`${unseen ? 'New stories' : 'Stories'} from ${authorName(g.author)}`}
                      className="snap-item flex w-19 shrink-0 flex-col items-center gap-2 rounded-sm py-1"
                    >
                      <Avatar src={g.author.avatar} name={authorName(g.author)} size={64} ring ringTone={unseen ? 'brand' : 'neutral'} />
                      <span className={cx('w-full truncate text-center text-xs', unseen ? 'font-semibold text-text-1' : 'font-medium text-text-2')}>
                        {g.author.username || g.author.fullName}
                      </span>
                    </button>
                  );
                })}
                {groups.length === 0 ? (
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
            )}
          </section>
        ) : null}

        {tab === 'archive' ? (
          <section aria-label="Archived stories">
            {archive.isLoading ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5" aria-busy="true">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[9/16] w-full rounded-md" />
                ))}
              </div>
            ) : archive.isError ? (
              <ErrorState error={archive.error} title="Couldn’t load your archive" onRetry={() => archive.refetch()} />
            ) : (archive.data?.length || 0) === 0 ? (
              <EmptyState
                title="Your archive is empty"
                message="Stories you post land here after they expire."
                action={{ label: 'New story', onClick: openComposer, icon: <Plus size={18} /> }}
              />
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {archive.data!.map((s) => (
                  <li key={s._id}>
                    <button
                      type="button"
                      onClick={() => meAsAuthor && setViewer({ groups: [{ author: s.author || meAsAuthor, stories: [s] }], start: 0 })}
                      aria-label={`Open story from ${ago(s.createdAt) || 'your archive'}`}
                      className="relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-surface-2 transition-transform dur-1 hover:scale-[1.02]"
                    >
                      {s.content?.media && s.type !== 'video' ? (
                        <img src={mediaUrl(s.content.media)} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : s.type === 'video' ? (
                        <video src={mediaUrl(s.content?.media)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                      ) : (
                        <span
                          className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-semibold"
                          style={{
                            background: s.content?.backgroundColor || 'var(--navy-800)',
                            color: s.content?.textColor || 'var(--navy-50)',
                          }}
                        >
                          {s.content?.text}
                        </span>
                      )}
                      <Badge tone="neutral" size="sm" className="tabular absolute bottom-1.5 left-1.5 shadow-1">
                        <Eye size={12} />
                        {formatStat(s.viewCount ?? 0, { compact: true })}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {tab === 'highlights' ? (
          <section aria-label="Highlights" className="space-y-4">
            <div className="flex justify-end">
              <Button variant="secondary" icon={<Plus size={18} />} onClick={() => setHighlightOpen(true)}>
                New highlight
              </Button>
            </div>
            {highlights.isLoading ? (
              <div className="flex flex-wrap gap-5" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex w-24 flex-col items-center gap-2">
                    <Skeleton className="h-20 w-20 rounded-full" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                ))}
              </div>
            ) : highlights.isError ? (
              <ErrorState error={highlights.error} title="Couldn’t load highlights" onRetry={() => highlights.refetch()} />
            ) : (highlights.data?.length || 0) === 0 ? (
              <EmptyState
                title="No highlights yet"
                message="Group stories from your archive into a collection that doesn’t expire."
                action={{ label: 'New highlight', onClick: () => setHighlightOpen(true), icon: <Plus size={18} /> }}
              />
            ) : (
              <ul className="flex flex-wrap gap-5">
                {(highlights.data || []).map((h) => {
                  const n = h.storyCount ?? h.stories?.length ?? 0;
                  return (
                    <li key={h._id} className="flex w-24 flex-col items-center text-center">
                      <div className="relative">
                        <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-line bg-surface-2 text-text-3">
                          {h.coverImage ? <img src={mediaUrl(h.coverImage)} alt="" className="h-full w-full object-cover" /> : <Sparkles size={24} />}
                        </div>
                        <div className="absolute -right-4 -top-3">
                          <Menu
                            label={`Options for ${h.title}`}
                            items={[{ label: 'Delete highlight', icon: <Trash size={18} />, danger: true, onSelect: () => setDeleteHighlight(h) }]}
                          />
                        </div>
                      </div>
                      <p className="mt-2 w-full truncate text-sm font-semibold text-text-1" title={h.title}>
                        {h.title}
                      </p>
                      <p className="tabular text-xs text-text-2">
                        {n} {n === 1 ? 'story' : 'stories'}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {viewer && viewer.groups.length > 0 ? (
        <StoryViewer groups={viewer.groups} startGroup={viewer.start} onClose={() => setViewer(null)} />
      ) : null}

      <CreateStoryModal open={composerOpen} onClose={() => setComposerOpen(false)} />
      <CreateHighlightModal open={highlightOpen} onClose={() => setHighlightOpen(false)} archive={archive.data || []} />

      <ConfirmDialog
        open={Boolean(deleteHighlight)}
        title={deleteHighlight ? `Delete “${deleteHighlight.title}”?` : 'Delete highlight?'}
        message="The stories stay in your archive; only the collection is removed."
        confirmLabel="Delete"
        destructive
        loading={removeHighlight.isPending}
        onCancel={() => setDeleteHighlight(null)}
        onConfirm={() => deleteHighlight && removeHighlight.mutate(deleteHighlight._id)}
      />
    </div>
  );
}
