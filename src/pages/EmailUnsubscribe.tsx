import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PublicShell } from '../components/PublicShell';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  canRetryUnsubscribe,
  classifyUnsubscribeFailure,
  isUnsubscribeToken,
  manageEmailPreferencesPath,
  readUnsubscribeToken,
  unsubscribeFailureMessage,
  unsubscribeSuccessMessage,
  type UnsubscribeFailure,
} from '../lib/emailUnsubscribe';
import { Button, ButtonLink, Spinner } from './ui';
import { ArrowLeft, CheckCircle, Mail } from './icons';

/**
 * One-click e-mail unsubscribe landing: /email/unsubscribe/<token> (the path a
 * mailer builds with resolveFrontendUrl) or /email/unsubscribe?token=<token>.
 * No account is needed; the token is the credential. The page POSTs it once
 * to /api/email/unsubscribe on mount (the API's GET form would also consume
 * it, so a link scanner that follows the mail link spends nothing here; only
 * a client that runs this page does). Rendered in the public shell so it is
 * CSP-safe and works signed out; a signed-in member is offered the Settings
 * e-mail card.
 */

export type UnsubscribeState =
  | { status: 'invalid' }
  | { status: 'working' }
  | { status: 'done'; kind: string | null; message: string }
  | { status: 'failed'; failure: UnsubscribeFailure };

const FAILED_TITLE: Record<UnsubscribeFailure['kind'], string> = {
  network: 'Could not reach Vybe',
  'invalid-link': 'This link is not valid',
  'used-or-expired': 'This link has already been used',
  'rate-limited': 'Too many requests',
  failed: 'Something went wrong',
};

/**
 * The outcome block, presentational so it renders under react-dom/server.
 * `signedIn` is null while the session is still being restored: the manage
 * link waits rather than flipping from "Sign in" to "Manage" mid-read.
 */
export function UnsubscribeOutcome({
  state,
  signedIn,
  onRetry,
}: {
  state: UnsubscribeState;
  signedIn: boolean | null;
  onRetry?: () => void;
}) {
  const manage =
    signedIn === null ? null : (
      <ButtonLink to={manageEmailPreferencesPath(signedIn)} variant={state.status === 'done' ? 'primary' : 'secondary'}>
        {signedIn ? 'Manage e-mail preferences' : 'Sign in to manage e-mail preferences'}
      </ButtonLink>
    );
  const home = (
    <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-semibold text-text-2 hover:text-text-1">
      <ArrowLeft size={18} />
      Back to home
    </Link>
  );

  if (state.status === 'working') {
    return (
      <div className="rounded-md border border-line bg-surface-1 p-5">
        <p role="status" aria-live="polite" className="inline-flex items-center gap-2 text-sm text-text-2">
          <Spinner size={18} />
          Updating your e-mail preferences…
        </p>
      </div>
    );
  }

  if (state.status === 'done') {
    return (
      <div className="rounded-md border border-line bg-surface-1 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="type-heading text-lg text-text-1">You are unsubscribed</h2>
            <p className="mt-1 text-sm text-text-2">{state.message}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {manage}
          {home}
        </div>
      </div>
    );
  }

  const title = state.status === 'invalid' ? 'This link is not valid' : FAILED_TITLE[state.failure.kind];
  const sentence =
    state.status === 'invalid'
      ? 'Unsubscribe links come from a Vybe e-mail. Open the link from your inbox, or change your e-mail choices in Settings.'
      : unsubscribeFailureMessage(state.failure);
  const retry = state.status === 'failed' && canRetryUnsubscribe(state.failure) && onRetry;

  return (
    <div className="rounded-md border border-line bg-surface-1 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-2">
          <Mail size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="type-heading text-lg text-text-1">{title}</h2>
          <p role="alert" className="mt-1 text-sm text-text-2">
            {sentence}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {retry ? (
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {manage}
        {home}
      </div>
    </div>
  );
}

export default function EmailUnsubscribe() {
  const { token: param } = useParams();
  const { search } = useLocation();
  const token = readUnsubscribeToken({ param: param ?? null, search });
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  const [state, setState] = useState<UnsubscribeState>(() => (isUnsubscribeToken(token) ? { status: 'working' } : { status: 'invalid' }));
  // The token is single-use: a StrictMode double effect or a re-render must not spend it twice.
  const attempted = useRef<string | null>(null);

  async function submit(token: string) {
    setState({ status: 'working' });
    try {
      const { data } = await api.post('/email/unsubscribe', { token });
      const body = (data && typeof data === 'object' ? data : {}) as { kind?: unknown; message?: unknown };
      const kind = typeof body.kind === 'string' ? body.kind : null;
      setState({ status: 'done', kind, message: unsubscribeSuccessMessage(kind, body.message) });
    } catch (e) {
      setState({ status: 'failed', failure: classifyUnsubscribeFailure(e, { online: navigator.onLine }) });
    }
  }

  useEffect(() => {
    if (!isUnsubscribeToken(token) || attempted.current === token) return;
    attempted.current = token;
    void submit(token);
    // submit only closes over setState; the token is the one input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <PublicShell title="E-mail preferences" subtitle="One-click unsubscribe from a Vybe e-mail.">
      <UnsubscribeOutcome state={state} signedIn={loading ? null : !!user} onRetry={() => void submit(token)} />
    </PublicShell>
  );
}
