import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, useToast } from '../../components/ui';
import { AdminPageHeader, Pager } from './AdminLayout';

const KINDS = [
  { id: 'post', label: 'Posts' },
  { id: 'comment', label: 'Comments' },
  { id: 'message', label: 'Messages' },
  { id: 'bio', label: 'Bios' },
  { id: 'story', label: 'Stories' },
] as const;

type Kind = (typeof KINDS)[number]['id'];

type QueueAuthor = { id?: string; username?: string; fullName?: string } | null;

type QueueItem = {
  kind: Kind;
  id: string;
  text: string;
  currentText?: string;
  author: QueueAuthor;
  matchedTerms: string[];
  heldAt: string | null;
  createdAt: string | null;
};

type QueuePage = {
  items: QueueItem[];
  total: number;
  page: number;
  hasNextPage: boolean;
  pendingCounts: Partial<Record<Kind, number>>;
};

const authorLabel = (author: QueueAuthor) => author?.username || author?.fullName || author?.id || 'Unknown author';

export default function AdminModeration() {
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('post');
  const [page, setPage] = useState(1);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const queue = useQuery<QueuePage>({
    queryKey: ['admin', 'moderation', kind, page],
    queryFn: async () => {
      const { data } = await adminApi.get('/admin/moderation/pending', { params: { kind, page, limit: 20 } });
      return {
        items: Array.isArray(data?.items) ? data.items : [],
        total: Number(data?.total) || 0,
        page: Number(data?.page) || page,
        hasNextPage: Boolean(data?.hasNextPage),
        pendingCounts: data?.pendingCounts && typeof data.pendingCounts === 'object' ? data.pendingCounts : {},
      };
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => {
      const body = { note: note.trim() || undefined };
      // Literal paths so scripts/audit-api-contracts.cjs can match each call to
      // POST /api/admin/moderation/:kind/:id/approve|reject.
      if (decision === 'approve') {
        await adminApi.post(`/admin/moderation/${kind}/${id}/approve`, body);
      } else {
        await adminApi.post(`/admin/moderation/${kind}/${id}/reject`, body);
      }
    },
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: (_data, { decision }) => {
      toast.success(decision === 'approve' ? 'Published' : 'Rejected');
      setNote('');
      void qc.invalidateQueries({ queryKey: ['admin', 'moderation'] });
    },
    onError: (error) => toast.error(error, 'Could not record that decision.'),
    onSettled: () => setBusyId(null),
  });

  const counts = queue.data?.pendingCounts ?? {};

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Review queue"
        subtitle="Writes the filter held before they were published. Approving makes them visible. Rejecting keeps them off everyone else's screens."
        meta={<Badge tone="warning">{queue.data?.total ?? 0} in this list</Badge>}
      />

      <div className="flex flex-wrap gap-2">
        {KINDS.map((entry) => (
          <Button
            key={entry.id}
            variant={entry.id === kind ? 'primary' : 'secondary'}
            onClick={() => {
              setKind(entry.id);
              setPage(1);
            }}
          >
            {entry.label}
            {typeof counts[entry.id] === 'number' ? ` (${counts[entry.id]})` : ''}
          </Button>
        ))}
      </div>

      <label className="block text-sm text-text-2">
        Note for the audit log
        <textarea
          className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-1"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      {queue.isLoading ? <Skeleton className="h-40 w-full" /> : null}
      {queue.isError ? <ErrorState title="Could not load the queue" onRetry={() => void queue.refetch()} /> : null}
      {queue.data && queue.data.items.length === 0 ? (
        <EmptyState title="Nothing is waiting" description="New holds show up here as soon as a write matches the filter." />
      ) : null}

      <div className="space-y-3">
        {queue.data?.items.map((item) => (
          <Card key={item.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-text-1">{authorLabel(item.author)}</p>
                <p className="text-xs text-text-2">{item.kind} · {item.id}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={busyId === item.id}
                  onClick={() => decide.mutate({ id: item.id, decision: 'approve' })}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  disabled={busyId === item.id}
                  onClick={() => decide.mutate({ id: item.id, decision: 'reject' })}
                >
                  Reject
                </Button>
              </div>
            </div>
            {item.currentText ? (
              <p className="text-sm text-text-2">Live text: {item.currentText}</p>
            ) : null}
            <p className="whitespace-pre-wrap text-sm text-text-1">{item.text || 'No text'}</p>
            {item.matchedTerms.length > 0 ? (
              <p className="text-xs text-text-2">Matched: {item.matchedTerms.join(', ')}</p>
            ) : null}
          </Card>
        ))}
      </div>

      {queue.data ? (
        <Pager
          page={page}
          canPrev={page > 1}
          canNext={queue.data.hasNextPage}
          label={`${queue.data.total} held`}
          onPrev={() => setPage((current) => Math.max(1, current - 1))}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
