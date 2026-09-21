/**
 * "Add to highlight", from inside the viewer: pick one of the author's
 * collections, or make a new one seeded with the story on screen.
 *
 * Both writes answer with `{ success, message }` and nothing else — no
 * highlight object — so the sheet refetches the list rather than patching a
 * row it would have had to invent (`controllers/storyController.js
 * addStoryToHighlight`).
 *
 * Adding an expired story to a highlight is how it stays readable past its
 * 24 hours; removing the last highlight returns it to the author-only
 * archive rather than making it live again. The copy says so, because
 * "Remove" otherwise reads like a delete.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HIGHLIGHT_MAX_STORIES,
  addStoryToHighlight,
  createHighlight,
  fetchHighlights,
  highlightsKey,
  type HighlightRow,
} from '../../lib/stories';
import { Button, EmptyState, ErrorState, Input, Modal, Skeleton, Spinner, cx, useToast } from '../ui';
import { Check, Plus, Sparkles } from '../icons';

export function HighlightPicker({
  open,
  onClose,
  storyId,
  ownerId,
}: {
  open: boolean;
  onClose: () => void;
  storyId: string | null;
  /** The author — always the signed-in member here; the API only adds your own stories. */
  ownerId?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [added, setAdded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setTitle('');
      setAdded(new Set());
    }
  }, [open]);

  const list = useQuery({
    queryKey: highlightsKey(ownerId),
    enabled: open && Boolean(ownerId),
    queryFn: () => fetchHighlights(ownerId!),
  });

  const settle = (highlightId: string) => {
    setAdded((prev) => new Set(prev).add(highlightId));
    qc.invalidateQueries({ queryKey: highlightsKey(ownerId) });
    qc.invalidateQueries({ queryKey: ['stories'] });
  };

  const add = useMutation({
    mutationFn: async (highlightId: string) => {
      await addStoryToHighlight(highlightId, storyId!);
      return highlightId;
    },
    onSuccess: (highlightId) => {
      settle(highlightId);
      toast.success('Added to highlight');
    },
    onError: (e) => toast.error(e, 'Could not add it to that highlight.'),
  });

  const make = useMutation({
    mutationFn: async () => createHighlight({ title, storyIds: storyId ? [storyId] : [] }),
    onSuccess: (data) => {
      if (data.highlight?._id) settle(data.highlight._id);
      else qc.invalidateQueries({ queryKey: highlightsKey(ownerId) });
      setCreating(false);
      setTitle('');
      toast.success('Highlight created');
    },
    onError: (e) => toast.error(e, 'Could not create the highlight.'),
  });

  const highlights = list.data || [];
  const busyId = add.isPending ? (add.variables as string) : null;

  const rowFor = (h: HighlightRow) => {
    const count = h.storyCount ?? 0;
    const done = added.has(h._id);
    const full = count >= HIGHLIGHT_MAX_STORIES;
    return (
      <li key={h._id}>
        <button
          type="button"
          disabled={done || full || add.isPending}
          onClick={() => add.mutate(h._id)}
          aria-label={done ? `${h.title} — added` : `Add to ${h.title}`}
          className={cx(
            'flex min-h-14 w-full items-center gap-3 rounded-md px-2 text-left transition-colors dur-1',
            done ? 'cursor-default' : 'hover:bg-surface-2',
          )}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-text-3">
            <Sparkles size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-text-1">{h.title}</span>
            {count > 0 ? (
              <span className="tabular block text-xs text-text-2">
                {count} {count === 1 ? 'story' : 'stories'}
                {full ? ' · full' : ''}
              </span>
            ) : null}
          </span>
          {busyId === h._id ? (
            <Spinner size={16} className="shrink-0 text-brand" />
          ) : done ? (
            <Check size={18} className="shrink-0 text-success" />
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Add to highlight"
      description="A highlight keeps a story on your profile after it expires."
    >
      <div className="space-y-3">
        {creating ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) make.mutate();
            }}
          >
            <Input label="Title" placeholder="Marathon block" maxLength={60} value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={make.isPending}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!title.trim()} loading={make.isPending}>
                Create and add
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" icon={<Plus size={18} />} onClick={() => setCreating(true)} className="w-full">
            New highlight
          </Button>
        )}

        {list.isPending ? (
          <ul className="space-y-1" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <ErrorState error={list.error} title="Highlights didn’t load" onRetry={() => list.refetch()} className="py-4" />
        ) : highlights.length ? (
          <ul aria-label="Your highlights">{highlights.map(rowFor)}</ul>
        ) : creating ? null : (
          <EmptyState
            size="sm"
            title="No highlights yet"
            message="Make one and this story is its first."
            action={{ label: 'New highlight', onClick: () => setCreating(true), icon: <Plus size={18} /> }}
          />
        )}
      </div>
    </Modal>
  );
}
