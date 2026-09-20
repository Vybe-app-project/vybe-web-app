import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useFeature } from '../lib/capabilities';
import {
  ABOUT,
  CHALLENGE_LINK_LINE,
  GYM_LINK_LINE,
  INVITE_ACTION,
  contextualInviteMessage,
  inviteTitleFor,
  isFeatureDisabledError,
  parseContextualInvite,
  type ContextualInvite,
  type ContextualKind,
} from '../lib/inviteFriends';
import { Button, Modal, useToast, type ButtonSize } from './ui';
import { UserPlus } from './icons';
import { InviteLinkBlock, useInviteCopy } from './settings/InviteFriendsSection';

/**
 * Contextual invites (Wave F, design-first-week-and-people.md §3.3): a gym
 * community page or a challenge detail offers "Invite"; POST /invites mints
 * the object's code (201) or answers the one that exists (200), and the sheet
 * shows it with the same code, link and buttons as Settings › Invite friends,
 * titled "Invite to Iron Works". The button owns the flag, the request, the
 * refusal words and the sheet, so a page mounts one element and nothing else.
 */

/** "Invite to <name>": the code, its link and the buttons for one gym or challenge. */
export default function InviteLinkSheet({
  open,
  onClose,
  invite,
  targetName,
  kind,
}: {
  open: boolean;
  onClose: () => void;
  invite: ContextualInvite | null;
  targetName: string;
  kind: ContextualKind;
}) {
  const { copied, canShare, copyCode, copyUrl, share } = useInviteCopy('contextual-invite-code');
  return (
    <Modal open={open} onClose={onClose} size="sm" title={inviteTitleFor(targetName)} description={kind === 'gym' ? GYM_LINK_LINE : CHALLENGE_LINK_LINE}>
      {invite ? (
        <div className="space-y-4">
          <InviteLinkBlock
            codeId="contextual-invite-code"
            code={invite.code}
            url={invite.url}
            canShare={canShare}
            copied={copied}
            onCopyCode={() => void copyCode(invite.code)}
            onCopyLink={() => void copyUrl(invite.url)}
            onShare={() => void share(invite.url)}
          />
          <p className="text-xs text-text-3">{ABOUT}</p>
        </div>
      ) : null}
    </Modal>
  );
}

function ContextualInviteAction({ kind, targetId, targetName, size, className }: { kind: ContextualKind; targetId: string; targetName: string; size: ButtonSize; className?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [invite, setInvite] = useState<ContextualInvite | null>(null);

  useEffect(() => {
    setInvite(null);
  }, [targetId]);

  const mint = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/invites', { kind, targetId });
      const parsed = parseContextualInvite(data);
      if (!parsed) throw new Error('The invite answer was not readable.');
      return parsed;
    },
    onSuccess: (parsed) => setInvite(parsed),
    onError: (e) => {
      // The flag turned off mid-session: hide, refresh the flags, say nothing.
      if (isFeatureDisabledError(e)) {
        void qc.invalidateQueries({ queryKey: ['capabilities'] });
        return;
      }
      // A 429 (INVITE_LIMIT_REACHED) already raised the app-wide rate-limit toast; this one replaces it by key.
      toast.error(contextualInviteMessage(e, kind));
    },
  });

  return (
    <>
      <Button variant="secondary" size={size} className={className} icon={<UserPlus size={16} />} loading={mint.isPending} onClick={() => mint.mutate()}>
        {INVITE_ACTION}
      </Button>
      <InviteLinkSheet open={Boolean(invite)} invite={invite} targetName={targetName} kind={kind} onClose={() => setInvite(null)} />
    </>
  );
}

/**
 * The "Invite" button for a gym community or a challenge. Renders nothing
 * while features.invites is false or there is no target yet. The community
 * and challenge detail bodies do not carry settings.allowInvites, so the
 * button shows for every member and the API's 400 INVITES_NOT_ALLOWED is the
 * honest answer when the object is not taking invites.
 */
export function ContextualInviteButton({
  kind,
  targetId,
  targetName,
  size = 'md',
  className,
}: {
  kind: ContextualKind;
  targetId: string | null | undefined;
  targetName: string;
  size?: ButtonSize;
  className?: string;
}) {
  const enabled = useFeature('invites');
  if (!enabled || !targetId) return null;
  return <ContextualInviteAction kind={kind} targetId={targetId} targetName={targetName} size={size} className={className} />;
}
