import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../../lib/api';
import { useFeature } from '../../lib/capabilities';
import { CODE_SELECTED, formatInviteCode } from '../../lib/invites';
import { copyLink } from '../../lib/share';
import {
  ABOUT,
  CODE_COPIED,
  CONTEXTUAL_HEADING,
  COPY_CODE,
  COPY_LINK,
  HONEST,
  INVITE_ERROR,
  INVITE_TITLE,
  JOINED_EMPTY,
  JOINED_LIST_LABEL,
  KEEP_LINK,
  LINK_COPIED,
  NEW_LINK,
  NEW_LINK_BODY,
  NEW_LINK_CONFIRM,
  NEW_LINK_READY,
  NEW_LINK_TITLE,
  SHARE,
  SHARE_TITLE,
  SHOW_AVATAR_HINT,
  SHOW_AVATAR_TITLE,
  WHO_JOINED,
  YOUR_LINK,
  contextualFallbackName,
  firstNameOf,
  isFeatureDisabledError,
  joinedLine,
  moreJoinedLine,
  parseMyInvites,
  shareText,
  type ContextualInvite,
  type MyInvites,
} from '../../lib/inviteFriends';
import { Avatar, Button, ConfirmDialog, ErrorState, SkeletonRow, useToast } from '../ui';
import { Copy, Link as LinkIcon, ShareUp } from '../icons';
import { SettingsCard, ToggleRow } from '../SettingsPieces';
import { copyInviteCode } from '../JoinInvite';

/**
 * Settings › Invite friends (Wave F, design-first-week-and-people.md §3.3):
 * the member's code as VYBE-XXXX-XXXX and its link, Copy code / Copy link /
 * Share / New link, who joined (first names and avatars only), the gym and
 * challenge links, and the one honest line about what an invite gives. Behind
 * features.invites: nothing renders while the flag is off, and a 404
 * FEATURE_DISABLED from the API reads as "absent", never as an error card.
 */

export const INVITES_KEY = ['invites'] as const;
export const INVITES_ME_KEY = ['invites', 'me'] as const;

export type CopiedState = 'code' | 'link' | 'selected' | null;

const CODE_CLASS = 'tabular select-all rounded-sm bg-surface-2 px-3 py-2 text-xl font-semibold tracking-[0.08em] text-text-1';

/**
 * The clipboard and share plumbing one link block needs. Copy code selects
 * the code in the page when the clipboard is refused (JoinInvite's path);
 * Copy link falls back to a toast showing the link; Share uses the OS sheet
 * and treats a dismissed sheet as nothing happened.
 */
export function useInviteCopy(codeElementId: string) {
  const toast = useToast();
  const [copied, setCopied] = useState<CopiedState>(null);
  const [canShare] = useState(() => typeof navigator !== 'undefined' && typeof navigator.share === 'function');

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 4000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyCode = async (code: string) => {
    const shown = formatInviteCode(code) ?? code;
    const result = await copyInviteCode(shown, document.getElementById(codeElementId));
    setCopied(result === 'copied' ? 'code' : 'selected');
  };

  const copyUrl = async (url: string) => {
    await copyLink(url, { success: () => setCopied('link'), info: (message, options) => toast.info(message, options) }, LINK_COPIED);
  };

  const share = async (url: string) => {
    if (!canShare) return copyUrl(url);
    try {
      await navigator.share({ title: SHARE_TITLE, text: shareText(url), url });
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      await copyUrl(url);
    }
  };

  return { copied, canShare, copyCode, copyUrl, share };
}

/** The code, its link, and the buttons; presentational, so the card and the contextual sheet share it. */
export function InviteLinkBlock({
  code,
  url,
  canShare,
  copied,
  onCopyCode,
  onCopyLink,
  onShare,
  codeId = 'my-invite-code',
  heading,
  children,
}: {
  code: string;
  url: string;
  canShare: boolean;
  copied: CopiedState;
  onCopyCode?: () => void;
  onCopyLink?: () => void;
  onShare?: () => void;
  codeId?: string;
  heading?: string;
  /** Extra actions after Share (the card's New link). */
  children?: ReactNode;
}) {
  const shown = formatInviteCode(code) ?? code;
  return (
    <div>
      {heading ? <p className="type-label text-text-2">{heading}</p> : null}
      <div className={heading ? 'mt-2' : undefined}>
        <code id={codeId} data-testid={codeId} className={CODE_CLASS}>
          {shown}
        </code>
      </div>
      <p className="mt-2 break-all text-sm text-text-2" data-testid={`${codeId}-url`}>
        {url}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={<Copy size={16} />} onClick={onCopyCode} data-testid="invite-copy-code">
          {COPY_CODE}
        </Button>
        <Button variant="secondary" size="sm" icon={<LinkIcon size={16} />} onClick={onCopyLink} data-testid="invite-copy-link">
          {COPY_LINK}
        </Button>
        {canShare ? (
          <Button variant="secondary" size="sm" icon={<ShareUp size={16} />} onClick={onShare} data-testid="invite-share">
            {SHARE}
          </Button>
        ) : null}
        {children}
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-text-2">
        {copied === 'code' ? CODE_COPIED : copied === 'link' ? LINK_COPIED : copied === 'selected' ? CODE_SELECTED : ''}
      </p>
    </div>
  );
}

/** The whole card; every value arrives as a prop, so it renders the same under react-dom/server. */
export function InviteFriendsCard({
  invites,
  canShare,
  copied,
  busy = false,
  onCopyCode,
  onCopyLink,
  onShare,
  onNewLink,
  onCopyContextualLink,
  onToggleAvatar,
}: {
  invites: MyInvites;
  canShare: boolean;
  copied: CopiedState;
  busy?: boolean;
  onCopyCode?: () => void;
  onCopyLink?: () => void;
  onShare?: () => void;
  onNewLink?: () => void;
  onCopyContextualLink?: (invite: ContextualInvite) => void;
  /** When given, the D-45 switch (PATCH /invites/me showAvatar) renders. */
  onToggleAvatar?: (next: boolean) => void;
}) {
  const more = Math.max(0, invites.joinedCount - invites.joined.length);
  return (
    <SettingsCard id="invites" title={INVITE_TITLE} description={HONEST}>
      <div className="space-y-5">
        <InviteLinkBlock
          heading={YOUR_LINK}
          code={invites.code}
          url={invites.url}
          canShare={canShare}
          copied={copied}
          onCopyCode={onCopyCode}
          onCopyLink={onCopyLink}
          onShare={onShare}
        >
          <Button variant="ghost" size="sm" onClick={onNewLink} disabled={busy} data-testid="invite-new-link">
            {NEW_LINK}
          </Button>
        </InviteLinkBlock>

        {onToggleAvatar ? (
          <div className="border-t border-line pt-2">
            <ToggleRow title={SHOW_AVATAR_TITLE} hint={SHOW_AVATAR_HINT} checked={invites.showAvatar} disabled={busy} onChange={onToggleAvatar} />
          </div>
        ) : null}

        <section aria-labelledby="invites-joined-title" className="border-t border-line pt-4">
          <h3 id="invites-joined-title" className="text-sm font-semibold text-text-1">
            {invites.joinedCount > 0 ? joinedLine(invites.joinedCount) : WHO_JOINED}
          </h3>
          {invites.joined.length ? (
            <ul aria-label={JOINED_LIST_LABEL} className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {invites.joined.map((entry) => (
                <li key={entry.user._id} className="flex items-center gap-2">
                  <Avatar src={entry.user.avatar} name={firstNameOf(entry.user)} size={28} />
                  <Link to={`/u/${entry.user._id}`} viewTransition className="text-sm font-semibold text-text-1 hover:underline">
                    {firstNameOf(entry.user)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-text-2">{JOINED_EMPTY}</p>
          )}
          {more > 0 ? <p className="mt-2 text-xs text-text-3">{moreJoinedLine(more)}</p> : null}
        </section>

        {invites.contextual.length ? (
          <section aria-labelledby="invites-contextual-title" className="border-t border-line pt-4">
            <h3 id="invites-contextual-title" className="text-sm font-semibold text-text-1">
              {CONTEXTUAL_HEADING}
            </h3>
            <ul className="mt-1 divide-y divide-line">
              {invites.contextual.map((invite) => {
                const name = invite.targetName ?? contextualFallbackName(invite.kind);
                return (
                  <li key={invite.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-text-1">{name}</span>
                      <code className="tabular text-xs text-text-2">{formatInviteCode(invite.code)}</code>
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<LinkIcon size={14} />}
                      aria-label={`Copy the invite link for ${name}`}
                      onClick={() => onCopyContextualLink?.(invite)}
                    >
                      {COPY_LINK}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <p className="text-xs text-text-3">{ABOUT}</p>
      </div>
    </SettingsCard>
  );
}

function InviteFriendsLoaded() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const { copied, canShare, copyCode, copyUrl, share } = useInviteCopy('my-invite-code');

  const invites = useQuery({
    queryKey: INVITES_ME_KEY,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get('/invites/me');
      return parseMyInvites(data);
    },
  });

  // The flag can turn off mid-session (30 s on the API, 5 min here): the
  // answer is 404 FEATURE_DISABLED, so the card hides and the flags refresh.
  const disabled = invites.isError && isFeatureDisabledError(invites.error);
  useEffect(() => {
    if (disabled) void qc.invalidateQueries({ queryKey: ['capabilities'] });
  }, [disabled, qc]);

  const revoke = useMutation({
    mutationFn: async (code: string) => {
      await api.delete(`/invites/${code}`);
    },
    onSuccess: () => {
      setConfirming(false);
      toast.success(NEW_LINK_READY);
      // The next read mints the fresh code; the people who joined stay.
      void qc.invalidateQueries({ queryKey: INVITES_KEY });
    },
    onError: (e) => {
      setConfirming(false);
      if (isFeatureDisabledError(e)) {
        void qc.invalidateQueries({ queryKey: ['capabilities'] });
        return;
      }
      toast.error(errMsg(e, 'Could not make a new link.'));
    },
  });

  const showAvatar = useMutation({
    mutationFn: async (next: boolean) => {
      const { data } = await api.patch('/invites/me', { showAvatar: next });
      return (data as { settings?: { showAvatar?: unknown } })?.settings?.showAvatar === true;
    },
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: INVITES_ME_KEY });
      const previous = qc.getQueryData<MyInvites | null>(INVITES_ME_KEY);
      qc.setQueryData<MyInvites | null>(INVITES_ME_KEY, (old) => (old ? { ...old, showAvatar: next } : old));
      return { previous };
    },
    onSuccess: (value) => qc.setQueryData<MyInvites | null>(INVITES_ME_KEY, (old) => (old ? { ...old, showAvatar: value } : old)),
    onError: (e, _next, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(INVITES_ME_KEY, ctx.previous);
      if (isFeatureDisabledError(e)) {
        void qc.invalidateQueries({ queryKey: ['capabilities'] });
        return;
      }
      toast.error(errMsg(e, 'Could not save that choice.'));
    },
  });

  if (disabled) return null;

  if (invites.isLoading) {
    return (
      <SettingsCard id="invites" title={INVITE_TITLE}>
        <SkeletonRow />
      </SettingsCard>
    );
  }

  if (invites.isError || !invites.data) {
    return (
      <SettingsCard id="invites" title={INVITE_TITLE}>
        <ErrorState title={INVITE_ERROR} error={invites.error} retry={() => void invites.refetch()} />
      </SettingsCard>
    );
  }

  const data = invites.data;
  return (
    <>
      <InviteFriendsCard
        invites={data}
        canShare={canShare}
        copied={copied}
        busy={revoke.isPending || showAvatar.isPending}
        onCopyCode={() => void copyCode(data.code)}
        onCopyLink={() => void copyUrl(data.url)}
        onShare={() => void share(data.url)}
        onNewLink={() => setConfirming(true)}
        onCopyContextualLink={(invite) => void copyUrl(invite.url)}
        onToggleAvatar={(next) => showAvatar.mutate(next)}
      />
      <ConfirmDialog
        open={confirming}
        title={NEW_LINK_TITLE}
        message={NEW_LINK_BODY}
        confirmLabel={NEW_LINK_CONFIRM}
        cancelLabel={KEEP_LINK}
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate(data.code)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

/** Nothing at all while features.invites is false: no card, no heading, no skeleton. */
export default function InviteFriendsSection() {
  const enabled = useFeature('invites');
  if (!enabled) return null;
  return <InviteFriendsLoaded />;
}
