import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PublicShell } from '../components/PublicShell';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  APP_IN_TESTING,
  CODE_COPIED,
  CODE_HINT,
  CODE_LABEL,
  CODE_SELECTED,
  COPY_CODE,
  CREATE_ACCOUNT_WEB,
  INVITE_FAILURE_TITLE,
  INVITE_PAGE_TITLE,
  LOADING_INVITE,
  OPEN_IN_APP,
  SIGNED_IN_NOTE,
  SIGN_IN,
  STORE_ANDROID,
  STORE_IOS,
  canRetryInvite,
  classifyInviteFailure,
  formatInviteCode,
  inviteFailureMessage,
  invitePreviewView,
  normaliseInviteCode,
  parseInvitePreview,
  readInviteCode,
  registerWithInvitePath,
  showsCodeOnFailure,
  type InviteFailure,
  type InvitePreview,
} from '../lib/invites';
import { appDeepLink, isHandheld } from '../lib/shareLinks';
import { Avatar, Badge, Button, ButtonLink, Callout, Spinner, buttonClass } from './ui';
import { Copy, ExternalLink, Link as LinkIcon, User } from './icons';

/**
 * /join/<code> (the universal link an inviter shares; /join?code= for a
 * hand-built one): the landing for someone who may not have the app. Reads
 * GET /api/public/invites/:code (no account, per-IP limiter) and shows who
 * invited them, to what, the store links the API knows and the code in plain
 * text with "Enter this code after you sign up". Redemption is the app's
 * (POST /invites/:code/redeem); nothing is redeemed here, signed in or not.
 * A malformed code never reaches the API. Rendered in the public shell so
 * it is CSP-safe and works signed out.
 */

export type JoinInviteState =
  | { status: 'loading'; code: string }
  | { status: 'ready'; code: string; preview: InvitePreview }
  | { status: 'failed'; code: string | null; failure: InviteFailure };

export type CopyState = 'copied' | 'selected' | null;

const CARD = 'rounded-md border border-line bg-surface-1 p-5';

/**
 * Put the shown code on the clipboard. When the clipboard API is missing or
 * refused (an http origin, a permissions policy), the code is selected in the
 * page so a manual copy works, and the older copy command is tried on that
 * selection.
 */
export async function copyInviteCode(shown: string, element: HTMLElement | null): Promise<Exclude<CopyState, null>> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(shown);
      return 'copied';
    }
  } catch {
    // Fall through to the selection.
  }
  if (element && typeof window !== 'undefined' && typeof window.getSelection === 'function') {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    try {
      if (typeof document.execCommand === 'function' && document.execCommand('copy')) return 'copied';
    } catch {
      // The selection stands; the person copies by hand.
    }
  }
  return 'selected';
}

/** The code in plain text, selectable, with Copy and the one sentence about what to do with it. */
export function InviteCodeBlock({ code, copyState, onCopy }: { code: string; copyState: CopyState; onCopy?: () => void }) {
  const shown = formatInviteCode(code) ?? code;
  return (
    <div className={CARD} role="group" aria-labelledby="invite-code-label">
      <p id="invite-code-label" className="text-xs font-semibold text-text-2">
        {CODE_LABEL}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code id="invite-code" data-testid="invite-code" className="tabular select-all rounded-sm bg-surface-2 px-3 py-2 text-xl font-semibold tracking-[0.08em] text-text-1">
          {shown}
        </code>
        <Button variant="secondary" size="sm" icon={<Copy size={16} />} onClick={onCopy} data-testid="invite-copy">
          {COPY_CODE}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-text-2">
        {copyState === 'copied' ? CODE_COPIED : copyState === 'selected' ? CODE_SELECTED : ''}
      </p>
      <p className="mt-2 text-sm text-text-2">{CODE_HINT}</p>
    </div>
  );
}

/** The store links the API returned, and only those; with none, the honest line about testing. */
function StoreLinks({ storeUrls }: { storeUrls: InvitePreview['storeUrls'] }) {
  const entries: Array<[string, string, string]> = [];
  if (storeUrls.ios) entries.push(['ios', storeUrls.ios, STORE_IOS]);
  if (storeUrls.android) entries.push(['android', storeUrls.android, STORE_ANDROID]);
  if (!entries.length) {
    return (
      <p className="text-sm text-text-2" data-testid="invite-app-testing">
        {APP_IN_TESTING}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([key, href, label]) => (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass({ variant: 'secondary' })}
          data-testid={`invite-store-${key}`}
        >
          <ExternalLink size={16} />
          {label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ))}
    </div>
  );
}

/**
 * The ways into an account with the code kept: sign-up on the web with
 * ?invite=<CODE> in the URL, or sign-in that bounces back here. `signedIn`
 * is null while the session is still being restored, so the row waits rather
 * than flipping mid-read; a signed-in member reads the note instead, since
 * the code is used in the app and nothing is redeemed on the web.
 */
function AccountRow({ code, signedIn, from, primary }: { code: string; signedIn: boolean | null; from?: unknown; primary: boolean }) {
  if (signedIn === null) return null;
  if (signedIn) return <Callout tone="info">{SIGNED_IN_NOTE}</Callout>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink to={registerWithInvitePath(code)} variant={primary ? 'primary' : 'secondary'} data-testid="invite-register">
        {CREATE_ACCOUNT_WEB}
      </ButtonLink>
      <ButtonLink to="/login" state={from} variant="ghost" data-testid="invite-sign-in">
        {SIGN_IN}
      </ButtonLink>
    </div>
  );
}

/**
 * The preview: who, to what, the ways in, the code. The vybe:// link is
 * offered on a phone or tablet only; on a desktop it does nothing
 * (lib/shareLinks.ts isHandheld), so there the web sign-up leads.
 */
export function InvitePreviewBody({
  preview,
  code,
  signedIn,
  handheld,
  copyState,
  onCopy,
  from,
}: {
  preview: InvitePreview;
  code: string;
  signedIn: boolean | null;
  handheld: boolean;
  copyState: CopyState;
  onCopy?: () => void;
  /** Router location state for the sign-in link, so it bounces back here. */
  from?: unknown;
}) {
  const view = invitePreviewView(preview);
  return (
    <div className="space-y-4">
      <div className={CARD} data-testid="invite-preview">
        <div className="flex items-start gap-4">
          {view.avatar ? (
            <Avatar src={view.avatar} name={view.inviterName} size="lg" className="shrink-0" />
          ) : (
            <span aria-hidden="true" className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-2">
              <User size={26} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <Badge tone="brand">{view.kindLabel}</Badge>
            <h2 className="type-heading mt-2 text-lg text-text-1">{view.title}</h2>
            {view.lines.map((line) => (
              <p key={line} className="mt-1 text-sm text-text-2">
                {line}
              </p>
            ))}
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {handheld ? (
            <a href={appDeepLink('invite', code)} className={buttonClass({ variant: 'primary', size: 'lg', block: true })} data-testid="invite-open-app">
              {OPEN_IN_APP}
            </a>
          ) : null}
          <StoreLinks storeUrls={preview.storeUrls} />
        </div>
      </div>

      <InviteCodeBlock code={code} copyState={copyState} onCopy={onCopy} />

      <AccountRow code={code} signedIn={signedIn} from={from} primary={!handheld} />
    </div>
  );
}

/**
 * A failure in words: the title, one sentence as an alert, Try again where a
 * retry can help, and, when the failure says nothing about the code, the code
 * with the same account row as the preview, so "Enter this code after you
 * sign up" has a sign-up path that keeps the code.
 */
export function InviteFailureBody({
  failure,
  code,
  signedIn = false,
  copyState,
  onCopy,
  onRetry,
  from,
}: {
  failure: InviteFailure;
  code: string | null;
  signedIn?: boolean | null;
  copyState: CopyState;
  onCopy?: () => void;
  onRetry?: () => void;
  from?: unknown;
}) {
  const retry = canRetryInvite(failure) && onRetry;
  return (
    <div className="space-y-4">
      <div className={CARD} data-testid="invite-failure">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-2">
            <LinkIcon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="type-heading text-lg text-text-1">{INVITE_FAILURE_TITLE[failure.kind]}</h2>
            <p role="alert" className="mt-1 text-sm text-text-2">
              {inviteFailureMessage(failure)}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {retry ? (
            <Button variant="primary" onClick={onRetry} data-testid="invite-retry">
              Try again
            </Button>
          ) : null}
          <ButtonLink to="/" variant="secondary">
            Go to Vybe
          </ButtonLink>
        </div>
      </div>
      {code && showsCodeOnFailure(failure) ? (
        <>
          <InviteCodeBlock code={code} copyState={copyState} onCopy={onCopy} />
          <AccountRow code={code} signedIn={signedIn} from={from} primary={false} />
        </>
      ) : null}
    </div>
  );
}

export function JoinInviteOutcome({
  state,
  signedIn,
  handheld,
  copyState,
  onCopy,
  onRetry,
  from,
}: {
  state: JoinInviteState;
  signedIn: boolean | null;
  handheld: boolean;
  copyState: CopyState;
  onCopy?: () => void;
  onRetry?: () => void;
  from?: unknown;
}) {
  const loading = state.status === 'loading';
  // One role="status" node at one tree position for the life of the page
  // (the pattern EmailUnsubscribe documents): it reads the loading line, then
  // the preview title once the preview is in, so the swap is announced rather
  // than the node being replaced. A failure announces through its own
  // role="alert" and leaves the region empty, so nothing is read twice.
  const announced = loading ? LOADING_INVITE : state.status === 'ready' ? invitePreviewView(state.preview).title : '';
  return (
    <div>
      <div role="status" aria-live="polite" aria-busy={loading} className={loading ? CARD : 'sr-only'} data-testid="invite-status">
        {loading ? (
          <p className="inline-flex items-center gap-2 text-sm text-text-2">
            <Spinner size={18} />
            {LOADING_INVITE}
          </p>
        ) : (
          announced
        )}
      </div>
      {state.status === 'failed' ? (
        <InviteFailureBody failure={state.failure} code={state.code} signedIn={signedIn} copyState={copyState} onCopy={onCopy} onRetry={onRetry} from={from} />
      ) : null}
      {state.status === 'ready' ? (
        <InvitePreviewBody preview={state.preview} code={state.code} signedIn={signedIn} handheld={handheld} copyState={copyState} onCopy={onCopy} from={from} />
      ) : null}
    </div>
  );
}

export default function JoinInvite() {
  const { code: param } = useParams();
  const location = useLocation();
  const code = normaliseInviteCode(readInviteCode({ param: param ?? null, search: location.search }));
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  const [handheld] = useState(isHandheld);
  const [copyState, setCopyState] = useState<CopyState>(null);

  const q = useQuery({
    queryKey: ['public-invite', code],
    enabled: !!code,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get(`/public/invites/${code}`);
      const preview = parseInvitePreview(data);
      if (!preview) throw new Error('The invite preview was not readable.');
      return preview;
    },
  });

  // The copied line stands long enough to be read, then clears.
  useEffect(() => {
    if (!copyState) return;
    const timer = window.setTimeout(() => setCopyState(null), 4000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  // A retry after a failure is a fetch with no data yet, so it reads as loading
  // rather than leaving the failure card in place with nothing happening.
  const state: JoinInviteState = !code
    ? { status: 'failed', code: null, failure: { kind: 'malformed' } }
    : q.isError && !q.isFetching
      ? { status: 'failed', code, failure: classifyInviteFailure(q.error, { online: navigator.onLine }) }
      : q.data
        ? { status: 'ready', code, preview: q.data }
        : { status: 'loading', code };

  async function copy() {
    if (!code) return;
    setCopyState(await copyInviteCode(formatInviteCode(code) ?? code, document.getElementById('invite-code')));
  }

  // Try again unmounts the button that was pressed, so focus is moved to the
  // page's main region first (PublicShell gives it tabIndex -1); the status
  // region then announces the loading line and the outcome.
  function retry() {
    document.getElementById('main')?.focus();
    void q.refetch();
  }

  return (
    <PublicShell title={INVITE_PAGE_TITLE}>
      <JoinInviteOutcome
        state={state}
        signedIn={loading ? null : !!user}
        handheld={handheld}
        copyState={copyState}
        onCopy={() => void copy()}
        onRetry={retry}
        from={{ from: location }}
      />
    </PublicShell>
  );
}
