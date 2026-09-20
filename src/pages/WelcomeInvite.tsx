import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useFeature } from '../lib/capabilities';
import { formatInviteCode, parseInvitePreview } from '../lib/invites';
import { INVITED_BY_BODY, INVITED_BY_UNKNOWN, NOT_NOW, USE_INVITE, describeRedeemError, invitedByTitle } from '../lib/inviteRedeem';
import { clearPendingInvite } from '../lib/pendingInvite';
import { Button, Callout } from './ui';
import { PUBLIC_INVITE_KEY, useRedeemInvite } from './settings/InviteCodeSection';

/**
 * The welcome sheet's "Invited by" section (Wave F,
 * design-first-week-and-people.md §3.2 InvitedByCard, §3.4): shown once after
 * sign-up when a code came along from /join/<code>. "Sam invited you" from the
 * public preview, one line about what following back gives, Use invite (the
 * shared redeem flow) and Not now (the code stays kept, so Settings › Have a
 * code? still offers it). Renders nothing while features.invites is false;
 * a code the API no longer knows is dropped quietly.
 */
export default function WelcomeInviteSection({ code, onDone }: { code: string; onDone?: () => void }) {
  const enabled = useFeature('invites');
  const [dismissed, setDismissed] = useState(false);
  const redeem = useRedeemInvite();

  const preview = useQuery({
    queryKey: PUBLIC_INVITE_KEY(code),
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get(`/public/invites/${code}`);
      return parseInvitePreview(data);
    },
  });

  // An unknown or turned-off code cannot be used later: drop it and say nothing (spec §6).
  const dead = (() => {
    if (!preview.isError) return false;
    const { status, code: errorCode } = describeRedeemError(preview.error);
    return (status === 404 && errorCode !== 'FEATURE_DISABLED') || status === 410;
  })();
  useEffect(() => {
    if (!dead) return;
    clearPendingInvite(sessionStorage);
    onDone?.();
  }, [dead, onDone]);

  if (!enabled || dismissed || dead) return null;

  const firstName = preview.data?.inviter.firstName ?? null;
  const failure = redeem.isError ? describeRedeemError(redeem.error) : null;
  if (failure?.code === 'FEATURE_DISABLED') return null;

  return (
    <section aria-labelledby="welcome-invite-heading" className="rounded-md border border-brand/30 bg-brand-soft p-3.5">
      <h3 id="welcome-invite-heading" className="text-md font-semibold text-text-1">
        {firstName ? invitedByTitle(firstName) : INVITED_BY_UNKNOWN}
      </h3>
      <p className="mt-0.5 text-sm text-text-2">{INVITED_BY_BODY}</p>
      <p className="tabular mt-1 text-xs text-text-3">{formatInviteCode(code) ?? code}</p>
      {redeem.isSuccess ? (
        <div role="status" aria-live="polite" className="mt-3">
          <Callout tone="success">
            {redeem.data.sentences.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Callout>
        </div>
      ) : (
        <>
          {failure ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {failure.message}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="brand" size="sm" loading={redeem.isPending} onClick={() => redeem.mutate(code)}>
              {USE_INVITE}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={redeem.isPending}
              onClick={() => {
                setDismissed(true);
                onDone?.();
              }}
            >
              {NOT_NOW}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
