import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { isStoryExpired, storyFontStyle } from '../lib/storyLogic';
import {
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
  Skeleton,
  Spinner,
  Textarea,
  cx,
  formatStat,
  useToast,
} from './ui';
import { Check, Eye, Plus, Trash, Video as VideoIcon } from './icons';
import {
  CreateStoryModal,
  HighlightCover,
  StoryTray,
  StoryViewer,
  ago,
  asStoryAuthor,
  highlightsKey,
  useHighlights,
  useOpenHighlight,
  type Highlight,
  type Story,
  type ViewerTarget,
} from './StoryTray';

/* ------------------------------------------------------------- highlights */

function CreateHighlightModal({ open, onClose, stories, loading }: { open: boolean; onClose: () => void; stories: Story[]; loading: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
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
      toast.success('Highlight created', { action: { label: 'View profile', onClick: () => navigate('/profile') } });
      qc.invalidateQueries({ queryKey: highlightsKey(me?._id) });
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
      description="Pick any of your stories — live or expired — to keep on your profile."
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
          {loading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[9/16] w-full rounded-md" />
              ))}
            </div>
          ) : stories.length === 0 ? (
            <p className="rounded-sm bg-surface-2 p-4 text-sm text-text-2">You haven’t posted a story yet. Post one and it can go into a highlight right away.</p>
          ) : (
            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-4" role="group" aria-labelledby="highlight-picker-label">
              {stories.map((s) => {
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
                    {!isStoryExpired(s) ? (
                      <Badge tone="brand" size="sm" className="absolute left-1 top-1 shadow-1">
                        Live
                      </Badge>
                    ) : null}
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
const isTab = (v: string | null): v is 'tray' | 'archive' | 'highlights' => v === 'tray' || v === 'archive' || v === 'highlights';

export default function Stories() {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = isTab(params.get('tab')) ? params.get('tab')! : 'tray';
  const setTab = (next: string) =>
    setParams(
      (prev) => {
        if (next === 'tray') prev.delete('tab');
        else prev.set('tab', next);
        prev.delete('new');
        return prev;
      },
      { replace: true },
    );
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [deleteHighlight, setDeleteHighlight] = useState<Highlight | null>(null);

  // /stories?tab=highlights&new=1 (the "New" bubble on the profile) opens the picker once.
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (!wantsNew) return;
    setHighlightOpen(true);
    setParams(
      (prev) => {
        prev.delete('new');
        return prev;
      },
      { replace: true },
    );
  }, [wantsNew, setParams]);

  const archive = useQuery({
    queryKey: ['stories', 'archive'],
    enabled: tab === 'archive' || highlightOpen,
    queryFn: async () => {
      const { data } = await api.get('/story/archive');
      return (data.stories || []) as Story[];
    },
  });

  const highlights = useHighlights(me?._id, tab === 'highlights');
  const meAsAuthor = asStoryAuthor(me);
  const { open: openHighlight, loadingId } = useOpenHighlight(meAsAuthor, setViewer);

  const removeHighlight = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/story/highlights/${id}`);
    },
    onSuccess: () => {
      toast.success('Highlight deleted');
      setDeleteHighlight(null);
      qc.invalidateQueries({ queryKey: highlightsKey(me?._id) });
    },
    onError: (e) => {
      toast.error(e, 'Could not delete the highlight.');
      setDeleteHighlight(null);
    },
  });

  // The Archive holds what has expired (as its copy says); live stories are in Recent.
  const { expired, liveCount } = useMemo(() => {
    const all = archive.data || [];
    const gone = all.filter((s) => isStoryExpired(s));
    return { expired: gone, liveCount: all.length - gone.length };
  }, [archive.data]);

  const openComposer = () => setComposerOpen(true);

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

        {tab === 'tray' ? <StoryTray variant="page" /> : null}

        {tab === 'archive' ? (
          <section aria-label="Archived stories" className="space-y-3">
            {archive.isLoading ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5" aria-busy="true">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[9/16] w-full rounded-md" />
                ))}
              </div>
            ) : archive.isError ? (
              <ErrorState error={archive.error} title="Couldn’t load your archive" onRetry={() => archive.refetch()} />
            ) : expired.length === 0 ? (
              <EmptyState
                title="Your archive is empty"
                message={
                  liveCount > 0
                    ? `${liveCount} ${liveCount === 1 ? 'story is' : 'stories are'} still live under Recent. Stories land here after they expire.`
                    : 'Stories you post land here after they expire.'
                }
                action={{ label: liveCount > 0 ? 'See recent' : 'New story', onClick: liveCount > 0 ? () => setTab('tray') : openComposer, icon: <Plus size={18} /> }}
              />
            ) : (
              <>
                {liveCount > 0 ? (
                  <p className="text-xs text-text-2">
                    {liveCount} {liveCount === 1 ? 'story is' : 'stories are'} still live —{' '}
                    <button type="button" onClick={() => setTab('tray')} className="font-semibold text-brand-text hover:underline">
                      see Recent
                    </button>
                    .
                  </p>
                ) : null}
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {expired.map((s) => (
                    <li key={s._id}>
                      <button
                        type="button"
                        onClick={() => meAsAuthor && setViewer({ groups: [{ author: s.author || meAsAuthor, stories: [s] }], start: 0, startStory: 0 })}
                        aria-label={`Open story from ${ago(s.createdAt) || 'your archive'}`}
                        className="relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-surface-2 transition-transform dur-1 hover:scale-[1.02]"
                      >
                        {s.content?.media && s.type !== 'video' ? (
                          <img src={mediaUrl(s.content.media)} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : s.type === 'video' ? (
                          <video src={mediaUrl(s.content?.media)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                        ) : (
                          <span
                            className="flex h-full w-full items-center justify-center p-2 text-center text-xs"
                            style={{
                              background: s.content?.backgroundColor || 'var(--navy-800)',
                              color: s.content?.textColor || 'var(--navy-50)',
                              ...storyFontStyle(s.content?.font),
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
              </>
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
                message="Group stories into a collection that doesn’t expire. It shows on your profile for everyone who can see it."
                action={{ label: 'New highlight', onClick: () => setHighlightOpen(true), icon: <Plus size={18} /> }}
              />
            ) : (
              <ul className="flex flex-wrap gap-5">
                {(highlights.data || []).map((h) => {
                  const n = h.storyCount ?? h.stories?.length ?? 0;
                  return (
                    <li key={h._id} className="flex w-24 flex-col items-center text-center">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => void openHighlight(h)}
                          aria-label={`Open highlight ${h.title} (${n} ${n === 1 ? 'story' : 'stories'})`}
                          aria-busy={loadingId === h._id || undefined}
                          className="relative block rounded-full transition-transform dur-1 hover:scale-[1.03]"
                        >
                          <HighlightCover highlight={h} size={80} />
                          {loadingId === h._id ? (
                            <span className="absolute inset-0 grid place-items-center rounded-full bg-scrim text-[var(--navy-50)]">
                              <Spinner size={20} />
                            </span>
                          ) : null}
                        </button>
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
        <StoryViewer groups={viewer.groups} startGroup={viewer.start} startStory={viewer.startStory} onClose={() => setViewer(null)} />
      ) : null}

      <CreateStoryModal open={composerOpen} onClose={() => setComposerOpen(false)} />
      <CreateHighlightModal open={highlightOpen} onClose={() => setHighlightOpen(false)} stories={archive.data || []} loading={archive.isLoading} />

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
