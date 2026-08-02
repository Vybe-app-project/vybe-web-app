import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Tabs,
  Textarea,
  useToast,
} from './ui';
import { Play, Trash, X } from './icons';

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
  type: 'image' | 'video' | 'text';
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

const REACTIONS = ['like', 'love', 'fire', 'clap', 'wow'] as const;

const REACTION_GLYPH: Record<string, string> = {
  like: '👍',
  love: '❤️',
  fire: '🔥',
  clap: '👏',
  wow: '😮',
};

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

/* ----------------------------------------------------------------- viewer */

function StoryViewer({
  groups,
  startGroup,
  onClose,
}: {
  groups: StoryGroup[];
  startGroup: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const group = groups[gi];
  const story = group?.stories?.[si];
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

  // Progress ticker drives auto-advance for the current story.
  useEffect(() => {
    if (!story || paused) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const pct = Math.min(((Date.now() - started) / durationMs) * 100, 100);
      setProgress(pct);
      if (pct >= 100) {
        window.clearInterval(timer);
        next();
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [story?._id, paused, durationMs, next, story]);

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
    mutationFn: async ({ storyId, reaction }: { storyId: string; reaction: string }) => {
      await api.post(`/story/${storyId}/reaction`, { reaction });
    },
    onSuccess: () => {
      toast.success('Reaction sent');
      qc.invalidateQueries({ queryKey: ['stories', 'tray'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not react to this story')),
  });

  const sendReply = useMutation({
    mutationFn: async ({ storyId, text }: { storyId: string; text: string }) => {
      await api.post(`/story/${storyId}/reply`, { text });
    },
    onSuccess: () => {
      setReply('');
      toast.success('Reply sent');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not send the reply')),
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
      toast.error(errMsg(e, 'Could not delete the story'));
      setDeleteTarget(null);
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') onClose();
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  if (!group || !story) return null;
  const mine = story.author?._id === me?._id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <button
        type="button"
        aria-label="Close story viewer"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X />
      </button>

      <div className="relative flex h-full max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)]">
        <div className="flex gap-1 px-3 pt-3">
          {group.stories.map((s, i) => (
            <div key={s._id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full bg-white transition-[width] duration-100"
                style={{ width: i < si ? '100%' : i === si ? `${progress}%` : '0%' }}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <Avatar
            src={mediaUrl(group.author.avatar)}
            name={group.author.fullName || group.author.username}
            size={36}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {group.author.fullName || group.author.username}
            </p>
            <p className="text-xs text-[var(--color-muted)]">{ago(story.createdAt)}</p>
          </div>
          {mine && (
            <>
              <Badge>{story.viewCount ?? 0} views</Badge>
              <button
                type="button"
                aria-label="Delete story"
                onClick={() => setDeleteTarget(story._id)}
                className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              >
                <Trash />
              </button>
            </>
          )}
        </div>

        <div
          className="relative min-h-0 flex-1"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          {story.type === 'video' ? (
            <video
              key={story._id}
              src={mediaUrl(story.content?.media)}
              autoPlay
              playsInline
              controls={false}
              className="h-full w-full object-contain"
            />
          ) : story.type === 'image' ? (
            <img
              src={mediaUrl(story.content?.media)}
              alt="story"
              className="h-full w-full object-contain"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center p-8 text-center"
              style={{
                background: story.content?.backgroundColor || 'linear-gradient(135deg,#7c5cff,#22d3ee)',
                color: story.content?.textColor || '#08080d',
              }}
            >
              <p className="text-xl font-semibold">{story.content?.text}</p>
            </div>
          )}

          {story.type !== 'text' && story.content?.text && (
            <p className="absolute bottom-4 left-4 right-4 rounded-xl bg-black/50 p-3 text-sm text-white">
              {story.content.text}
            </p>
          )}

          <button
            type="button"
            aria-label="Previous story"
            onClick={prev}
            className="absolute inset-y-0 left-0 w-1/3 cursor-pointer"
          />
          <button
            type="button"
            aria-label="Next story"
            onClick={next}
            className="absolute inset-y-0 right-0 w-1/3 cursor-pointer"
          />
        </div>

        {!mine && (
          <div className="space-y-2 border-t border-[var(--color-line)] p-3">
            <div className="flex justify-center gap-2">
              {REACTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  title={r}
                  onClick={() => react.mutate({ storyId: story._id, reaction: r })}
                  className={`rounded-full px-3 py-1 text-lg transition hover:bg-white/10 ${
                    story.viewerReaction === r ? 'bg-white/20' : ''
                  }`}
                >
                  {REACTION_GLYPH[r]}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = reply.trim();
                if (text) sendReply.mutate({ storyId: story._id, text });
              }}
            >
              <Input
                placeholder="Reply to story…"
                value={reply}
                maxLength={1000}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                onChange={(e) => setReply(e.target.value)}
              />
              <Button type="submit" disabled={!reply.trim() || sendReply.isPending}>
                {sendReply.isPending ? <Spinner size={16} /> : 'Send'}
              </Button>
            </form>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete story"
        description="This story will be removed permanently."
        confirmLabel="Delete"
        destructive
        loading={removeStory.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && removeStory.mutate(deleteTarget)}
      />
    </div>
  );
}

/* -------------------------------------------------------------- composer */

function CreateStoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<'text' | 'image' | 'video'>('text');
  const [text, setText] = useState('');
  const [media, setMedia] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [hashtags, setHashtags] = useState('');
  const [duration, setDuration] = useState(15);

  useEffect(() => {
    if (!open) {
      setType('text');
      setText('');
      setMedia('');
      setPrivacy('public');
      setHashtags('');
      setDuration(15);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const content: Record<string, unknown> = {};
      if (text.trim()) content.text = text.trim();
      if (type !== 'text') content.media = media.trim();
      const tags = hashtags
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, '').trim().toLowerCase())
        .filter(Boolean);
      const { data } = await api.post('/story', {
        type,
        privacy,
        content,
        duration,
        hashtags: tags,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Story published');
      qc.invalidateQueries({ queryKey: ['stories'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not publish the story')),
  });

  const valid = type === 'text' ? text.trim().length > 0 : media.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title="Create a story">
      <div className="space-y-4">
        <div className="flex gap-2">
          {(['text', 'image', 'video'] as const).map((t) => (
            <Button
              key={t}
              variant={type === t ? 'primary' : 'ghost'}
              onClick={() => setType(t)}
            >
              {t}
            </Button>
          ))}
        </div>

        {type !== 'text' && (
          <Input
            placeholder={`${type} media key or URL`}
            value={media}
            onChange={(e) => setMedia(e.target.value)}
          />
        )}

        <Textarea
          rows={3}
          placeholder={type === 'text' ? 'What is on your mind?' : 'Optional caption'}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
        />

        <Input
          placeholder="Hashtags (space separated)"
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-[var(--color-muted)]">
            Audience
            <select
              className="input-base"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value)}
            >
              <option value="public">Public</option>
              <option value="followers">Followers</option>
              <option value="friends">Friends</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-[var(--color-muted)]">
            Duration (seconds)
            <input
              type="number"
              min={1}
              max={60}
              className="input-base"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) || 15)}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner size={16} /> : 'Publish'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- highlights */

function CreateHighlightModal({
  open,
  onClose,
  archive,
}: {
  open: boolean;
  onClose: () => void;
  archive: Story[];
}) {
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
    onError: (e) => toast.error(errMsg(e, 'Could not create the highlight')),
  });

  return (
    <Modal open={open} onClose={onClose} title="New highlight">
      <div className="space-y-4">
        <Input
          placeholder="Highlight title"
          maxLength={60}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          rows={2}
          placeholder="Description (optional)"
          maxLength={280}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-xs text-[var(--color-muted)]">
          Choose stories from your archive ({storyIds.length} selected).
        </p>
        <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto">
          {archive.length === 0 && (
            <p className="col-span-3 text-sm text-[var(--color-muted)]">
              Your archive is empty.
            </p>
          )}
          {archive.map((s) => {
            const on = storyIds.includes(s._id);
            return (
              <button
                key={s._id}
                type="button"
                onClick={() =>
                  setStoryIds((prev) =>
                    prev.includes(s._id) ? prev.filter((x) => x !== s._id) : [...prev, s._id],
                  )
                }
                className={`relative aspect-[9/16] overflow-hidden rounded-lg border-2 ${
                  on ? 'border-[var(--color-brand)]' : 'border-transparent'
                }`}
              >
                {s.content?.media ? (
                  <img
                    src={mediaUrl(s.content.media)}
                    alt="archived story"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-[var(--color-surface-2)] p-1 text-[10px]">
                    {s.content?.text?.slice(0, 40) || 'Story'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={title.trim().length < 1 || storyIds.length === 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner size={16} /> : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------- page */

export default function Stories() {
  const me = useAuth((s) => s.user);
  const [tab, setTab] = useState('tray');
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);

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

  const groups = useMemo(() => tray.data || [], [tray.data]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Stories</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Share moments that disappear after 24 hours.
          </p>
        </div>
        <Button onClick={() => setComposerOpen(true)}>Create story</Button>
      </header>

      <Tabs
        tabs={[
          { value: 'tray', label: 'Recent' },
          { value: 'archive', label: 'Archive' },
          { value: 'highlights', label: 'Highlights' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'tray' && (
        <Card className="p-4">
          {tray.isLoading && (
            <div className="flex gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-20 rounded-full" />
              ))}
            </div>
          )}
          {tray.isError && (
            <ErrorState message={errMsg(tray.error)} onRetry={() => tray.refetch()} />
          )}
          {tray.isSuccess && groups.length === 0 && (
            <EmptyState
              icon={<Play />}
              title="No stories right now"
              description="Be the first to post a story today."
            />
          )}
          {groups.length > 0 && (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {groups.map((g, i) => {
                const unseen = g.stories.some((s) => !s.hasViewed);
                return (
                  <button
                    key={g.author._id}
                    type="button"
                    onClick={() => setViewerAt(i)}
                    className="flex w-20 shrink-0 flex-col items-center gap-2"
                  >
                    <span
                      className={`rounded-full p-[2px] ${
                        unseen
                          ? 'bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-2)]'
                          : 'bg-[var(--color-line)]'
                      }`}
                    >
                      <span className="block rounded-full border-2 border-[var(--color-surface)]">
                        <Avatar
                          src={mediaUrl(g.author.avatar)}
                          name={g.author.fullName || g.author.username}
                          size={64}
                        />
                      </span>
                    </span>
                    <span className="w-full truncate text-center text-xs text-[var(--color-muted)]">
                      {g.author.username || g.author.fullName}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === 'archive' && (
        <Card className="p-4">
          {archive.isLoading && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[9/16] w-full" />
              ))}
            </div>
          )}
          {archive.isError && (
            <ErrorState message={errMsg(archive.error)} onRetry={() => archive.refetch()} />
          )}
          {archive.isSuccess && (archive.data?.length || 0) === 0 && (
            <EmptyState
              title="Archive is empty"
              description="Stories you post are archived here after they expire."
            />
          )}
          {(archive.data?.length || 0) > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {archive.data!.map((s) => (
                <div
                  key={s._id}
                  className="relative aspect-[9/16] overflow-hidden rounded-xl bg-[var(--color-surface-2)]"
                >
                  {s.content?.media ? (
                    <img
                      src={mediaUrl(s.content.media)}
                      alt="archived story"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs">
                      {s.content?.text}
                    </span>
                  )}
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    {s.viewCount ?? 0} views
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'highlights' && (
        <Card className="space-y-4 p-4">
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setHighlightOpen(true)}>
              New highlight
            </Button>
          </div>
          {highlights.isLoading && (
            <div className="flex gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-20 rounded-full" />
              ))}
            </div>
          )}
          {highlights.isError && (
            <ErrorState
              message={errMsg(highlights.error)}
              onRetry={() => highlights.refetch()}
            />
          )}
          {highlights.isSuccess && (highlights.data?.length || 0) === 0 && (
            <EmptyState
              title="No highlights yet"
              description="Group your favourite stories into permanent highlights."
            />
          )}
          <div className="flex flex-wrap gap-5">
            {(highlights.data || []).map((h) => (
              <div key={h._id} className="w-20 text-center">
                <div className="h-20 w-20 overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)]">
                  {h.coverImage ? (
                    <img
                      src={mediaUrl(h.coverImage)}
                      alt={h.title}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs">{h.title}</p>
                <p className="text-[10px] text-[var(--color-muted)]">{h.storyCount ?? 0}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {viewerAt !== null && groups.length > 0 && (
        <StoryViewer
          groups={groups}
          startGroup={viewerAt}
          onClose={() => setViewerAt(null)}
        />
      )}

      <CreateStoryModal open={composerOpen} onClose={() => setComposerOpen(false)} />
      <CreateHighlightModal
        open={highlightOpen}
        onClose={() => setHighlightOpen(false)}
        archive={archive.data || []}
      />
    </div>
  );
}
