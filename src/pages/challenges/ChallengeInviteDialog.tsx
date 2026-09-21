import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { CHALLENGE_INVITE_MAX, inviteToChallenge } from '../../lib/challenges';
import { apiErrorDetails } from '../../lib/apiError';
import { Button, Chip, EmptyState, Modal, useToast } from '../../components/ui';
import PeopleSearch, { personName, rememberPerson, type Person } from '../PeopleSearch';

/**
 * Invite people to a challenge (P8a). `POST /challenges/:id/invite
 * { userIds }` — at most twenty ids a call, the host always, a seated
 * participant too unless the host closed invites.
 *
 * The picker is the one group chat uses (`PeopleSearch` in multi mode,
 * seeded with the friends list); nothing new is built for this and the
 * `['friends', 'list']` key is the one Messages already fills, so opening
 * this dialog after New message costs no request.
 *
 * The answer is not all-or-nothing: `{ notified, skipped: [{ userId,
 * reason }] }`. The toast says how many were told and, when nobody was,
 * why — "already in", "already invited", and the two the server will not
 * explain further (blocked, not visible) fold into one honest sentence
 * rather than naming a block to the person who was blocked.
 */

const SKIP_COPY: Record<string, string> = {
  already_in: 'already in the challenge',
  already_invited: 'already invited',
  full: 'the invite list is full',
};

/** One sentence about the people who were not told, without ever revealing a block. */
export function skippedSentence(skipped: readonly { userId: string; reason: string }[]): string | null {
  if (!skipped.length) return null;
  const counts = new Map<string, number>();
  for (const row of skipped) {
    const key = SKIP_COPY[row.reason] ? row.reason : 'unreachable';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([reason, count]) => {
    const who = count === 1 ? '1 person' : `${count} people`;
    return reason === 'unreachable' ? `${who} could not be invited` : `${who} ${SKIP_COPY[reason]}`;
  });
  return parts.join(', ');
}

export default function ChallengeInviteDialog({
  open,
  onClose,
  challengeId,
  challengeTitle,
  /** Ids already seated or already invited: never offered. */
  excludeIds,
  meId,
}: {
  open: boolean;
  onClose: () => void;
  challengeId: string;
  challengeTitle: string;
  excludeIds?: ReadonlySet<string>;
  meId?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setPicked([]);
    }
  }, [open]);

  // The same key and shape the message picker fills, so the list is warm.
  const friends = useQuery({
    queryKey: ['friends', 'list'],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await api.get('/friends/list');
      return (data.friends || []) as Person[];
    },
  });

  const pickedIds = useMemo(() => new Set(picked.map((p) => p._id)), [picked]);
  const excluded = useMemo(() => {
    const set = new Set<string>(excludeIds ? [...excludeIds] : []);
    if (meId) set.add(meId);
    return set;
  }, [excludeIds, meId]);

  const toggle = (person: Person) =>
    setPicked((prev) => {
      if (prev.some((p) => p._id === person._id)) return prev.filter((p) => p._id !== person._id);
      if (prev.length >= CHALLENGE_INVITE_MAX) {
        toast.info(`You can invite ${CHALLENGE_INVITE_MAX} people at a time.`, { key: 'challenge-invite-cap' });
        return prev;
      }
      return [...prev, person];
    });

  const invite = useMutation({
    mutationFn: () => inviteToChallenge(challengeId, picked.map((p) => p._id)),
    onSuccess: (result) => {
      picked.forEach(rememberPerson);
      const skipped = skippedSentence(result.skipped ?? []);
      if (result.notified > 0) {
        toast.success(
          `Invited ${result.notified === 1 ? '1 person' : `${result.notified} people`}${skipped ? ` · ${skipped}` : ''}`,
        );
      } else {
        toast.info(skipped ?? 'Nobody new to invite.');
      }
      qc.invalidateQueries({ queryKey: ['challenges'] });
      onClose();
    },
    onError: (e) => {
      const details = apiErrorDetails(e);
      // The invite route needs the `invites` flag as well as challengesV2;
      // off, it answers 404 FEATURE_DISABLED with the invites copy.
      if (details.status === 404 && details.code === 'FEATURE_DISABLED') {
        toast.info('Invites arrive with a later update.');
        onClose();
        return;
      }
      toast.error(e, 'Could not send the invites.');
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite to this challenge"
      description={`They get one notice about “${challengeTitle}” and can join from it.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={picked.length === 0 || invite.isPending}
            loading={invite.isPending}
            onClick={() => invite.mutate()}
          >
            {picked.length > 1 ? `Invite ${picked.length}` : 'Invite'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {picked.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Selected people">
            {picked.map((person) => (
              <Chip key={person._id} selected onRemove={() => toggle(person)} removeLabel={`Remove ${personName(person)}`}>
                {personName(person)}
              </Chip>
            ))}
          </div>
        ) : null}

        <PeopleSearch
          query={search}
          onQueryChange={setSearch}
          mode="multi"
          onPick={toggle}
          selectedIds={pickedIds}
          excludeIds={excluded}
          emptyList={friends.data}
          emptyHeading="Friends"
          emptyListLoading={friends.isLoading}
          emptyListError={friends.isError ? friends.error : undefined}
          onRetryEmptyList={() => friends.refetch()}
          emptyState={
            <EmptyState
              size="sm"
              title="No friends yet"
              message="Search anyone on Vybe above, or add friends so they show up here."
              action={{ label: 'Find friends', to: '/friends', variant: 'secondary' }}
            />
          }
          label="Search people"
          placeholder="Search by name or @username"
        />
      </div>
    </Modal>
  );
}
