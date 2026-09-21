/**
 * The author's results for one sticker: who voted for what, who slid where,
 * who answered — and, for a question, the one action the API calls "share
 * results".
 *
 * "Share results" is not a read. `POST
 * /story/:storyId/stickers/:stickerId/share-results { responseId }` posts a
 * NEW text story carrying the prompt and that one answer's words, with the
 * responder's name and photo stripped server-side. So the button on an
 * answer row reads "Share" and the confirmation says a story was posted —
 * anything vaguer would leave the author guessing whether they had just
 * published someone's words.
 *
 * Blocked respondents are excluded from the list by the query, so `total`
 * and the paging are exact while `sticker.results.count` still counts every
 * response — the two numbers can differ, and the sheet shows the list's own.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  fetchStickerResults,
  optionShare,
  shareStickerResults,
  stickerErrorCopy,
  storyKeys,
  type StickerRespondent,
  type StorySticker,
} from '../../lib/stories';
import { Avatar, Button, EmptyState, ErrorState, Modal, Skeleton, cx, useToast } from '../ui';
import { Send, Smile } from '../icons';

const respondentName = (r: StickerRespondent) => r.user?.fullName?.trim() || r.user?.username || 'Vybe user';

const when = (iso?: string) => {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** What one respondent did, in the sticker's own words. */
function ResponseValue({ sticker, respondent }: { sticker: StorySticker | null; respondent: StickerRespondent }) {
  if (respondent.kind === 'answer') {
    return <p className="whitespace-pre-wrap break-words text-sm text-text-1">{respondent.text}</p>;
  }
  if (respondent.kind === 'vote') {
    const label = respondent.optionText ?? (typeof respondent.option === 'number' ? sticker?.options?.[respondent.option]?.text : undefined);
    return <p className="text-sm text-text-1">{label || 'Voted'}</p>;
  }
  if (respondent.kind === 'slide') {
    return (
      <p className="tabular text-sm text-text-1">
        {sticker?.emoji ? `${sticker.emoji} ` : ''}
        {respondent.value}
      </p>
    );
  }
  if (respondent.kind === 'reminder') return <p className="text-sm text-text-2">Set a reminder</p>;
  return <p className="text-sm text-text-2">Joined</p>;
}

/** The tally at the top: poll bars, the slider average, or a plain count. */
function Tally({ sticker }: { sticker: StorySticker | null }) {
  const results = sticker?.results;
  if (!sticker || !results || !results.count) return null;
  if (sticker.kind === 'poll') {
    return (
      <ul className="space-y-1.5" aria-label="Vote share">
        {(sticker.options || []).map((option, i) => {
          const share = optionShare(results, i);
          const count = results.optionCounts?.[i] ?? 0;
          return (
            <li key={i}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-text-1">{option.text}</span>
                <span className="tabular shrink-0 text-xs font-semibold text-text-2">
                  {share}% · {count}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-brand transition-[width] dur-2 ease-out" style={{ width: `${share}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  if (sticker.kind === 'slider' && typeof results.average === 'number') {
    return (
      <p className="tabular text-sm text-text-2">
        Average <span className="font-semibold text-text-1">{results.average}</span> of 100
      </p>
    );
  }
  return null;
}

export function StickerResultsSheet({
  storyId,
  sticker,
  open,
  onClose,
}: {
  storyId: string | null;
  sticker: StorySticker | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [shared, setShared] = useState<Set<string>>(() => new Set());
  const stickerId = sticker?._id || null;

  const q = useQuery({
    queryKey: storyKeys.stickerResults(storyId || '', stickerId || ''),
    enabled: open && !!storyId && !!stickerId,
    queryFn: () => fetchStickerResults(storyId!, stickerId!),
  });

  const share = useMutation({
    mutationFn: async (responseId: string) => {
      await shareStickerResults(storyId!, stickerId!, responseId);
      return responseId;
    },
    onSuccess: (responseId) => {
      setShared((prev) => new Set(prev).add(responseId));
      toast.success('Shared as a new story');
      qc.invalidateQueries({ queryKey: storyKeys.tray });
    },
    onError: (e) => toast.error(null, stickerErrorCopy(e, 'Could not share that answer.')),
  });

  // The fetched sticker is the author view (it always carries results);
  // the one passed in is the copy already on screen.
  const view = q.data?.sticker || sticker;
  const respondents = q.data?.respondents || [];
  const canShare = view?.kind === 'question';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={view?.text || 'Sticker results'}
      description={
        view?.kind === 'poll'
          ? 'Who voted for what. Only you can see this.'
          : view?.kind === 'question'
            ? 'Answers to your question. Share one and it goes out without a name.'
            : 'Only you can see this.'
      }
    >
      <div className="space-y-4">
        <Tally sticker={view ?? null} />

        {q.isPending ? (
          <div className="space-y-3 py-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} title="Results didn’t load" onRetry={() => q.refetch()} className="py-6" />
        ) : respondents.length === 0 ? (
          <EmptyState
            size="sm"
            variant="no-results"
            icon={<Smile size={22} />}
            title="No responses yet"
            message="They land here the moment someone taps your sticker."
          />
        ) : (
          <ul className="divide-y divide-line" aria-label="Responses">
            {respondents.map((r) => {
              const name = respondentName(r);
              const done = shared.has(r._id);
              return (
                <li key={r._id} className="flex items-start gap-3 py-2.5">
                  {r.user ? (
                    <Link to={`/u/${r.user._id}`} viewTransition aria-label={name} className="-m-1 shrink-0 rounded-full p-1">
                      <Avatar src={r.user.avatar} name={name} size="md" />
                    </Link>
                  ) : (
                    <Avatar name={name} size="md" />
                  )}
                  <div className="min-w-0 flex-1">
                    {r.user ? (
                      <Link to={`/u/${r.user._id}`} viewTransition className="block truncate text-sm font-semibold text-text-1 hover:underline">
                        {name}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm font-semibold text-text-1">{name}</span>
                    )}
                    <ResponseValue sticker={view ?? null} respondent={r} />
                    <p className="mt-0.5 text-xs text-text-3">{when(r.createdAt)}</p>
                  </div>
                  {canShare && r.kind === 'answer' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Send size={16} />}
                      disabled={done}
                      loading={share.isPending && share.variables === r._id}
                      onClick={() => share.mutate(r._id)}
                      className={cx('shrink-0', done && 'opacity-60')}
                    >
                      {done ? 'Shared' : 'Share'}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {q.data?.hasNextPage ? (
          <p className="text-center text-xs text-text-3">
            Showing the first {respondents.length} of {q.data.total}.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
