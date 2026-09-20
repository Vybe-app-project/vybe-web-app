import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useFeature } from '../../lib/capabilities';
import { normaliseInviteCode, parseInvitePreview, type InvitePreview } from '../../lib/invites';
import { isFeatureDisabledError, type MyInvites } from '../../lib/inviteFriends';
import {
  CODE_DESCRIPTION,
  CODE_FIELD,
  CODE_HINT,
  CODE_INVALID,
  CODE_OWN,
  CODE_PLACEHOLDER,
  CODE_REDEEM,
  HAVE_CODE,
  InviteRefusal,
  MALFORMED_CODE,
  REDEEMED_TITLE,
  actorName,
  clearsPendingInvite,
  describeRedeemError,
  parseRedeemBody,
  redeemOutcomeCopy,
  redeemRequestId,
} from '../../lib/inviteRedeem';
import { clearPendingInvite, initialInviteValue } from '../../lib/pendingInvite';
import { Button, Callout, Input } from '../ui';
import { SettingsCard } from '../SettingsPieces';
import { INVITES_ME_KEY } from './InviteFriendsSection';

/**
 * Settings › Have a code? (Wave F, design-first-week-and-people.md §3.2, §3.4):
 * a signed-in member types the eight-character code from a friend and the
 * API follows the inviter (or asks to), and joins the gym or challenge the
 * invite was about. Behind features.invites. The same redeem flow serves the
 * welcome sheet's "Invited by" section through useRedeemInvite.
 */

export const PUBLIC_INVITE_KEY = (code: string) => ['public-invite', code] as const;

export type RedeemResult = {
  code: string;
  inviterId: string | null;
  kind: string;
  replayed: boolean;
  /** The sentences to show, in order (lib/inviteRedeem redeemOutcomeCopy). */
  sentences: string[];
};

/**
 * normalise → the member's own code is refused without a request → the public
 * preview for names (a 404 or 410 there is final and saves the write; a 429 or
 * a flag-off answer means "no names") → POST /invites/:code/redeem with one
 * clientRequestId per code, reused on a retry → the sentences. A success or a
 * final refusal drops the pending code kept since sign-up.
 */
export function useRedeemInvite() {
  const qc = useQueryClient();
  const requestIds = useRef(new Map<string, string>());

  return useMutation<RedeemResult, unknown, string>({
    mutationFn: async (raw) => {
      const code = normaliseInviteCode(raw);
      if (!code) throw new InviteRefusal(MALFORMED_CODE, CODE_INVALID);
      const mine = qc.getQueryData<MyInvites | null>(INVITES_ME_KEY);
      if (mine && mine.code === code) throw new InviteRefusal('INVITE_OWN', CODE_OWN);

      let preview: InvitePreview | null = null;
      try {
        preview = await qc.fetchQuery({
          queryKey: PUBLIC_INVITE_KEY(code),
          staleTime: 60_000,
          retry: false,
          queryFn: async () => {
            const { data } = await api.get(`/public/invites/${code}`);
            return parseInvitePreview(data);
          },
        });
      } catch (e) {
        const { status, code: errorCode } = describeRedeemError(e);
        if ((status === 404 && errorCode !== 'FEATURE_DISABLED') || status === 410) throw e;
        // A rate-limited or flag-off preview only costs the names.
      }

      const requestId = requestIds.current.get(code) ?? redeemRequestId(code);
      requestIds.current.set(code, requestId);
      const { data } = await api.post(`/invites/${code}/redeem`, { clientRequestId: requestId });
      const body = parseRedeemBody(data);
      if (!body) throw new Error('The invite answer was not readable.');
      requestIds.current.delete(code);

      const inviterName = actorName(body.inviter) ?? preview?.inviter.firstName ?? null;
      return {
        code,
        inviterId: body.inviter?._id ?? null,
        kind: body.kind,
        replayed: body.replayed,
        sentences: redeemOutcomeCopy(body.outcome, { inviterName, kind: body.kind, targetName: preview?.target?.name ?? null }),
      };
    },
    onSuccess: (result) => {
      clearPendingInvite(sessionStorage);
      for (const key of [['me'], ['feed'], ['friends'], ['followRequests'], ['people-suggestions'], ['welcome-people'], ['invites'], ['gyms'], ['community'], ['communities'], ['challenges']]) {
        void qc.invalidateQueries({ queryKey: key });
      }
      if (result.inviterId) void qc.invalidateQueries({ queryKey: ['user', result.inviterId] });
    },
    onError: (e) => {
      const { code } = describeRedeemError(e);
      if (code === 'FEATURE_DISABLED') void qc.invalidateQueries({ queryKey: ['capabilities'] });
      if (clearsPendingInvite(code)) clearPendingInvite(sessionStorage);
    },
  });
}

/** The form; presentational, so it renders the same under react-dom/server. */
export function InviteCodeForm({
  value,
  onChange,
  onSubmit,
  busy = false,
  error = null,
  result = null,
  inputId = 'invite-code-field',
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  result?: string[] | null;
  inputId?: string;
}) {
  return (
    <SettingsCard id="invite-code" title={HAVE_CODE} description={CODE_DESCRIPTION}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Input
          id={inputId}
          label={CODE_FIELD}
          hint={CODE_HINT}
          error={error}
          value={value}
          placeholder={CODE_PLACEHOLDER}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={16}
          className="tabular uppercase"
          onChange={(e) => onChange(e.target.value)}
        />
        {result && result.length ? (
          <div role="status" aria-live="polite">
            <Callout tone="success" title={REDEEMED_TITLE}>
              {result.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </Callout>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy} disabled={!value.trim()}>
            {CODE_REDEEM}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

function InviteCodeLoaded() {
  const location = useLocation();
  const qc = useQueryClient();
  const redeem = useRedeemInvite();
  // Prefilled from ?invite= (the landing's "Use this code on the web") first,
  // else from the code kept since sign-up (lib/pendingInvite initialInviteValue).
  const [value, setValue] = useState(() => initialInviteValue(location.search, sessionStorage));
  const [hidden, setHidden] = useState(false);

  const failure = redeem.isError ? describeRedeemError(redeem.error) : null;
  const disabled = failure?.code === 'FEATURE_DISABLED';
  useEffect(() => {
    if (disabled) {
      setHidden(true);
      void qc.invalidateQueries({ queryKey: ['capabilities'] });
    }
  }, [disabled, qc]);

  // The landing sends a member to /settings?invite=…#invite-code. The page's
  // hash handler (Settings.tsx) looks for the card 60 ms after the hash
  // changes, but this card mounts only once /capabilities has answered, so on
  // a hard load, a reload or an expired flag cache there is no card yet when
  // it looks. Once mounted, the card takes the scroll and focus itself; when
  // the page handler got there first, or a field inside is already in use,
  // nothing moves.
  useEffect(() => {
    if (location.hash !== '#invite-code') return;
    const t = window.setTimeout(() => {
      const card = document.getElementById('invite-code');
      if (!card || card.contains(document.activeElement)) return;
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      card.setAttribute('tabindex', '-1');
      card.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [location.hash]);

  if (hidden) return null;

  return (
    <InviteCodeForm
      value={value}
      onChange={(next) => {
        setValue(next);
        if (redeem.isError || redeem.isSuccess) redeem.reset();
      }}
      onSubmit={() => {
        if (redeem.isPending) return;
        redeem.mutate(value);
      }}
      busy={redeem.isPending}
      error={failure && !disabled ? failure.message : null}
      result={redeem.data?.sentences ?? null}
    />
  );
}

/** Nothing at all while features.invites is false. */
export default function InviteCodeSection() {
  const enabled = useFeature('invites');
  if (!enabled) return null;
  return <InviteCodeLoaded />;
}
