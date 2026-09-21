import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../lib/api';
import {
  type Actor,
  type LevelView,
  type NotificationLevel,
  type OwnershipView,
  type RolesView,
  NOTIFICATION_LEVELS,
  acceptOwnership,
  cancelOwnershipOffer,
  declineOwnership,
  gymV2Keys,
  isFeatureDisabled,
  leaveAsOwner,
  levelLabel,
  offerCandidates,
  offerOwnership,
  saveNotificationLevel,
} from '../../lib/gymCommunityV2';
import { useReauthGate } from '../settings/useReauthGate';
import { Avatar, Badge, Button, Callout, ConfirmDialog, Modal, RadioGroup, useToast } from '../ui';
import { Award, Bell, Shield, Users } from '../icons';

/**
 * Ownership and the member's own notification level: the two rows the gym's
 * overflow menu gains, and the one row the page grows when an offer is
 * waiting for the viewer (`gymOwnership`, `gymNotificationLevels`;
 * design-gym-community-v2.md §5.4, §5.7).
 *
 * Both surfaces feature-detect through `useGymV2`: with the flag off the
 * reads answer `404 FEATURE_DISABLED`, resolve to `null`, and neither the
 * menu rows nor the offer row are rendered at all.
 *
 * Accepting ownership needs a fresh `X-Reauth` token. The call is made
 * without one first (`waive: true`), so the API's own `401 REAUTH_REQUIRED`
 * names the proofs the account can offer and the shared dialog asks for
 * exactly those — the client never guesses.
 */

export const REGULAR_LABEL = 'Regular';

/** The laurel a member turned on, on a member row or the profile header. Read only: nothing here grants it. */
export function RegularBadge({ className }: { className?: string }) {
  return (
    <Badge tone="accent" className={className}>
      <Award size={12} />
      {REGULAR_LABEL}
    </Badge>
  );
}

/* ------------------------------------------------------------------ notification level */

/** "Notifications: Highlights" → the four levels the API accepts. */
export function NotificationLevelDialog({
  open,
  communityId,
  communityName,
  current,
  onClose,
}: {
  open: boolean;
  communityId: string;
  communityName: string;
  current: LevelView | null | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [level, setLevel] = useState<NotificationLevel>(current?.level ?? 'highlights');

  const save = useMutation({
    mutationFn: () => saveNotificationLevel(communityId, { level }),
    onSuccess: (view) => {
      qc.setQueryData(gymV2Keys.level(communityId), view);
      toast.success(`Notifications from ${communityName}: ${NOTIFICATION_LEVELS.find((row) => row.value === view.level)?.label ?? view.level}`);
      onClose();
    },
    onError: (e) => toast.error(isFeatureDisabled(e) ? 'Notification levels are not available on your account yet.' : errMsg(e, 'Could not save your choice')),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Notifications from ${communityName}`}
      description="What this gym may send you. Your inbox keeps everything either way."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <RadioGroup
        label="Level"
        hideLabel
        value={level}
        onChange={(v) => setLevel(v as NotificationLevel)}
        options={NOTIFICATION_LEVELS.map((row) => ({ value: row.value, label: row.label, description: row.description }))}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ the offer waiting for the viewer */

/**
 * "Sam offered you this gym": the Accept / Decline row the invitee sees at
 * the top of the page while the transfer is open. Accept goes through the
 * re-auth gate; Decline does not (declining needs no proof, and an
 * `auto_offer` simply continues down the chain).
 */
export function OwnershipOfferRow({
  communityId,
  communityName,
  ownership,
}: {
  communityId: string;
  communityName: string;
  ownership: OwnershipView;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const gate = useReauthGate({ methods: undefined });
  const [accepting, setAccepting] = useState(false);
  const offer = ownership.myOffer;
  const from = ownership.owner || ownership.founder;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: gymV2Keys.ownership(communityId) });
    qc.invalidateQueries({ queryKey: gymV2Keys.roles(communityId) });
    qc.invalidateQueries({ queryKey: ['community', communityId] });
  };

  const decline = useMutation({
    mutationFn: () => declineOwnership(communityId),
    onSuccess: () => {
      toast.info('Offer declined');
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not decline the offer')),
  });

  const accept = async () => {
    setAccepting(true);
    try {
      // Tried without a token first: the API's 401 names the proofs this
      // account can offer, and the gate asks for those.
      const result = await gate.withReauth((token) => acceptOwnership(communityId, token), { purpose: 'ownership', waive: true });
      if (result) {
        toast.success(`You own ${communityName} now`);
        refresh();
      }
    } catch (e) {
      toast.error(errMsg(e, 'Could not hand the gym over'));
    } finally {
      setAccepting(false);
    }
  };

  if (!offer) return null;
  return (
    <Callout tone="brand" title={`${from?.fullName?.trim() || from?.username || 'The owner'} offered you ${communityName}`} icon={<Shield size={18} />}>
      <p>
        Taking it on makes you the owner: you set the rules, the posting policy and who moderates. The current owner stays an admin.
        {offer.expiresAt ? ` The offer closes ${new Date(offer.expiresAt).toLocaleDateString()}.` : ''}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" loading={accepting || gate.prompting} disabled={decline.isPending} onClick={() => void accept()}>
          Accept
        </Button>
        <Button variant="ghost" size="sm" loading={decline.isPending} disabled={accepting} onClick={() => decline.mutate()}>
          Decline
        </Button>
      </div>
      {gate.dialog}
    </Callout>
  );
}

/* ------------------------------------------------------------------ the owner's own actions */

/** "Offer ownership": the active admins and moderators, one of whom takes it on. */
export function OfferOwnershipDialog({
  open,
  communityId,
  communityName,
  roles,
  ownership,
  onClose,
}: {
  open: boolean;
  communityId: string;
  communityName: string;
  roles: RolesView | null | undefined;
  ownership: OwnershipView | null | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const candidates: Actor[] = offerCandidates(roles, ownership?.owner?._id);
  const [to, setTo] = useState('');

  const offer = useMutation({
    mutationFn: () => offerOwnership(communityId, to),
    onSuccess: () => {
      toast.success('Offer sent — they decide whether to take it on');
      qc.invalidateQueries({ queryKey: gymV2Keys.ownership(communityId) });
      onClose();
    },
    onError: (e) => toast.error(isFeatureDisabled(e) ? 'Ownership is not available on your account yet.' : errMsg(e, 'Could not send the offer')),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Offer ${communityName} to someone`}
      description="They become the owner once they accept and confirm it is them. You stay an admin. One offer at a time."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={offer.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={offer.isPending} disabled={!to} onClick={() => offer.mutate()}>
            Send the offer
          </Button>
        </>
      }
    >
      {candidates.length ? (
        <RadioGroup
          label="Who"
          hideLabel
          value={to}
          onChange={setTo}
          options={candidates.map((actor) => ({
            value: String(actor._id),
            label: (
              <span className="inline-flex items-center gap-2">
                <Avatar src={actor.avatar} name={actor.fullName || actor.username || 'Member'} size={24} seed={actor._id} />
                {actor.fullName?.trim() || actor.username || 'Member'}
              </span>
            ),
          }))}
        />
      ) : (
        <p className="text-sm text-text-2">
          Only an admin or a moderator can take the gym on. Make someone an admin in the Members tab first, then offer it to them.
        </p>
      )}
    </Modal>
  );
}

/**
 * The gym's overflow menu rows this package adds. Each one appears only where
 * its read succeeded, so with the flags off the menu is exactly what it was.
 */
export function useGymOwnerMenuItems({
  communityId,
  communityName,
  ownership,
  roles,
  level,
}: {
  communityId: string;
  communityName: string;
  ownership: OwnershipView | null | undefined;
  roles: RolesView | null | undefined;
  level: LevelView | null | undefined;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'level' | 'offer'>(null);
  const [confirm, setConfirm] = useState<null | 'leave' | 'cancel-offer'>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: gymV2Keys.ownership(communityId) });
    qc.invalidateQueries({ queryKey: ['community', communityId] });
  };

  const leave = useMutation({
    mutationFn: () => leaveAsOwner(communityId),
    onSuccess: (result) => {
      toast.success(
        result.next === 'offered'
          ? 'You stepped down — the longest-serving admin has been offered the gym'
          : 'You stepped down — any member can now step up as owner',
      );
      setConfirm(null);
      refresh();
    },
    onError: (e) => {
      toast.error(isFeatureDisabled(e) ? 'Ownership is not available on your account yet.' : errMsg(e, 'Could not step down'));
      setConfirm(null);
    },
  });

  const cancel = useMutation({
    mutationFn: () => cancelOwnershipOffer(communityId),
    onSuccess: () => {
      toast.info('Offer withdrawn');
      setConfirm(null);
      refresh();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not withdraw the offer'));
      setConfirm(null);
    },
  });

  const items = [];
  if (level) {
    items.push({ label: levelLabel(level), icon: <Bell size={18} />, onSelect: () => setDialog('level') });
  }
  if (ownership?.isOwner) {
    if (ownership.pendingOffer) {
      items.push({
        label: 'Withdraw the ownership offer',
        description: ownership.pendingOffer.to?.username ? `Open with ${ownership.pendingOffer.to.username}` : undefined,
        icon: <Users size={18} />,
        onSelect: () => setConfirm('cancel-offer'),
        divider: items.length > 0,
      });
    } else {
      items.push({ label: 'Offer ownership', icon: <Users size={18} />, onSelect: () => setDialog('offer'), divider: items.length > 0 });
    }
    items.push({ label: 'Leave as owner', icon: <Shield size={18} />, danger: true, onSelect: () => setConfirm('leave') });
  }

  const dialogs = (
    <>
      <NotificationLevelDialog open={dialog === 'level'} communityId={communityId} communityName={communityName} current={level} onClose={() => setDialog(null)} />
      <OfferOwnershipDialog
        open={dialog === 'offer'}
        communityId={communityId}
        communityName={communityName}
        roles={roles}
        ownership={ownership}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={confirm === 'leave'}
        title={`Leave ${communityName} as its owner?`}
        description="The longest-serving admin is offered the gym; if there is nobody, any member can step up for a week and the gym pauses after that. You also leave the community."
        confirmLabel="Leave as owner"
        destructive
        loading={leave.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => leave.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'cancel-offer'}
        title="Withdraw the offer?"
        message="They can no longer accept. You can offer the gym to someone else afterwards."
        confirmLabel="Withdraw"
        loading={cancel.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => cancel.mutate()}
      />
    </>
  );

  return { items, dialogs };
}
