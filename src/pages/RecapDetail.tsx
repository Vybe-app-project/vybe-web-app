import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, parseApiError } from '../lib/api';
import type { Post } from '../lib/hooks';
import { useUnits, weightUnit } from '../lib/units';
import {
  Button,
  Callout,
  Checkbox,
  EmptyState,
  ErrorState,
  IconButton,
  Modal,
  PageHeader,
  Skeleton,
  SkeletonRow,
  SkeletonTile,
  StatGrid,
  Textarea,
  useToast,
} from './ui';
import { Share } from './icons';
import { RecapBody } from './RecapBody';
import {
  HIDDEN_FIELDS,
  HIDDEN_FIELD_HELP,
  HIDDEN_FIELD_LABELS,
  LOCKED_SHARE_MESSAGE,
  canShare,
  recapTitle,
  runningBadge,
  sharePostBody,
  type HiddenField,
  type RecapView,
} from '../lib/recapView';

/**
 * One recap, owner-only (/recaps/:id; the mobile deep link
 * https://vybeapp.fit/recaps/<id> lands here too). The API answers 404 for
 * another member's recap as well as for an unknown or malformed id, so the
 * not-found state says both. Opening a recap marks it viewed once; sharing
 * creates the post first and records the share second, best effort.
 */

const CAPTION_MAX = 2000;

const statusOf = (e: unknown) => parseApiError(e).status;
/** Nothing to gain from a retry: absent, someone else's, or a malformed id. */
const isFinal = (e: unknown) => {
  const status = statusOf(e);
  return status === 400 || status === 403 || status === 404;
};

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <StatGrid columns={4}>
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
      </StatGrid>
      <Skeleton className="h-24 w-full rounded-md" />
      <SkeletonRow className="card px-4" />
      <SkeletonRow className="card px-4" />
    </div>
  );
}

export default function RecapDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const system = useUnits((s) => s.system);
  const unit = weightUnit(system);

  const query = useQuery({
    queryKey: ['recap', id],
    enabled: !!id,
    retry: (count, e) => !isFinal(e) && count < 2,
    queryFn: async () => {
      const { data } = await api.get(`/recaps/${id}`);
      return data.recap as RecapView;
    },
  });
  const recap = query.data;

  // Mark viewed once per open: only while the API says viewedAt is null, and
  // once per recap id even when StrictMode runs the effect twice.
  const viewedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!recap || recap.viewedAt || viewedFor.current === recap._id) return;
    viewedFor.current = recap._id;
    api.post(`/recaps/${id}/viewed`)
      .then(({ data }) => {
        const stamp = (data as { recap?: { viewedAt?: unknown } } | undefined)?.recap?.viewedAt;
        const viewedAt = typeof stamp === 'string' ? stamp : new Date().toISOString();
        qc.setQueryData<RecapView>(['recap', id], (old) => (old ? { ...old, viewedAt } : old));
        void qc.invalidateQueries({ queryKey: ['recaps'] });
      })
      .catch(() => {
        // A missed view mark is not the member's problem; nothing to show.
      });
  }, [recap, id, qc]);

  /* ---------------------------------------------------------- share dialog */
  const [shareOpen, setShareOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [hidden, setHidden] = useState<HiddenField[]>([]);
  const [shareError, setShareError] = useState<{ message: string; field: string | null } | null>(null);

  const toggleHidden = (field: HiddenField, next: boolean) => {
    setHidden((prev) => (next ? (prev.includes(field) ? prev : [...prev, field]) : prev.filter((f) => f !== field)));
  };

  const openShare = () => {
    setShareError(null);
    setShareOpen(true);
  };

  const share = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/posts/create', sharePostBody({ recapId: id, caption, hiddenFields: hidden }));
      const post = ((data as { post?: Post }).post ?? data) as Post;
      try {
        await api.post(`/recaps/${id}/shared`, { destination: 'vybe', variant: 'feed' });
      } catch {
        // The post exists; recording the share is best effort.
      }
      return post;
    },
    onSuccess: (post) => {
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: ['recap', id] });
      void qc.invalidateQueries({ queryKey: ['recaps'] });
      setShareOpen(false);
      toast.success('Recap shared');
      navigate(`/p/${post._id}`, { viewTransition: true });
    },
    onError: (e) => {
      const parsed = parseApiError(e, 'Could not share this recap.');
      setShareError({ message: errMsg(e, 'Could not share this recap.'), field: parsed.field });
    },
  });

  /* ---------------------------------------------------------- states */
  if (query.isLoading) {
    return (
      <>
        <PageHeader title="Recap" back="/recaps" />
        <DetailSkeleton />
      </>
    );
  }

  if (query.isError || !recap) {
    const status = query.isError ? statusOf(query.error) : null;
    if (status === 403) {
      return (
        <>
          <PageHeader title="Recap" back="/recaps" />
          <EmptyState
            variant="no-results"
            title="This recap isn’t yours"
            message="Only the person it belongs to can open it."
            action={{ label: 'Your recaps', to: '/recaps' }}
          />
        </>
      );
    }
    if (status === 404 || status === 400 || !recap) {
      return (
        <>
          <PageHeader title="Recap" back="/recaps" />
          <EmptyState
            variant="no-results"
            title="We couldn’t find that recap"
            message="It may belong to someone else, or the link may be old."
            action={{ label: 'Your recaps', to: '/recaps' }}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Recap" back="/recaps" />
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      </>
    );
  }

  const shareable = canShare(recap);
  const running = runningBadge(recap);
  const subtitle = running ? `${recapTitle(recap.kind)} · ${running}` : recapTitle(recap.kind);
  const captionError = shareError && shareError.field === 'content' ? shareError.message : null;
  const generalError = shareError && shareError.field !== 'content' ? shareError.message : null;

  return (
    <>
      <PageHeader
        title={recap.periodLabel}
        subtitle={subtitle}
        back="/recaps"
        actions={
          <Button
            variant="primary"
            icon={<Share size={18} />}
            onClick={openShare}
            disabled={!shareable}
            title={shareable ? undefined : LOCKED_SHARE_MESSAGE}
            data-testid="recap-share-button"
          >
            Share as a post
          </Button>
        }
        mobileActions={
          <IconButton label="Share as a post" onClick={openShare} disabled={!shareable} title={shareable ? undefined : LOCKED_SHARE_MESSAGE}>
            <Share size={20} />
          </IconButton>
        }
      />

      <RecapBody recap={recap} unit={unit} />

      <Modal
        open={shareOpen}
        onClose={() => {
          if (!share.isPending) setShareOpen(false);
        }}
        title="Share as a post"
        description="The card carries your sessions, time, records and most trained exercises. Gyms and buddies never appear on a card."
        size="sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setShareOpen(false)} disabled={share.isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => share.mutate()} loading={share.isPending} icon={<Share size={18} />} data-testid="recap-share-confirm">
              Share
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <fieldset className="space-y-0.5">
            <legend className="mb-1 text-sm font-semibold text-text-1">What to leave off</legend>
            {HIDDEN_FIELDS.map((field) => (
              <Checkbox
                key={field}
                checked={hidden.includes(field)}
                onChange={(next) => toggleHidden(field, next)}
                label={HIDDEN_FIELD_LABELS[field]}
                description={HIDDEN_FIELD_HELP[field]}
                disabled={share.isPending}
              />
            ))}
          </fieldset>
          <Textarea
            label="Caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={CAPTION_MAX}
            rows={3}
            autoGrow
            placeholder="Say something about the week"
            error={captionError}
            disabled={share.isPending}
          />
          {generalError ? <Callout tone="danger">{generalError}</Callout> : null}
        </div>
      </Modal>
    </>
  );
}
