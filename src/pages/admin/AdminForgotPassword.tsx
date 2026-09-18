import { useState, type FormEvent } from 'react';
import { adminApi } from '../../lib/api';
import { isEmail, useCountdown } from '../../lib/hooks';
import { classifyResetFailure, resetFailureMessage } from '../../lib/passwordReset';
import { Button, Callout, Input, useOnline } from '../../components/ui';
import { Mail } from '../../components/icons';
import { AdminAuthShell, BackToSignIn } from './AdminLogin';

/**
 * Staff "forgot password". POST /admins/request-reset answers 200 with one
 * generic message whether or not the address belongs to an administrator, so
 * this page never learns, or reveals, whether an account exists; the sent
 * state is worded to match. The route allows five requests per 15 minutes per
 * address, hence the resend cooldown.
 *
 * Unlike the sign-in page this does not probe for an existing session: the
 * admin 401 interceptor hard-redirects to /admin/login from any other path,
 * so a stale token in this tab would bounce someone off this page before
 * they could type. Nothing here needs a session anyway.
 */
export default function AdminForgotPassword() {
  const online = useOnline();

  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, startCooldown] = useCountdown();

  const trimmed = email.trim().toLowerCase();

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    setFieldError(undefined);

    if (!isEmail(trimmed)) {
      setFieldError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      await adminApi.post('/admins/request-reset', { email: trimmed });
      setSent(true);
      startCooldown(60);
    } catch (e2) {
      const failure = classifyResetFailure(e2, {
        online: navigator.onLine,
        fallback: 'Could not send the reset email. Try again shortly.',
      });
      setError(resetFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const offlineNotice = online ? null : (
    <Callout tone="warning">You’re offline. Reconnect to send a reset link.</Callout>
  );

  if (sent) {
    return (
      <AdminAuthShell documentTitle="Check your inbox · Vybe">
        <h2 className="type-heading text-lg text-text-1">Check your inbox</h2>
        <p className="mt-1.5 text-sm text-text-2">
          If a staff account exists for <span className="font-semibold text-text-1">{trimmed}</span>, a reset
          link is on its way. It stops working 15 minutes after it was sent.
        </p>

        <div className="mt-5 flex items-start gap-3 rounded-md bg-surface-2 p-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
            <Mail size={20} />
          </span>
          <div className="text-sm text-text-2">
            <p className="font-semibold text-text-1">Did not get it?</p>
            <p className="mt-0.5">
              Check spam, and make sure this is the email on your staff account. A super administrator can
              confirm it from the Admins page.
            </p>
          </div>
        </div>

        {offlineNotice ? <div className="mt-4">{offlineNotice}</div> : null}
        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            block
            onClick={() => void submit()}
            disabled={busy || cooldown > 0 || !online}
            loading={busy}
            className="tabular"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
          </Button>
          <Button
            variant="ghost"
            block
            onClick={() => {
              setSent(false);
              setError(null);
            }}
          >
            Use a different email
          </Button>
        </div>

        <div className="mt-4 flex justify-center">
          <BackToSignIn />
        </div>
      </AdminAuthShell>
    );
  }

  return (
    <AdminAuthShell documentTitle="Reset your password · Vybe">
      <h2 className="type-heading text-lg text-text-1">Reset your password</h2>
      <p className="mt-1.5 text-sm text-text-2">
        Enter your staff email and we will send a link to choose a new password. The link stops working after
        15 minutes.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Input
          id="admin-reset-email"
          label="Staff email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@vybe.app"
          leading={<Mail size={18} />}
          value={email}
          error={fieldError}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldError) setFieldError(undefined);
          }}
          disabled={busy}
          autoFocus
        />

        {offlineNotice}
        {error ? <Callout tone="danger">{error}</Callout> : null}

        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!online}>
          Send reset link
        </Button>
      </form>

      <div className="mt-4 flex justify-center">
        <BackToSignIn />
      </div>
    </AdminAuthShell>
  );
}
